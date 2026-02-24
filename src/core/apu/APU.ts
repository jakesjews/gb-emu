import { NoiseChannel } from './channels/NoiseChannel';
import { PulseChannel } from './channels/PulseChannel';
import { WaveChannel } from './channels/WaveChannel';

const CPU_CLOCK_HZ = 4_194_304;
const SAMPLE_RATE_HZ = 48_000;
const FRAME_SEQUENCER_PERIOD_CYCLES = 8_192;
const SAMPLE_BUFFER_CAPACITY_FRAMES = 96_000;

export interface ApuDebugState {
  masterEnabled: boolean;
  bufferedFrames: number;
  droppedFrames: number;
  frameSequencerStep: number;
  channelEnabled: [boolean, boolean, boolean, boolean];
}

export class APU {
  private readonly channel1 = new PulseChannel(true);

  private readonly channel2 = new PulseChannel(false);

  private readonly waveRam = new Uint8Array(0x10);

  private readonly channel3 = new WaveChannel(this.waveRam);

  private readonly channel4 = new NoiseChannel();

  private nr50 = 0;

  private nr51 = 0;

  private masterEnabled = false;

  private frameSequencerCycles = 0;

  private frameSequencerStep = 0;

  private sampleAccumulator = 0;

  private readonly sampleBuffer = new Float32Array(SAMPLE_BUFFER_CAPACITY_FRAMES * 2);

  private sampleReadIndex = 0;

  private sampleWriteIndex = 0;

  private bufferedFrames = 0;

  private droppedFrames = 0;

  public reset(): void {
    this.channel1.reset();
    this.channel2.reset();
    this.channel3.reset();
    this.channel4.reset();
    this.nr50 = 0;
    this.nr51 = 0;
    this.masterEnabled = false;
    this.frameSequencerCycles = 0;
    this.frameSequencerStep = 0;
    this.sampleAccumulator = 0;
    this.sampleReadIndex = 0;
    this.sampleWriteIndex = 0;
    this.bufferedFrames = 0;
    this.droppedFrames = 0;
    this.waveRam.fill(0);
  }

  public tick(cycles: number): void {
    if (cycles <= 0) {
      return;
    }

    if (this.masterEnabled) {
      this.channel1.tick(cycles);
      this.channel2.tick(cycles);
      this.channel3.tick(cycles);
      this.channel4.tick(cycles);

      this.frameSequencerCycles += cycles;
      while (this.frameSequencerCycles >= FRAME_SEQUENCER_PERIOD_CYCLES) {
        this.frameSequencerCycles -= FRAME_SEQUENCER_PERIOD_CYCLES;
        this.clockFrameSequencer();
      }
    }

    this.sampleAccumulator += cycles * SAMPLE_RATE_HZ;
    while (this.sampleAccumulator >= CPU_CLOCK_HZ) {
      this.sampleAccumulator -= CPU_CLOCK_HZ;
      const [left, right] = this.mixSample();
      this.pushSampleFrame(left, right);
    }
  }

  public read(address: number): number {
    const addr = address & 0xffff;

    if (addr >= 0xff30 && addr <= 0xff3f) {
      return this.waveRam[addr - 0xff30];
    }

    switch (addr) {
      case 0xff10:
        return this.channel1.readRegister(0) | 0x80;
      case 0xff11:
        return this.channel1.readRegister(1) | 0x3f;
      case 0xff12:
        return this.channel1.readRegister(2);
      case 0xff13:
        return 0xff;
      case 0xff14:
        return this.channel1.readRegister(4) | 0xbf;
      case 0xff15:
        return 0xff;
      case 0xff16:
        return this.channel2.readRegister(1) | 0x3f;
      case 0xff17:
        return this.channel2.readRegister(2);
      case 0xff18:
        return 0xff;
      case 0xff19:
        return this.channel2.readRegister(4) | 0xbf;
      case 0xff1a:
        return this.channel3.readRegister(0) | 0x7f;
      case 0xff1b:
        return 0xff;
      case 0xff1c:
        return this.channel3.readRegister(2) | 0x9f;
      case 0xff1d:
        return 0xff;
      case 0xff1e:
        return this.channel3.readRegister(4) | 0xbf;
      case 0xff1f:
        return 0xff;
      case 0xff20:
        return 0xff;
      case 0xff21:
        return this.channel4.readRegister(1);
      case 0xff22:
        return this.channel4.readRegister(2);
      case 0xff23:
        return this.channel4.readRegister(3) | 0xbf;
      case 0xff24:
        return this.nr50;
      case 0xff25:
        return this.nr51;
      case 0xff26:
        return this.readNr52();
      case 0xff27:
      case 0xff28:
      case 0xff29:
      case 0xff2a:
      case 0xff2b:
      case 0xff2c:
      case 0xff2d:
      case 0xff2e:
      case 0xff2f:
        return 0xff;
      default:
        return 0xff;
    }
  }

  public write(address: number, value: number): void {
    const addr = address & 0xffff;
    const masked = value & 0xff;

    if (addr >= 0xff30 && addr <= 0xff3f) {
      this.waveRam[addr - 0xff30] = masked;
      return;
    }

    switch (addr) {
      case 0xff10:
        this.channel1.writeRegister(0, masked);
        return;
      case 0xff11:
        this.channel1.writeRegister(1, masked);
        return;
      case 0xff12:
        this.channel1.writeRegister(2, masked);
        return;
      case 0xff13:
        this.channel1.writeRegister(3, masked);
        return;
      case 0xff14:
        this.channel1.writeRegister(4, masked);
        return;
      case 0xff15:
        return;
      case 0xff16:
        this.channel2.writeRegister(1, masked);
        return;
      case 0xff17:
        this.channel2.writeRegister(2, masked);
        return;
      case 0xff18:
        this.channel2.writeRegister(3, masked);
        return;
      case 0xff19:
        this.channel2.writeRegister(4, masked);
        return;
      case 0xff1a:
        this.channel3.writeRegister(0, masked);
        return;
      case 0xff1b:
        this.channel3.writeRegister(1, masked);
        return;
      case 0xff1c:
        this.channel3.writeRegister(2, masked);
        return;
      case 0xff1d:
        this.channel3.writeRegister(3, masked);
        return;
      case 0xff1e:
        this.channel3.writeRegister(4, masked);
        return;
      case 0xff1f:
        return;
      case 0xff20:
        this.channel4.writeRegister(0, masked);
        return;
      case 0xff21:
        this.channel4.writeRegister(1, masked);
        return;
      case 0xff22:
        this.channel4.writeRegister(2, masked);
        return;
      case 0xff23:
        this.channel4.writeRegister(3, masked);
        return;
      case 0xff24:
        this.nr50 = masked;
        return;
      case 0xff25:
        this.nr51 = masked;
        return;
      case 0xff26:
        this.writeNr52(masked);
        return;
      case 0xff27:
      case 0xff28:
      case 0xff29:
      case 0xff2a:
      case 0xff2b:
      case 0xff2c:
      case 0xff2d:
      case 0xff2e:
      case 0xff2f:
        return;
      default:
        return;
    }
  }

  public drainSamples(maxFrames: number): Float32Array {
    if (maxFrames <= 0 || this.bufferedFrames <= 0) {
      return new Float32Array(0);
    }

    const frames = Math.min(maxFrames, this.bufferedFrames);
    const output = new Float32Array(frames * 2);

    for (let i = 0; i < frames; i += 1) {
      const source = this.sampleReadIndex * 2;
      const target = i * 2;
      output[target] = this.sampleBuffer[source];
      output[target + 1] = this.sampleBuffer[source + 1];
      this.sampleReadIndex = (this.sampleReadIndex + 1) % SAMPLE_BUFFER_CAPACITY_FRAMES;
    }

    this.bufferedFrames -= frames;
    return output;
  }

  public getBufferedFrames(): number {
    return this.bufferedFrames;
  }

  public getSampleRate(): number {
    return SAMPLE_RATE_HZ;
  }

  public getDebugState(): ApuDebugState {
    return {
      masterEnabled: this.masterEnabled,
      bufferedFrames: this.bufferedFrames,
      droppedFrames: this.droppedFrames,
      frameSequencerStep: this.frameSequencerStep,
      channelEnabled: [
        this.channel1.isEnabled(),
        this.channel2.isEnabled(),
        this.channel3.isEnabled(),
        this.channel4.isEnabled(),
      ],
    };
  }

  public enableSound(): void {
    this.writeNr52(0x80);
  }

  private clockFrameSequencer(): void {
    if ((this.frameSequencerStep & 1) === 0) {
      this.channel1.clockLength();
      this.channel2.clockLength();
      this.channel3.clockLength();
      this.channel4.clockLength();
    }

    if (this.frameSequencerStep === 2 || this.frameSequencerStep === 6) {
      this.channel1.clockSweep();
    }

    if (this.frameSequencerStep === 7) {
      this.channel1.clockEnvelope();
      this.channel2.clockEnvelope();
      this.channel4.clockEnvelope();
    }

    this.frameSequencerStep = (this.frameSequencerStep + 1) & 0x07;
  }

  private mixSample(): [number, number] {
    if (!this.masterEnabled) {
      return [0, 0];
    }

    const samples = [
      this.channel1.output(),
      this.channel2.output(),
      this.channel3.output(),
      this.channel4.output(),
    ];

    const left = this.mixSide(samples, true);
    const right = this.mixSide(samples, false);

    return [left, right];
  }

  private mixSide(channelSamples: number[], left: boolean): number {
    let mix = 0;
    let routedCount = 0;

    for (let i = 0; i < channelSamples.length; i += 1) {
      const routeBit = left ? i + 4 : i;
      if (((this.nr51 >> routeBit) & 0x01) !== 0) {
        mix += channelSamples[i];
        routedCount += 1;
      }
    }

    if (routedCount === 0) {
      return 0;
    }

    const normalized = mix / 4;
    const volume = left ? (this.nr50 >> 4) & 0x07 : this.nr50 & 0x07;
    const scaled = normalized * ((volume + 1) / 8);
    return Math.max(-1, Math.min(1, scaled));
  }

  private pushSampleFrame(left: number, right: number): void {
    if (this.bufferedFrames >= SAMPLE_BUFFER_CAPACITY_FRAMES) {
      this.sampleReadIndex = (this.sampleReadIndex + 1) % SAMPLE_BUFFER_CAPACITY_FRAMES;
      this.bufferedFrames -= 1;
      this.droppedFrames += 1;
    }

    const index = this.sampleWriteIndex * 2;
    this.sampleBuffer[index] = left;
    this.sampleBuffer[index + 1] = right;
    this.sampleWriteIndex = (this.sampleWriteIndex + 1) % SAMPLE_BUFFER_CAPACITY_FRAMES;
    this.bufferedFrames += 1;
  }

  private readNr52(): number {
    let status = this.masterEnabled ? 0x80 : 0;
    status |= 0x70;
    if (this.channel1.isEnabled()) {
      status |= 0x01;
    }
    if (this.channel2.isEnabled()) {
      status |= 0x02;
    }
    if (this.channel3.isEnabled()) {
      status |= 0x04;
    }
    if (this.channel4.isEnabled()) {
      status |= 0x08;
    }
    return status & 0xff;
  }

  private writeNr52(value: number): void {
    const nextEnabled = (value & 0x80) !== 0;

    if (!nextEnabled) {
      this.masterEnabled = false;
      this.nr50 = 0;
      this.nr51 = 0;
      this.frameSequencerCycles = 0;
      this.frameSequencerStep = 0;
      this.channel1.reset();
      this.channel2.reset();
      this.channel3.reset();
      this.channel4.reset();
      return;
    }

    if (!this.masterEnabled) {
      this.masterEnabled = true;
      this.frameSequencerCycles = 0;
      this.frameSequencerStep = 0;
    }
  }
}
