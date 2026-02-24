class GBAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    this.queue = [];
    this.chunkOffset = 0;
    this.availableFrames = 0;

    this.port.onmessage = (event) => {
      const payload = event.data;
      if (!payload || payload.type !== 'push') {
        return;
      }

      if (!(payload.samples instanceof Float32Array) || payload.samples.length < 2) {
        return;
      }

      this.queue.push(payload.samples);
      this.availableFrames += Math.floor(payload.samples.length / 2);
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    const left = output[0];
    const right = output[1] || output[0];

    let underrunFrames = 0;
    for (let i = 0; i < left.length; i += 1) {
      const frame = this.pullFrame();
      if (frame) {
        left[i] = frame[0];
        right[i] = frame[1];
      } else {
        left[i] = 0;
        right[i] = 0;
        underrunFrames += 1;
      }
    }

    if (underrunFrames > 0) {
      this.port.postMessage({ type: 'underrun', frames: underrunFrames });
    }

    if (this.availableFrames < 2048) {
      this.port.postMessage({ type: 'need-data' });
    }

    return true;
  }

  pullFrame() {
    if (this.availableFrames <= 0 || this.queue.length === 0) {
      return null;
    }

    let chunk = this.queue[0];
    if (this.chunkOffset >= chunk.length) {
      this.queue.shift();
      this.chunkOffset = 0;
      if (this.queue.length === 0) {
        this.availableFrames = 0;
        return null;
      }
      chunk = this.queue[0];
    }

    const left = chunk[this.chunkOffset] || 0;
    const right = chunk[this.chunkOffset + 1] || 0;
    this.chunkOffset += 2;

    if (this.chunkOffset >= chunk.length) {
      this.queue.shift();
      this.chunkOffset = 0;
    }

    this.availableFrames -= 1;
    return [left, right];
  }
}

registerProcessor('gb-audio-processor', GBAudioProcessor);
