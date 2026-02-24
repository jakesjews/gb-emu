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

  it('cancels delayed reload when TIMA is written during pending reload window', () => {
    const interrupts = new InterruptController();
    const timer = new Timer(interrupts);
    timer.reset();

    timer.writeTAC(0b101); // enable, input clock using divider bit 3
    timer.writeTIMA(0xff);
    timer.writeTMA(0x44);

    timer.tick(16); // overflow -> TIMA becomes 0x00, reload pending
    expect(timer.readTIMA()).toBe(0x00);
    expect(timer.isReloadPending()).toBe(true);

    timer.writeTIMA(0x99); // cancel delayed reload
    timer.tick(4);

    expect(timer.readTIMA()).toBe(0x99);
    expect(timer.isReloadPending()).toBe(false);
    expect((interrupts.readIF() & InterruptFlag.Timer) !== 0).toBe(false);
  });

  it('applies TMA writes and ignores TIMA writes during reload cycle', () => {
    const interrupts = new InterruptController();
    const timer = new Timer(interrupts);
    timer.reset();

    timer.writeTAC(0b101); // enable, input clock using divider bit 3
    timer.writeTIMA(0xff);
    timer.writeTMA(0x77);

    timer.tick(16); // overflow -> pending reload
    timer.tick(4); // reload cycle -> TIMA = TMA
    expect(timer.readTIMA()).toBe(0x77);
    expect((interrupts.readIF() & InterruptFlag.Timer) !== 0).toBe(true);

    timer.writeTIMA(0x12); // ignored during reload cycle
    expect(timer.readTIMA()).toBe(0x77);

    timer.writeTMA(0x42); // propagated into TIMA during reload cycle
    expect(timer.readTIMA()).toBe(0x42);
  });
});
