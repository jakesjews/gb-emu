import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { GameBoy } from '../../src/core/system/GameBoy';
import { createCompatResult, toArrayBuffer, type CompatResult } from './compatTypes';
import {
  buildCompatSuiteReport,
  createCaseReportFromResult,
  createSkippedCaseReport,
  findMissingRoms,
  formatMissingRomMessage,
  type CompatCaseReport,
  writeCompatSuiteReport,
} from './reportSink';

const ROM_DIR = process.env.GB_MOONEYE_ROM_DIR ?? path.resolve(process.cwd(), 'tests/roms/mooneye');
const STRICT_COMPAT = process.env.GB_COMPAT_STRICT !== '0';
const COMPAT_TIER = process.env.GB_COMPAT_TIER ?? 'all';

const RUN_TIER1 = COMPAT_TIER === 'all' || COMPAT_TIER === 'tier1';
const RUN_TIER2 = COMPAT_TIER === 'all' || COMPAT_TIER === 'tier2';
const RUN_TIER3A = COMPAT_TIER === 'all' || COMPAT_TIER === 'tier3a';
const RUN_TIER3B = COMPAT_TIER === 'all' || COMPAT_TIER === 'tier3b';
const describeTier1 = RUN_TIER1 ? describe : describe.skip;
const describeTier2 = RUN_TIER2 ? describe : describe.skip;
const describeTier3A = RUN_TIER3A ? describe : describe.skip;
const describeTier3B = RUN_TIER3B ? describe : describe.skip;

interface MooneyeCase {
  romName: string;
  maxCycles: number;
}

interface ExcludedMooneyeCase {
  romName: string;
  reason: string;
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
  { romName: 'acceptance/if_ie_registers.gb', maxCycles: DEFAULT_MAX_CYCLES },
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

const TIER3A_CASES: ReadonlyArray<MooneyeCase> = [
  { romName: 'acceptance/instr/daa.gb', maxCycles: DEFAULT_MAX_CYCLES },
  { romName: 'acceptance/add_sp_e_timing.gb', maxCycles: DEFAULT_MAX_CYCLES },
  { romName: 'acceptance/ld_hl_sp_e_timing.gb', maxCycles: DEFAULT_MAX_CYCLES },
  { romName: 'acceptance/call_timing.gb', maxCycles: DEFAULT_MAX_CYCLES },
  { romName: 'acceptance/ret_timing.gb', maxCycles: DEFAULT_MAX_CYCLES },
  { romName: 'acceptance/push_timing.gb', maxCycles: DEFAULT_MAX_CYCLES },
  { romName: 'acceptance/ei_timing.gb', maxCycles: DEFAULT_MAX_CYCLES },
  { romName: 'acceptance/intr_timing.gb', maxCycles: DEFAULT_MAX_CYCLES },
  { romName: 'acceptance/reti_intr_timing.gb', maxCycles: DEFAULT_MAX_CYCLES },
  { romName: 'acceptance/halt_ime1_timing.gb', maxCycles: DEFAULT_MAX_CYCLES },
  { romName: 'acceptance/timer/tim00.gb', maxCycles: DEFAULT_MAX_CYCLES },
  { romName: 'acceptance/timer/tim01.gb', maxCycles: DEFAULT_MAX_CYCLES },
];

const TIER3B_CASES: ReadonlyArray<MooneyeCase> = [
  { romName: 'acceptance/timer/tim10.gb', maxCycles: DEFAULT_MAX_CYCLES },
  { romName: 'acceptance/timer/tim11.gb', maxCycles: DEFAULT_MAX_CYCLES },
  { romName: 'acceptance/timer/tim01_div_trigger.gb', maxCycles: DEFAULT_MAX_CYCLES },
  { romName: 'acceptance/timer/tim10_div_trigger.gb', maxCycles: DEFAULT_MAX_CYCLES },
  { romName: 'acceptance/timer/tim11_div_trigger.gb', maxCycles: DEFAULT_MAX_CYCLES },
  { romName: 'acceptance/oam_dma_start.gb', maxCycles: DEFAULT_MAX_CYCLES },
  { romName: 'acceptance/oam_dma_restart.gb', maxCycles: DEFAULT_MAX_CYCLES },
  { romName: 'acceptance/ppu/intr_2_0_timing.gb', maxCycles: DEFAULT_MAX_CYCLES },
  { romName: 'acceptance/ppu/intr_2_mode0_timing.gb', maxCycles: DEFAULT_MAX_CYCLES },
  { romName: 'acceptance/ppu/intr_2_mode3_timing.gb', maxCycles: DEFAULT_MAX_CYCLES },
  { romName: 'acceptance/ppu/intr_2_oam_ok_timing.gb', maxCycles: DEFAULT_MAX_CYCLES },
];

const TIER3B_EXCLUDED_CASES: ReadonlyArray<ExcludedMooneyeCase> = [
  {
    romName: 'acceptance/oam_dma/sources-GS.gb',
    reason: 'Excluded from Tier-3B for now: requires unsupported MBC5 cartridge type (0x1B).',
  },
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

describeTier1('mooneye DMG tier-1 compatibility', () => {
  const startedAt = new Date().toISOString();
  const reportCases: CompatCaseReport[] = [];
  const missingRoms = findMissingRoms(
    ROM_DIR,
    TIER1_CASES.map((testCase) => testCase.romName),
    existsSync,
  );
  const missingSet = new Set(missingRoms.map((entry) => entry.name));
  for (const missing of missingRoms) {
    reportCases.push(
      createSkippedCaseReport(missing.name, `Missing required ROM asset: ${missing.absolutePath}`),
    );
  }

  it('preflight: required ROM assets are present', () => {
    if (STRICT_COMPAT && missingRoms.length > 0) {
      throw new Error(formatMissingRomMessage('mooneye tier-1', STRICT_COMPAT, missingRoms));
    }
  });

  for (const testCase of TIER1_CASES) {
    const run = missingSet.has(testCase.romName) ? it.skip : it;
    run(
      testCase.romName,
      async () => {
        const result = await runMooneyeCase(testCase);
        reportCases.push(createCaseReportFromResult(result));
        const detail = `${result.name} status=${result.status} cycles=${result.cycles} pc=0x${result.pc.toString(16)} op=0x${result.opcode.toString(16)} bc=0x${result.bc.toString(16)} de=0x${result.de.toString(16)} hl=0x${result.hl.toString(16)} serialTail=${JSON.stringify(result.serialTail)}`;
        expect(result.status, detail).toBe('pass');
      },
      120_000,
    );
  }

  afterAll(() => {
    writeCompatSuiteReport(
      'mooneye-tier1.json',
      buildCompatSuiteReport({
        suite: 'mooneye',
        tier: 'tier1',
        strict: STRICT_COMPAT,
        startedAt,
        finishedAt: new Date().toISOString(),
        cases: reportCases,
      }),
    );
  });
});

describeTier2('mooneye DMG tier-2 compatibility', () => {
  const startedAt = new Date().toISOString();
  const reportCases: CompatCaseReport[] = [];
  const missingRoms = findMissingRoms(
    ROM_DIR,
    TIER2_CASES.map((testCase) => testCase.romName),
    existsSync,
  );
  const missingSet = new Set(missingRoms.map((entry) => entry.name));
  for (const missing of missingRoms) {
    reportCases.push(
      createSkippedCaseReport(missing.name, `Missing required ROM asset: ${missing.absolutePath}`),
    );
  }

  it('preflight: required ROM assets are present', () => {
    if (STRICT_COMPAT && missingRoms.length > 0) {
      throw new Error(formatMissingRomMessage('mooneye tier-2', STRICT_COMPAT, missingRoms));
    }
  });

  for (const testCase of TIER2_CASES) {
    const run = missingSet.has(testCase.romName) ? it.skip : it;
    run(
      testCase.romName,
      async () => {
        const result = await runMooneyeCase(testCase);
        reportCases.push(createCaseReportFromResult(result));
        const detail = `${result.name} status=${result.status} cycles=${result.cycles} pc=0x${result.pc.toString(16)} op=0x${result.opcode.toString(16)} bc=0x${result.bc.toString(16)} de=0x${result.de.toString(16)} hl=0x${result.hl.toString(16)} serialTail=${JSON.stringify(result.serialTail)}`;
        expect(result.status, detail).toBe('pass');
      },
      120_000,
    );
  }

  afterAll(() => {
    writeCompatSuiteReport(
      'mooneye-tier2.json',
      buildCompatSuiteReport({
        suite: 'mooneye',
        tier: 'tier2',
        strict: STRICT_COMPAT,
        startedAt,
        finishedAt: new Date().toISOString(),
        cases: reportCases,
      }),
    );
  });
});

describeTier3A('mooneye DMG tier-3A compatibility', () => {
  const startedAt = new Date().toISOString();
  const reportCases: CompatCaseReport[] = [];
  const missingRoms = findMissingRoms(
    ROM_DIR,
    TIER3A_CASES.map((testCase) => testCase.romName),
    existsSync,
  );
  const missingSet = new Set(missingRoms.map((entry) => entry.name));
  for (const missing of missingRoms) {
    reportCases.push(
      createSkippedCaseReport(missing.name, `Missing required ROM asset: ${missing.absolutePath}`),
    );
  }

  it('preflight: required ROM assets are present', () => {
    if (STRICT_COMPAT && missingRoms.length > 0) {
      throw new Error(formatMissingRomMessage('mooneye tier-3A', STRICT_COMPAT, missingRoms));
    }
  });

  for (const testCase of TIER3A_CASES) {
    const run = missingSet.has(testCase.romName) ? it.skip : it;
    run(
      testCase.romName,
      async () => {
        const result = await runMooneyeCase(testCase);
        reportCases.push(createCaseReportFromResult(result));
        const detail = `${result.name} status=${result.status} cycles=${result.cycles} pc=0x${result.pc.toString(16)} op=0x${result.opcode.toString(16)} bc=0x${result.bc.toString(16)} de=0x${result.de.toString(16)} hl=0x${result.hl.toString(16)} serialTail=${JSON.stringify(result.serialTail)}`;
        expect(result.status, detail).toBe('pass');
      },
      120_000,
    );
  }

  afterAll(() => {
    writeCompatSuiteReport(
      'mooneye-tier3a.json',
      buildCompatSuiteReport({
        suite: 'mooneye',
        tier: 'tier3a',
        strict: STRICT_COMPAT,
        startedAt,
        finishedAt: new Date().toISOString(),
        cases: reportCases,
      }),
    );
  });
});

describeTier3B('mooneye DMG tier-3B compatibility', () => {
  const startedAt = new Date().toISOString();
  const reportCases: CompatCaseReport[] = [];
  const excludedNames = new Set(TIER3B_EXCLUDED_CASES.map((entry) => entry.romName));
  const missingRoms = findMissingRoms(
    ROM_DIR,
    TIER3B_CASES.map((testCase) => testCase.romName),
    existsSync,
  );
  const missingSet = new Set(missingRoms.map((entry) => entry.name));
  for (const missing of missingRoms) {
    reportCases.push(
      createSkippedCaseReport(missing.name, `Missing required ROM asset: ${missing.absolutePath}`),
    );
  }

  it('preflight: required ROM assets are present', () => {
    const accidentalInclusions = TIER3B_CASES.filter((testCase) =>
      excludedNames.has(testCase.romName),
    );
    if (accidentalInclusions.length > 0) {
      throw new Error(
        `mooneye tier-3B: excluded cases were included in required scope: ${accidentalInclusions
          .map((entry) => entry.romName)
          .join(', ')}`,
      );
    }

    if (STRICT_COMPAT && missingRoms.length > 0) {
      throw new Error(formatMissingRomMessage('mooneye tier-3B', STRICT_COMPAT, missingRoms));
    }
  });

  for (const testCase of TIER3B_CASES) {
    const run = missingSet.has(testCase.romName) ? it.skip : it;
    run(
      testCase.romName,
      async () => {
        const result = await runMooneyeCase(testCase);
        reportCases.push(createCaseReportFromResult(result));
        const detail = `${result.name} status=${result.status} cycles=${result.cycles} pc=0x${result.pc.toString(16)} op=0x${result.opcode.toString(16)} bc=0x${result.bc.toString(16)} de=0x${result.de.toString(16)} hl=0x${result.hl.toString(16)} serialTail=${JSON.stringify(result.serialTail)}`;
        expect(result.status, detail).toBe('pass');
      },
      120_000,
    );
  }

  afterAll(() => {
    writeCompatSuiteReport(
      'mooneye-tier3b.json',
      buildCompatSuiteReport({
        suite: 'mooneye',
        tier: 'tier3b',
        strict: STRICT_COMPAT,
        startedAt,
        finishedAt: new Date().toISOString(),
        cases: reportCases,
      }),
    );
  });
});
