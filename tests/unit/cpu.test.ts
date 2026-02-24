import { describe, expect, it } from 'vitest';
import { GameBoy } from '../../src/core/system/GameBoy';

function buildRom(program: number[]): Uint8Array {
  const rom = new Uint8Array(0x8000);
  rom[0x0147] = 0x00;
  rom[0x0148] = 0x00;
  rom[0x0149] = 0x00;

  for (let i = 0; i < program.length; i += 1) {
    rom[0x0100 + i] = program[i] & 0xff;
  }

  return rom;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}

describe('CPU arithmetic and control flow', () => {
  it('does not advance without a loaded ROM', () => {
    const gb = new GameBoy();
    const cycles = gb.stepInstruction();
    const snapshot = gb.getDebugSnapshot();
    expect(cycles).toBe(0);
    expect(snapshot.cycles).toBe(0);
  });

  it('sets flags correctly for ADD and SUB', async () => {
    const gb = new GameBoy();
    const rom = buildRom([
      0x3e,
      0x0f, // LD A,0x0F
      0xc6,
      0x01, // ADD A,0x01 => A=0x10, H=1
      0xd6,
      0x10, // SUB 0x10 => A=0x00, Z=1, N=1
      0x76, // HALT
    ]);

    await gb.loadRom(toArrayBuffer(rom));

    gb.stepInstruction();
    gb.stepInstruction();

    let snapshot = gb.getDebugSnapshot();
    expect(snapshot.af >> 8).toBe(0x10);
    expect(snapshot.af & 0xff & 0x20).toBe(0x20);

    gb.stepInstruction();
    snapshot = gb.getDebugSnapshot();
    expect(snapshot.af >> 8).toBe(0x00);
    expect(snapshot.af & 0xff & 0x80).toBe(0x80);
    expect(snapshot.af & 0xff & 0x40).toBe(0x40);
  });

  it('handles CALL and RET', async () => {
    const gb = new GameBoy();
    const rom = buildRom([
      0xcd,
      0x07,
      0x01, // CALL 0x0107
      0x3e,
      0x01, // LD A,0x01
      0x76, // HALT
      0x3e,
      0x55, // LD A,0x55
      0xc9, // RET
    ]);

    await gb.loadRom(toArrayBuffer(rom));

    gb.stepInstruction();
    gb.stepInstruction();
    gb.stepInstruction();

    const snapshot = gb.getDebugSnapshot();
    expect(snapshot.af >> 8).toBe(0x01);
  });

  it('enables IME one instruction after EI', async () => {
    const gb = new GameBoy();
    const rom = buildRom([
      0x3e,
      0x01, // LD A,0x01
      0xea,
      0xff,
      0xff, // LD (0xFFFF),A ; IE = VBlank
      0xea,
      0x0f,
      0xff, // LD (0xFF0F),A ; IF = VBlank (pending)
      0xfb, // EI
      0x00, // NOP (instruction after EI)
      0x00, // NOP (should be preempted by interrupt dispatch)
    ]);
    rom[0x0040] = 0xd9; // RETI

    await gb.loadRom(toArrayBuffer(rom));

    gb.stepInstruction(); // LD A,0x01
    gb.stepInstruction(); // LD (0xFFFF),A
    gb.stepInstruction(); // LD (0xFF0F),A
    gb.stepInstruction(); // EI

    let snapshot = gb.getDebugSnapshot();
    expect(snapshot.ime).toBe(false);

    gb.stepInstruction(); // NOP after EI
    snapshot = gb.getDebugSnapshot();
    expect(snapshot.pc).toBe(0x010a);

    gb.stepInstruction(); // Interrupt dispatch
    snapshot = gb.getDebugSnapshot();
    expect(snapshot.pc).toBe(0x0040);
    expect(snapshot.ime).toBe(false);
  });

  it('DI immediately disables IME and cancels pending EI', async () => {
    const gb = new GameBoy();
    const rom = buildRom([
      0x3e,
      0x01, // LD A,0x01
      0xea,
      0xff,
      0xff, // LD (0xFFFF),A ; IE = VBlank
      0xea,
      0x0f,
      0xff, // LD (0xFF0F),A ; IF = VBlank (pending)
      0xfb, // EI (delayed)
      0xf3, // DI (should cancel delayed EI before it applies)
      0x00, // NOP (must execute without interrupt dispatch)
      0x76, // HALT
    ]);
    rom[0x0040] = 0xd9; // RETI

    await gb.loadRom(toArrayBuffer(rom));

    gb.stepInstruction();
    gb.stepInstruction();
    gb.stepInstruction();
    gb.stepInstruction(); // EI
    gb.stepInstruction(); // DI
    gb.stepInstruction(); // NOP

    const snapshot = gb.getDebugSnapshot();
    expect(snapshot.pc).toBe(0x010b);
    expect(snapshot.ime).toBe(false);
  });

  it('does not restart EI delay when EI is executed repeatedly', async () => {
    const gb = new GameBoy();
    const rom = buildRom([
      0x3e,
      0x01, // LD A,0x01
      0xea,
      0xff,
      0xff, // LD (0xFFFF),A ; IE = VBlank
      0xea,
      0x0f,
      0xff, // LD (0xFF0F),A ; IF = VBlank (pending)
      0xfb, // EI (arms delayed enable)
      0xfb, // EI (must not restart delay)
      0x00, // NOP (should be preempted by interrupt dispatch)
    ]);
    rom[0x0040] = 0xd9; // RETI

    await gb.loadRom(toArrayBuffer(rom));

    gb.stepInstruction();
    gb.stepInstruction();
    gb.stepInstruction();
    gb.stepInstruction(); // EI #1
    gb.stepInstruction(); // EI #2
    gb.stepInstruction(); // Interrupt dispatch

    const snapshot = gb.getDebugSnapshot();
    expect(snapshot.pc).toBe(0x0040);
  });
});
