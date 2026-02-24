import { describe, expect, it } from 'vitest';
import { InterruptController, InterruptFlag } from '../../src/core/interrupts/InterruptController';
import { Timer } from '../../src/core/timer/Timer';

describe('Timer', () => {
  it('increments TIMA when enabled and raises interrupt on overflow', () => {
    const interrupts = new InterruptController();
    const timer = new Timer(interrupts);
    timer.reset();

    timer.writeTAC(0b101); // enable, input clock using divider bit 3
    timer.writeTIMA(0xfe);
    timer.writeTMA(0x77);

    timer.tick(16);
    expect(timer.readTIMA()).toBe(0xff);

    timer.tick(16);
    expect(timer.readTIMA()).toBe(0x00);
    timer.tick(4);
    expect(timer.readTIMA()).toBe(0x77);
    expect((interrupts.readIF() & InterruptFlag.Timer) !== 0).toBe(true);
  });

  it('resets DIV when writing DIV', () => {
    const interrupts = new InterruptController();
    const timer = new Timer(interrupts);
    timer.tick(1000);
    expect(timer.readDIV()).not.toBe(0);

    timer.writeDIV();
    expect(timer.readDIV()).toBe(0);
  });
});
