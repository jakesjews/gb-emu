import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GameBoy } from '../../src/core/system/GameBoy';
import { createCompatResult, toArrayBuffer, type CompatResult } from './compatTypes';

const ROM_DIR = process.env.GB_MOONEYE_ROM_DIR ?? path.resolve(process.cwd(), 'tests/roms/mooneye');

interface MooneyeCase {
  romName: string;
  maxCycles: number;
}

const DEFAULT_MAX_CYCLES = 120_000_000;

const TIER1_CASES: ReadonlyArray<MooneyeCase> = [
  { romName: 'acceptance/interrupts/ie_push.gb', maxCycles: DEFAULT_MAX_CYCLES },
  { romName: 'acceptance/timer/tima_reload.gb', maxCycles: DEFAULT_MAX_CYCLES },
  { romName: 'acceptance/oam_dma/basic.gb', maxCycles: DEFAULT_MAX_CYCLES },
  { romName: 'acceptance/oam_dma_timing.gb', maxCycles: DEFAULT_MAX_CYCLES },
  { romName: 'acceptance/ppu/vblank_stat_intr-GS.gb', maxCycles: DEFAULT_MAX_CYCLES },
  { romName: 'acceptance/ppu/stat_lyc_onoff.gb', maxCycles: DEFAULT_MAX_CYCLES },
  { romName: 'acceptance/ppu/lcdon_timing-GS.gb', maxCycles: DEFAULT_MAX_CYCLES },
];

const TIER2_CASES: ReadonlyArray<MooneyeCase> = [
  { romName: 'acceptance/interrupts/ie_push.gb', maxCycles: DEFAULT_MAX_CYCLES },
  { romName: 'acceptance/interrupts/if_ie_registers.gb', maxCycles: DEFAULT_MAX_CYCLES },
  { romName: 'acceptance/di_timing-GS.gb', maxCycles: DEFAULT_MAX_CYCLES },
  { romName: 'acceptance/ei_sequence.gb', maxCycles: DEFAULT_MAX_CYCLES },
  { romName: 'acceptance/rapid_di_ei.gb', maxCycles: DEFAULT_MAX_CYCLES },
  { romName: 'acceptance/halt_ime0_ei.gb', maxCycles: DEFAULT_MAX_CYCLES },
  { romName: 'acceptance/timer/tima_reload.gb', maxCycles: DEFAULT_MAX_CYCLES },
  { romName: 'acceptance/timer/tima_write_reloading.gb', maxCycles: DEFAULT_MAX_CYCLES },
  { romName: 'acceptance/timer/tma_write_reloading.gb', maxCycles: DEFAULT_MAX_CYCLES },
  { romName: 'acceptance/timer/div_write.gb', maxCycles: DEFAULT_MAX_CYCLES },
  { romName: 'acceptance/timer/rapid_toggle.gb', maxCycles: DEFAULT_MAX_CYCLES },
  { romName: 'acceptance/timer/tim00_div_trigger.gb', maxCycles: DEFAULT_MAX_CYCLES },
  { romName: 'acceptance/oam_dma/basic.gb', maxCycles: DEFAULT_MAX_CYCLES },
  { romName: 'acceptance/oam_dma_timing.gb', maxCycles: DEFAULT_MAX_CYCLES },
  { romName: 'acceptance/oam_dma/reg_read.gb', maxCycles: DEFAULT_MAX_CYCLES },
  { romName: 'acceptance/ppu/vblank_stat_intr-GS.gb', maxCycles: DEFAULT_MAX_CYCLES },
  { romName: 'acceptance/ppu/stat_lyc_onoff.gb', maxCycles: DEFAULT_MAX_CYCLES },
  { romName: 'acceptance/ppu/lcdon_timing-GS.gb', maxCycles: DEFAULT_MAX_CYCLES },
  { romName: 'acceptance/ppu/lcdon_write_timing-GS.gb', maxCycles: DEFAULT_MAX_CYCLES },
  { romName: 'acceptance/ppu/stat_irq_blocking.gb', maxCycles: DEFAULT_MAX_CYCLES },
];

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

async function runMooneyeCase(testCase: MooneyeCase): Promise<CompatResult> {
  const romPath = path.join(ROM_DIR, testCase.romName);
  const gb = new GameBoy();
  const rom = readFileSync(romPath);
  await gb.loadRom(toArrayBuffer(rom));

  let cycles = 0;
  while (cycles < testCase.maxCycles) {
    cycles += gb.stepInstruction();
    const snapshot = gb.getDebugSnapshot();
    const tuple = tupleFromSnapshot(snapshot);
    const tupleIsPass = isTupleEqual(tuple, PASS_REGS);
    const tupleIsFail = isTupleEqual(tuple, FAIL_REGS);

    // Mooneye reports a verdict at LD B,B, then later enters an infinite JR loop.
    if (snapshot.opcode === 0x40 && (tupleIsPass || tupleIsFail)) {
      const status = tupleIsPass ? 'pass' : 'fail';
      return createCompatResult(testCase.romName, status, cycles, snapshot, gb.getSerialOutput());
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
        testCase.romName,
        status,
        cycles + settleCycles,
        gb.getDebugSnapshot(),
        gb.getSerialOutput(),
      );
    }
  }

  return createCompatResult(
    testCase.romName,
    'timeout',
    cycles,
    gb.getDebugSnapshot(),
    gb.getSerialOutput(),
  );
}

describe('mooneye DMG tier-1 compatibility', () => {
  for (const testCase of TIER1_CASES) {
    const romPath = path.join(ROM_DIR, testCase.romName);
    const run = existsSync(romPath) ? it : it.skip;

    run(
      testCase.romName,
      async () => {
        const result = await runMooneyeCase(testCase);
        const detail = `${result.name} status=${result.status} cycles=${result.cycles} pc=0x${result.pc.toString(16)} op=0x${result.opcode.toString(16)} bc=0x${result.bc.toString(16)} de=0x${result.de.toString(16)} hl=0x${result.hl.toString(16)} serialTail=${JSON.stringify(result.serialTail)}`;
        expect(result.status, detail).toBe('pass');
      },
      120_000,
    );
  }
});

describe('mooneye DMG tier-2 compatibility', () => {
  for (const testCase of TIER2_CASES) {
    const romPath = path.join(ROM_DIR, testCase.romName);
    const run = existsSync(romPath) ? it : it.skip;

    run(
      testCase.romName,
      async () => {
        const result = await runMooneyeCase(testCase);
        const detail = `${result.name} status=${result.status} cycles=${result.cycles} pc=0x${result.pc.toString(16)} op=0x${result.opcode.toString(16)} bc=0x${result.bc.toString(16)} de=0x${result.de.toString(16)} hl=0x${result.hl.toString(16)} serialTail=${JSON.stringify(result.serialTail)}`;
        expect(result.status, detail).toBe('pass');
      },
      120_000,
    );
  }
});
