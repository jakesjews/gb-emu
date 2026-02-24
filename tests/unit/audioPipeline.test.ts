import { describe, expect, it } from 'vitest';
import { APU } from '../../src/core/apu/APU';
import { AudioPipeline } from '../../src/runtime/audio/AudioOutput';

function setupPulseScript(apu: APU): void {
  apu.write(0xff26, 0x80);
  apu.write(0xff24, 0x77);
  apu.write(0xff25, 0x22);
  apu.write(0xff16, 0x80);
  apu.write(0xff17, 0xf0);
  apu.write(0xff18, 0x00);
  apu.write(0xff19, 0x87);
}

function generateDeterministicSlice(): Float32Array {
  const apu = new APU();
  const pipeline = new AudioPipeline(32_768);
  setupPulseScript(apu);

  for (let i = 0; i < 6; i += 1) {
    apu.tick(12_288);
    pipeline.push(apu.drainSamples(1024));
  }

  return pipeline.popFixed(256);
}

describe('AudioPipeline', () => {
  it('produces deterministic samples from a fixed APU script', () => {
    const first = generateDeterministicSlice();
    const second = generateDeterministicSlice();

    expect(Array.from(first)).toEqual(Array.from(second));

    let magnitude = 0;
    for (let i = 0; i < first.length; i += 1) {
      magnitude += Math.abs(first[i]);
    }

    expect(magnitude).toBeGreaterThan(1);
  });

  it('tracks FIFO buffering and drop behavior', () => {
    const pipeline = new AudioPipeline(4);
    const sourceA = new Float32Array([0.1, -0.1, 0.2, -0.2, 0.3, -0.3]);
    pipeline.push(sourceA);

    expect(pipeline.getBufferedFrames()).toBe(3);
    const chunk = pipeline.popAvailable(2);
    expect(chunk.length).toBe(4);
    expect(pipeline.getBufferedFrames()).toBe(1);

    const sourceB = new Float32Array([1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6]);
    pipeline.push(sourceB);

    expect(pipeline.getBufferedFrames()).toBe(4);
    expect(pipeline.getDroppedFrames()).toBeGreaterThan(0);
  });

  it('accounts underruns when fixed-size reads exceed buffered audio', () => {
    const pipeline = new AudioPipeline(8);

    const silence = pipeline.popFixed(5);
    expect(silence.length).toBe(10);
    expect(pipeline.getUnderruns()).toBe(5);

    pipeline.push(new Float32Array([0.25, -0.25, 0.5, -0.5])); // 2 frames
    const partial = pipeline.popFixed(6);
    expect(partial.length).toBe(12);
    expect(pipeline.getUnderruns()).toBe(9);
  });
});
