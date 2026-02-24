import { describe, expect, it } from 'vitest';
import { APU } from '../../src/core/apu/APU';

function hasNonZero(samples: Float32Array): boolean {
  for (let i = 0; i < samples.length; i += 1) {
    if (Math.abs(samples[i]) > 1e-6) {
      return true;
    }
  }

  return false;
}

function setupPulse2(apu: APU): void {
  apu.write(0xff26, 0x80);
  apu.write(0xff24, 0x77);
  apu.write(0xff25, 0x22); // CH2 -> both sides
  apu.write(0xff16, 0x80);
  apu.write(0xff17, 0xf0);
  apu.write(0xff18, 0x00);
  apu.write(0xff19, 0x87);
}

describe('APU', () => {
  it('advances frame sequencer on 512 Hz cadence', () => {
    const apu = new APU();
    apu.write(0xff26, 0x80);

    expect(apu.getDebugState().frameSequencerStep).toBe(0);
    apu.tick(8_192);
    expect(apu.getDebugState().frameSequencerStep).toBe(1);

    apu.tick(8_192 * 7);
    expect(apu.getDebugState().frameSequencerStep).toBe(0);
  });

  it('clears channels and mixer registers when NR52 disables master sound', () => {
    const apu = new APU();
    setupPulse2(apu);

    expect((apu.read(0xff26) & 0x02) !== 0).toBe(true);

    apu.write(0xff26, 0x00);

    expect(apu.read(0xff26) & 0x80).toBe(0);
    expect(apu.read(0xff26) & 0x0f).toBe(0);
    expect(apu.read(0xff24)).toBe(0);
    expect(apu.read(0xff25)).toBe(0);
  });

  it('handles CH1 sweep overflow by disabling the channel', () => {
    const apu = new APU();
    apu.write(0xff26, 0x80);
    apu.write(0xff24, 0x77);
    apu.write(0xff25, 0x11); // CH1 both sides

    apu.write(0xff10, 0x11); // sweep: period=1, shift=1, add
    apu.write(0xff11, 0x80);
    apu.write(0xff12, 0xf0);
    apu.write(0xff13, 0xff);
    apu.write(0xff14, 0x83); // frequency 1023 with trigger

    expect((apu.read(0xff26) & 0x01) !== 0).toBe(true);

    apu.tick(8_192 * 7); // advance through two sweep clocks (steps 2 and 6)

    expect((apu.read(0xff26) & 0x01) !== 0).toBe(false);
  });

  it('produces CH3 wave output with configured volume code', () => {
    const apu = new APU();
    apu.write(0xff26, 0x80);
    apu.write(0xff24, 0x77);
    apu.write(0xff25, 0x44); // CH3 both sides

    apu.write(0xff30, 0xf0);
    apu.write(0xff31, 0x0f);
    apu.write(0xff1a, 0x80);
    apu.write(0xff1b, 0x00);
    apu.write(0xff1c, 0x20); // volume code 1 (100%)
    apu.write(0xff1d, 0x00);
    apu.write(0xff1e, 0x87);

    apu.tick(32_768);
    const samples = apu.drainSamples(256);

    expect(samples.length).toBeGreaterThan(0);
    expect(hasNonZero(samples)).toBe(true);
  });

  it('changes CH4 noise stream when width mode toggles', () => {
    const makeNoise = (widthMode7Bit: boolean): Float32Array => {
      const apu = new APU();
      apu.write(0xff26, 0x80);
      apu.write(0xff24, 0x77);
      apu.write(0xff25, 0x88); // CH4 both sides
      apu.write(0xff21, 0xf0);
      apu.write(0xff22, widthMode7Bit ? 0x09 : 0x01);
      apu.write(0xff23, 0x80);
      apu.tick(65_536);
      return apu.drainSamples(256);
    };

    const wide = makeNoise(false);
    const narrow = makeNoise(true);

    expect(wide.length).toBe(narrow.length);
    expect(Array.from(wide)).not.toEqual(Array.from(narrow));
  });

  it('routes channels through NR50/NR51 deterministically', () => {
    const apu = new APU();
    setupPulse2(apu);

    apu.write(0xff25, 0x02); // CH2 right only
    apu.tick(32_768);
    const rightOnly = apu.drainSamples(256);

    let hasRight = false;
    let hasLeft = false;
    for (let i = 0; i < rightOnly.length; i += 2) {
      if (Math.abs(rightOnly[i]) > 1e-6) {
        hasLeft = true;
      }
      if (Math.abs(rightOnly[i + 1]) > 1e-6) {
        hasRight = true;
      }
    }

    expect(hasLeft).toBe(false);
    expect(hasRight).toBe(true);

    apu.write(0xff25, 0x20); // CH2 left only
    apu.drainSamples(apu.getBufferedFrames());
    apu.tick(32_768);
    const leftOnly = apu.drainSamples(256);

    hasRight = false;
    hasLeft = false;
    for (let i = 0; i < leftOnly.length; i += 2) {
      if (Math.abs(leftOnly[i]) > 1e-6) {
        hasLeft = true;
      }
      if (Math.abs(leftOnly[i + 1]) > 1e-6) {
        hasRight = true;
      }
    }

    expect(hasLeft).toBe(true);
    expect(hasRight).toBe(false);
  });
});
