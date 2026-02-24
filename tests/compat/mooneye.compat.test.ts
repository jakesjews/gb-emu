import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GameBoy } from '../../src/core/system/GameBoy';
import { createCompatResult, toArrayBuffer, type CompatResult } from './compatTypes';

const ROM_DIR = process.env.GB_MOONEYE_ROM_DIR ?? path.resolve(process.cwd(), 'tests/roms/mooneye');

const TIER1_CASES: ReadonlyArray<string> = [
  'acceptance/interrupts/ie_push.gb',
  'acceptance/timer/tima_reload.gb',
  'acceptance/oam_dma/basic.gb',
  'acceptance/oam_dma_timing.gb',
  'acceptance/ppu/vblank_stat_intr-GS.gb',
  'acceptance/ppu/stat_lyc_onoff.gb',
  'acceptance/ppu/lcdon_timing-GS.gb',
];

const MAX_CYCLES = 120_000_000;
const PASS_REGS = [0x03, 0x05, 0x08, 0x0d, 0x15, 0x22] as const;
const FAIL_REGS = [0x42, 0x42, 0x42, 0x42, 0x42, 0x42] as const;

function tupleFromSnapshot(
  snapshot: ReturnType<GameBoy['getDebugSnapshot']>,
): [number, number, number, number, number, number] {
  return [
    (snapshot.bc >> 8) & 0xff,
    snapshot.bc & 0xff,
    (snapshot.de >> 8) & 0xff,
    snapshot.de & 0xff,
    (snapshot.hl >> 8) & 0xff,
    snapshot.hl & 0xff,
  ];
}

function isTupleEqual(tuple: ReadonlyArray<number>, target: ReadonlyArray<number>): boolean {
  return tuple.length === target.length && tuple.every((value, index) => value === target[index]);
}

async function runMooneyeCase(romPath: string): Promise<CompatResult> {
  const gb = new GameBoy();
  const rom = readFileSync(romPath);
  await gb.loadRom(toArrayBuffer(rom));

  let cycles = 0;
  while (cycles < MAX_CYCLES) {
    cycles += gb.stepInstruction();
    const snapshot = gb.getDebugSnapshot();
    const tuple = tupleFromSnapshot(snapshot);
    const tupleIsPass = isTupleEqual(tuple, PASS_REGS);
    const tupleIsFail = isTupleEqual(tuple, FAIL_REGS);

    // Mooneye reports a verdict at LD B,B, then later enters an infinite JR loop.
    if (snapshot.opcode === 0x40 && (tupleIsPass || tupleIsFail)) {
      const status = tupleIsPass ? 'pass' : 'fail';
      return createCompatResult(
        path.basename(romPath),
        status,
        cycles,
        snapshot,
        gb.getSerialOutput(),
      );
    }

    if (snapshot.opcode === 0x18 && (tupleIsPass || tupleIsFail)) {
      const stablePc = snapshot.pc;
      let stable = true;
      let settleCycles = 0;
      while (settleCycles < 256) {
        settleCycles += gb.stepInstruction();
        const next = gb.getDebugSnapshot();
        if (next.opcode !== 0x18 || next.pc !== stablePc) {
          stable = false;
          break;
        }
      }

      if (!stable) {
        continue;
      }

      const status = tupleIsPass ? 'pass' : 'fail';
      return createCompatResult(
        path.basename(romPath),
        status,
        cycles + settleCycles,
        gb.getDebugSnapshot(),
        gb.getSerialOutput(),
      );
    }
  }

  return createCompatResult(
    path.basename(romPath),
    'timeout',
    cycles,
    gb.getDebugSnapshot(),
    gb.getSerialOutput(),
  );
}

describe('mooneye DMG tier-1 compatibility', () => {
  for (const romName of TIER1_CASES) {
    const romPath = path.join(ROM_DIR, romName);
    const run = existsSync(romPath) ? it : it.skip;

    run(
      romName,
      async () => {
        const result = await runMooneyeCase(romPath);
        const detail = `${result.name} status=${result.status} cycles=${result.cycles} pc=0x${result.pc.toString(16)} op=0x${result.opcode.toString(16)} bc=0x${result.bc.toString(16)} de=0x${result.de.toString(16)} hl=0x${result.hl.toString(16)} serialTail=${JSON.stringify(result.serialTail)}`;
        expect(result.status, detail).toBe('pass');
      },
      120_000,
    );
  }
});
