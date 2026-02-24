import { describe, expect, it } from 'vitest';
import { InterruptController } from '../../src/core/interrupts/InterruptController';
import { PPU } from '../../src/core/ppu/PPU';

function mode(ppu: PPU): number {
  return ppu.getSTAT() & 0x03;
}

describe('PPU mode timing', () => {
  it('transitions from mode 2 to mode 3 after 80 cycles', () => {
    const interrupts = new InterruptController();
    const ppu = new PPU(interrupts);
    ppu.reset();

    expect(mode(ppu)).toBe(2);
    ppu.tick(79);
    expect(mode(ppu)).toBe(2);
    ppu.tick(1);
    expect(mode(ppu)).toBe(3);
  });

  it('transitions from mode 3 to mode 0 after 172 cycles', () => {
    const interrupts = new InterruptController();
    const ppu = new PPU(interrupts);
    ppu.reset();

    ppu.tick(80);
    expect(mode(ppu)).toBe(3);
    ppu.tick(171);
    expect(mode(ppu)).toBe(3);
    ppu.tick(1);
    expect(mode(ppu)).toBe(0);
  });

  it('delays OAM blocking transition by one cycle at the next-line mode-2 entry', () => {
    const interrupts = new InterruptController();
    const ppu = new PPU(interrupts);
    ppu.reset();

    expect(mode(ppu)).toBe(2);
    expect(ppu.canReadOAM()).toBe(false);

    ppu.tick(80);
    expect(mode(ppu)).toBe(3);
    expect(ppu.canReadOAM()).toBe(false);

    ppu.tick(172);
    expect(mode(ppu)).toBe(0);
    expect(ppu.canReadOAM()).toBe(true);

    ppu.tick(203);
    expect(mode(ppu)).toBe(0);
    expect(ppu.canReadOAM()).toBe(true);

    ppu.tick(1);
    expect(mode(ppu)).toBe(0);
    expect(ppu.canReadOAM()).toBe(false);

    ppu.tick(1);
    expect(mode(ppu)).toBe(2);
    expect(ppu.canReadOAM()).toBe(false);
  });
});
