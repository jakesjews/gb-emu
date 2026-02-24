export interface DequeueFixedResult {
  samples: Float32Array;
  framesRead: number;
}

export class SampleBuffer {
  private readonly capacityFrames: number;

  private readonly data: Float32Array;

  private readIndex = 0;

  private writeIndex = 0;

  private bufferedFrames = 0;

  private droppedFrames = 0;

  public constructor(capacityFrames: number) {
    this.capacityFrames = Math.max(1, Math.floor(capacityFrames));
    this.data = new Float32Array(this.capacityFrames * 2);
  }

  public clear(): void {
    this.readIndex = 0;
    this.writeIndex = 0;
    this.bufferedFrames = 0;
    this.droppedFrames = 0;
  }

  public enqueue(interleavedStereo: Float32Array): number {
    const totalFrames = Math.floor(interleavedStereo.length / 2);
    if (totalFrames <= 0) {
      return 0;
    }

    let sourceStartFrame = 0;
    let framesToCopy = totalFrames;
    if (framesToCopy > this.capacityFrames) {
      sourceStartFrame = framesToCopy - this.capacityFrames;
      this.droppedFrames += sourceStartFrame;
      framesToCopy = this.capacityFrames;
    }

    const overflow = Math.max(0, this.bufferedFrames + framesToCopy - this.capacityFrames);
    if (overflow > 0) {
      this.readIndex = (this.readIndex + overflow) % this.capacityFrames;
      this.bufferedFrames -= overflow;
      this.droppedFrames += overflow;
    }

    for (let i = 0; i < framesToCopy; i += 1) {
      const source = (sourceStartFrame + i) * 2;
      const target = this.writeIndex * 2;
      this.data[target] = interleavedStereo[source];
      this.data[target + 1] = interleavedStereo[source + 1];
      this.writeIndex = (this.writeIndex + 1) % this.capacityFrames;
    }

    this.bufferedFrames += framesToCopy;
    return framesToCopy;
  }

  public dequeue(frameCount: number): Float32Array {
    const targetFrames = Math.max(0, Math.floor(frameCount));
    if (targetFrames <= 0 || this.bufferedFrames <= 0) {
      return new Float32Array(0);
    }

    const frames = Math.min(targetFrames, this.bufferedFrames);
    const output = new Float32Array(frames * 2);

    for (let i = 0; i < frames; i += 1) {
      const source = this.readIndex * 2;
      const target = i * 2;
      output[target] = this.data[source];
      output[target + 1] = this.data[source + 1];
      this.readIndex = (this.readIndex + 1) % this.capacityFrames;
    }

    this.bufferedFrames -= frames;
    return output;
  }

  public dequeueFixed(frameCount: number): DequeueFixedResult {
    const targetFrames = Math.max(0, Math.floor(frameCount));
    const output = new Float32Array(targetFrames * 2);
    if (targetFrames <= 0 || this.bufferedFrames <= 0) {
      return { samples: output, framesRead: 0 };
    }

    const frames = Math.min(targetFrames, this.bufferedFrames);
    for (let i = 0; i < frames; i += 1) {
      const source = this.readIndex * 2;
      const target = i * 2;
      output[target] = this.data[source];
      output[target + 1] = this.data[source + 1];
      this.readIndex = (this.readIndex + 1) % this.capacityFrames;
    }

    this.bufferedFrames -= frames;
    return { samples: output, framesRead: frames };
  }

  public getBufferedFrames(): number {
    return this.bufferedFrames;
  }

  public getDroppedFrames(): number {
    return this.droppedFrames;
  }

  public getCapacityFrames(): number {
    return this.capacityFrames;
  }
}
