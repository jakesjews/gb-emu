import { describe, expect, it } from 'vitest';
import { Joypad } from '../../src/core/input/Joypad';
import { InterruptController } from '../../src/core/interrupts/InterruptController';

describe('Joypad register behavior', () => {
  it('reports correct selection bits for JOYP', () => {
    const interrupts = new InterruptController();
    const joypad = new Joypad(interrupts);

    joypad.reset();
    expect(joypad.read() & 0x30).toBe(0x30);

    joypad.write(0x20);
    expect(joypad.read() & 0x30).toBe(0x20);

    joypad.write(0x10);
    expect(joypad.read() & 0x30).toBe(0x10);

    joypad.write(0x00);
    expect(joypad.read() & 0x30).toBe(0x00);
  });

  it('returns active-low button state for selected group', () => {
    const interrupts = new InterruptController();
    const joypad = new Joypad(interrupts);
    joypad.reset();

    joypad.setButtonState('start', true);
    joypad.write(0x10);
    expect(joypad.read() & 0x0f).toBe(0x07);

    joypad.setButtonState('right', true);
    joypad.write(0x20);
    expect(joypad.read() & 0x0f).toBe(0x0e);
  });
});
