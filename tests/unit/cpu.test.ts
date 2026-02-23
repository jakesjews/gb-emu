import { describe, expect, it } from 'vitest';
import { GameBoy } from '../../src/core/system/GameBoy';

function buildRom(program: number[]): ArrayBuffer {
  const rom = new Uint8Array(0x8000);
  rom[0x0147] = 0x00;
  rom[0x0148] = 0x00;
  rom[0x0149] = 0x00;

  for (let i = 0; i < program.length; i += 1) {
    rom[0x0100 + i] = program[i] & 0xff;
  }

  return rom.buffer;
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
      0x3e, 0x0f, // LD A,0x0F
      0xc6, 0x01, // ADD A,0x01 => A=0x10, H=1
      0xd6, 0x10, // SUB 0x10 => A=0x00, Z=1, N=1
      0x76, // HALT
    ]);

    await gb.loadRom(rom);

    gb.stepInstruction();
    gb.stepInstruction();

    let snapshot = gb.getDebugSnapshot();
    expect(snapshot.af >> 8).toBe(0x10);
    expect((snapshot.af & 0xff) & 0x20).toBe(0x20);

    gb.stepInstruction();
    snapshot = gb.getDebugSnapshot();
    expect(snapshot.af >> 8).toBe(0x00);
    expect((snapshot.af & 0xff) & 0x80).toBe(0x80);
    expect((snapshot.af & 0xff) & 0x40).toBe(0x40);
  });

  it('handles CALL and RET', async () => {
    const gb = new GameBoy();
    const rom = buildRom([
      0xcd, 0x07, 0x01, // CALL 0x0107
      0x3e, 0x01, // LD A,0x01
      0x76, // HALT
      0x3e, 0x55, // LD A,0x55
      0xc9, // RET
    ]);

    await gb.loadRom(rom);

    gb.stepInstruction();
    gb.stepInstruction();
    gb.stepInstruction();

    const snapshot = gb.getDebugSnapshot();
    expect(snapshot.af >> 8).toBe(0x01);
  });
});
