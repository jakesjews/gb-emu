import { describe, expect, it } from 'vitest';
import { InterruptController, InterruptFlag } from '../../src/core/interrupts/InterruptController';
import { Serial } from '../../src/core/serial/Serial';

describe('Serial', () => {
  it('completes internal-clock transfers, raises interrupt, and returns 0xFF receive byte', () => {
    const interrupts = new InterruptController();
    const serial = new Serial(interrupts);
    serial.reset();

    serial.writeSB(0x29);
    serial.writeSC(0x81);
    serial.tick(4095);
    expect(serial.readSB()).toBe(0x29);

    serial.tick(1);
    expect((serial.readSC() & 0x80) === 0).toBe(true);
    expect(serial.readSB()).toBe(0xff);
    expect(serial.getOutputAsString()).toBe(')');
    expect((interrupts.readIF() & InterruptFlag.Serial) !== 0).toBe(true);
  });

  it('does not auto-complete transfers in external-clock mode', () => {
    const interrupts = new InterruptController();
    const serial = new Serial(interrupts);
    serial.reset();

    serial.writeSB(0x55);
    serial.writeSC(0x80);
    serial.tick(20_000);

    expect((serial.readSC() & 0x80) !== 0).toBe(true);
    expect(serial.readSB()).toBe(0x55);
    expect(serial.getOutputAsString()).toBe('');
    expect((interrupts.readIF() & InterruptFlag.Serial) === 0).toBe(true);
  });
});
