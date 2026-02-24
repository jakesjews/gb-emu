import { SampleBuffer } from './SampleBuffer';

const DEFAULT_PIPELINE_CAPACITY = 48_000 * 3;
const WORKLET_CHUNK_FRAMES = 512;

export interface AudioSampleSource {
  drainAudioSamples(maxFrames: number): Float32Array;
  getAudioSampleRate(): number;
}

export interface AudioOutputStats {
  enabled: boolean;
  contextState: AudioContextState | 'unavailable';
  bufferedFrames: number;
  underruns: number;
  droppedFrames: number;
  muted: boolean;
  volume: number;
}

export class AudioPipeline {
  private readonly buffer: SampleBuffer;

  private underruns = 0;

  public constructor(capacityFrames = DEFAULT_PIPELINE_CAPACITY) {
    this.buffer = new SampleBuffer(capacityFrames);
  }

  public clear(): void {
    this.buffer.clear();
    this.underruns = 0;
  }

  public push(samples: Float32Array): number {
    return this.buffer.enqueue(samples);
  }

  public popAvailable(maxFrames: number): Float32Array {
    return this.buffer.dequeue(maxFrames);
  }

  public popFixed(frameCount: number): Float32Array {
    const { samples, framesRead } = this.buffer.dequeueFixed(frameCount);
    if (framesRead < frameCount) {
      this.underruns += frameCount - framesRead;
    }
    return samples;
  }

  public noteUnderruns(frames: number): void {
    if (frames > 0) {
      this.underruns += Math.floor(frames);
    }
  }

  public getBufferedFrames(): number {
    return this.buffer.getBufferedFrames();
  }

  public getDroppedFrames(): number {
    return this.buffer.getDroppedFrames();
  }

  public getUnderruns(): number {
    return this.underruns;
  }
}

export class AudioOutput {
  private readonly source: AudioSampleSource;

  private readonly pipeline: AudioPipeline;

  private context: AudioContext | null = null;

  private gainNode: GainNode | null = null;

  private workletNode: AudioWorkletNode | null = null;

  private scriptNode: ScriptProcessorNode | null = null;

  private muted = false;

  private volume = 0.8;

  private paused = true;

  private enabled = false;

  private contextUnavailable = false;

  public constructor(source: AudioSampleSource, pipeline?: AudioPipeline) {
    this.source = source;
    this.pipeline = pipeline ?? new AudioPipeline();
  }

  public async resumeFromUserGesture(): Promise<void> {
    if (!this.ensureBrowserSupport()) {
      return;
    }

    if (!this.context) {
      await this.initializeContext();
    }

    if (!this.context) {
      return;
    }

    if (this.context.state !== 'running') {
      await this.context.resume();
    }

    this.enabled = true;
    this.paused = false;
    this.updateGain();
  }

  public setPaused(paused: boolean): void {
    this.paused = paused;
    this.updateGain();
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    this.updateGain();
  }

  public setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    this.updateGain();
  }

  public pump(maxFrames = 2048): void {
    if (maxFrames <= 0) {
      return;
    }

    const samples = this.source.drainAudioSamples(maxFrames);
    if (samples.length > 0) {
      this.pipeline.push(samples);
    }

    if (this.workletNode) {
      this.flushWorkletQueue();
    }
  }

  public getStats(): AudioOutputStats {
    return {
      enabled: this.enabled && !this.contextUnavailable,
      contextState: this.contextUnavailable ? 'unavailable' : (this.context?.state ?? 'suspended'),
      bufferedFrames: this.pipeline.getBufferedFrames(),
      underruns: this.pipeline.getUnderruns(),
      droppedFrames: this.pipeline.getDroppedFrames(),
      muted: this.muted,
      volume: this.volume,
    };
  }

  public async close(): Promise<void> {
    this.enabled = false;
    this.paused = true;
    this.pipeline.clear();

    if (this.scriptNode) {
      this.scriptNode.disconnect();
      this.scriptNode.onaudioprocess = null;
      this.scriptNode = null;
    }

    if (this.workletNode) {
      this.workletNode.port.onmessage = null;
      this.workletNode.disconnect();
      this.workletNode = null;
    }

    if (this.gainNode) {
      this.gainNode.disconnect();
      this.gainNode = null;
    }

    if (this.context) {
      await this.context.close();
      this.context = null;
    }
  }

  private ensureBrowserSupport(): boolean {
    if (typeof window === 'undefined') {
      this.contextUnavailable = true;
      return false;
    }

    if (typeof AudioContext === 'undefined') {
      this.contextUnavailable = true;
      return false;
    }

    this.contextUnavailable = false;
    return true;
  }

  private async initializeContext(): Promise<void> {
    if (!this.ensureBrowserSupport()) {
      return;
    }

    const targetRate = this.source.getAudioSampleRate();
    this.context = new AudioContext({ sampleRate: targetRate });
    this.gainNode = this.context.createGain();
    this.gainNode.connect(this.context.destination);

    const workletEnabled = await this.setupWorkletPath();
    if (!workletEnabled) {
      this.setupScriptProcessorPath();
    }

    this.updateGain();
  }

  private async setupWorkletPath(): Promise<boolean> {
    if (!this.context || !this.gainNode || typeof AudioWorkletNode === 'undefined') {
      return false;
    }

    try {
      await this.context.audioWorklet.addModule(new URL('./gbAudioProcessor.js', import.meta.url));
      this.workletNode = new AudioWorkletNode(this.context, 'gb-audio-processor', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      this.workletNode.port.onmessage = (event: MessageEvent<unknown>) => {
        const payload = event.data as { type?: string; frames?: number } | undefined;
        if (!payload || typeof payload.type !== 'string') {
          return;
        }

        if (payload.type === 'need-data') {
          this.pump(WORKLET_CHUNK_FRAMES * 4);
          this.flushWorkletQueue();
          return;
        }

        if (payload.type === 'underrun') {
          this.pipeline.noteUnderruns(payload.frames ?? 0);
        }
      };
      this.workletNode.connect(this.gainNode);
      this.flushWorkletQueue();
      return true;
    } catch {
      if (this.workletNode) {
        this.workletNode.disconnect();
        this.workletNode = null;
      }
      return false;
    }
  }

  private setupScriptProcessorPath(): void {
    if (!this.context || !this.gainNode) {
      return;
    }

    this.scriptNode = this.context.createScriptProcessor(1024, 0, 2);
    this.scriptNode.onaudioprocess = (event: AudioProcessingEvent) => {
      this.pump(1024);
      const output = this.pipeline.popFixed(event.outputBuffer.length);
      const left = event.outputBuffer.getChannelData(0);
      const right = event.outputBuffer.getChannelData(1);

      for (let i = 0; i < event.outputBuffer.length; i += 1) {
        const source = i * 2;
        left[i] = output[source];
        right[i] = output[source + 1];
      }
    };
    this.scriptNode.connect(this.gainNode);
  }

  private flushWorkletQueue(): void {
    if (!this.workletNode) {
      return;
    }

    for (let i = 0; i < 6; i += 1) {
      const chunk = this.pipeline.popAvailable(WORKLET_CHUNK_FRAMES);
      if (chunk.length === 0) {
        break;
      }

      this.workletNode.port.postMessage({ type: 'push', samples: chunk }, [chunk.buffer]);
    }
  }

  private updateGain(): void {
    if (!this.gainNode) {
      return;
    }

    const audible = this.enabled && !this.paused && !this.muted;
    this.gainNode.gain.value = audible ? this.volume : 0;
  }
}
