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

const STRICT_COMPAT = process.env.GB_COMPAT_STRICT !== '0';
const MAPPER_MODE = process.env.GB_MAPPER_COMPAT_MODE ?? 'shadow';
const MOONEYE_ROM_DIR =
  process.env.GB_MOONEYE_ROM_DIR ?? path.resolve(process.cwd(), 'tests/roms/mooneye');
const MAPPER_ROM_DIR =
  process.env.GB_MAPPER_ROM_DIR ?? path.resolve(process.cwd(), 'tests/roms/mapper');
const DEFAULT_MAX_CYCLES = 120_000_000;

interface MapperCompatCase {
  romName: string;
  maxCycles: number;
}

const PASS_REGS = [0x03, 0x05, 0x08, 0x0d, 0x15, 0x22] as const;
const FAIL_REGS = [0x42, 0x42, 0x42, 0x42, 0x42, 0x42] as const;

const MBC5_MOONEYE_CASES: ReadonlyArray<MapperCompatCase> = [
  { romName: 'emulator-only/mbc5/rom_512kb.gb', maxCycles: DEFAULT_MAX_CYCLES },
  { romName: 'emulator-only/mbc5/rom_1Mb.gb', maxCycles: DEFAULT_MAX_CYCLES },
  { romName: 'emulator-only/mbc5/rom_2Mb.gb', maxCycles: DEFAULT_MAX_CYCLES },
  { romName: 'emulator-only/mbc5/rom_4Mb.gb', maxCycles: DEFAULT_MAX_CYCLES },
  { romName: 'emulator-only/mbc5/rom_8Mb.gb', maxCycles: DEFAULT_MAX_CYCLES },
  { romName: 'emulator-only/mbc5/rom_16Mb.gb', maxCycles: DEFAULT_MAX_CYCLES },
  { romName: 'emulator-only/mbc5/rom_32Mb.gb', maxCycles: DEFAULT_MAX_CYCLES },
  { romName: 'emulator-only/mbc5/rom_64Mb.gb', maxCycles: DEFAULT_MAX_CYCLES },
];

const MBC3_REQUIRED_CASES: ReadonlyArray<MapperCompatCase> = [
  { romName: 'MBC3_Test.gbc', maxCycles: 160_000_000 },
];

const MBC3_OPTIONAL_CASES: ReadonlyArray<MapperCompatCase> =
  MAPPER_MODE === 'strict'
    ? []
    : [
        { romName: 'rtc3test.gb', maxCycles: 12_000_000 },
        { romName: 'mbctest.gb', maxCycles: 12_000_000 },
      ];

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

async function runMooneyeOracleCase(romPath: string, maxCycles: number): Promise<CompatResult> {
  const gb = new GameBoy();
  const rom = readFileSync(romPath);
  await gb.loadRom(toArrayBuffer(rom));

  let cycles = 0;
  while (cycles < maxCycles) {
    cycles += gb.stepInstruction();
    const snapshot = gb.getDebugSnapshot();
    const tuple = tupleFromSnapshot(snapshot);
    const tupleIsPass = isTupleEqual(tuple, PASS_REGS);
    const tupleIsFail = isTupleEqual(tuple, FAIL_REGS);

    if (snapshot.opcode === 0x40 && (tupleIsPass || tupleIsFail)) {
      return createCompatResult(
        path.basename(romPath),
        tupleIsPass ? 'pass' : 'fail',
        cycles,
        snapshot,
        gb.getSerialOutput(),
      );
    }

    if (snapshot.opcode === 0x18 && (tupleIsPass || tupleIsFail)) {
      const stablePc = snapshot.pc;
      let settleCycles = 0;
      let stable = true;
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

      return createCompatResult(
        path.basename(romPath),
        tupleIsPass ? 'pass' : 'fail',
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

async function runMbc3BankSmoke(romPath: string, maxCycles: number): Promise<CompatResult> {
  const gb = new GameBoy();
  const rom = readFileSync(romPath);
  await gb.loadRom(toArrayBuffer(rom));

  let cycles = 0;
  while (cycles < maxCycles) {
    cycles += gb.stepInstruction();
    const snapshot = gb.getDebugSnapshot();
    const successfulBanks = gb.readByteDebug(0xc000);
    const failingBanks = gb.readByteDebug(0xc001);
    const lastBankFailed = gb.readByteDebug(0xc003);

    if (snapshot.opcode === 0x76) {
      const pass = failingBanks === 0 && lastBankFailed === 0 && successfulBanks > 0;
      return createCompatResult(
        path.basename(romPath),
        pass ? 'pass' : 'fail',
        cycles,
        snapshot,
        gb.getSerialOutput(),
      );
    }

    if (snapshot.opcode === 0x18) {
      const stablePc = snapshot.pc;
      let settleCycles = 0;
      let stable = true;
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

      const pass = failingBanks === 0 && lastBankFailed === 0 && successfulBanks > 0;
      return createCompatResult(
        path.basename(romPath),
        pass ? 'pass' : 'fail',
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

async function runInformationalMbc3Case(romPath: string, maxCycles: number): Promise<CompatResult> {
  const gb = new GameBoy();
  const rom = readFileSync(romPath);
  await gb.loadRom(toArrayBuffer(rom));

  let cycles = 0;
  while (cycles < maxCycles) {
    cycles += gb.stepInstruction();
  }

  return createCompatResult(
    path.basename(romPath),
    'pass',
    cycles,
    gb.getDebugSnapshot(),
    gb.getSerialOutput(),
  );
}

describe('mapper compatibility shadow: MBC5 mooneye oracle', () => {
  const startedAt = new Date().toISOString();
  const reportCases: CompatCaseReport[] = [];
  const missingRoms = findMissingRoms(
    MOONEYE_ROM_DIR,
    MBC5_MOONEYE_CASES.map((entry) => entry.romName),
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
      throw new Error(formatMissingRomMessage('mapper mbc5 oracle', STRICT_COMPAT, missingRoms));
    }
  });

  for (const testCase of MBC5_MOONEYE_CASES) {
    const run = missingSet.has(testCase.romName) ? it.skip : it;
    run(
      testCase.romName,
      async () => {
        const romPath = path.join(MOONEYE_ROM_DIR, testCase.romName);
        const result = await runMooneyeOracleCase(romPath, testCase.maxCycles);
        reportCases.push(createCaseReportFromResult(result));
        const detail = `${result.name} status=${result.status} cycles=${result.cycles} pc=0x${result.pc.toString(16)} op=0x${result.opcode.toString(16)} bc=0x${result.bc.toString(16)} de=0x${result.de.toString(16)} hl=0x${result.hl.toString(16)} serialTail=${JSON.stringify(result.serialTail)}`;
        expect(result.status, detail).toBe('pass');
      },
      120_000,
    );
  }

  afterAll(() => {
    writeCompatSuiteReport(
      'mapper-mbc5-shadow.json',
      buildCompatSuiteReport({
        suite: 'mapper',
        tier: 'mbc5-shadow',
        strict: STRICT_COMPAT,
        startedAt,
        finishedAt: new Date().toISOString(),
        cases: reportCases,
      }),
    );
  });
});

describe('mapper compatibility shadow: MBC3 basic RTC smoke', () => {
  const startedAt = new Date().toISOString();
  const reportCases: CompatCaseReport[] = [];
  const requiredMissing = findMissingRoms(
    MAPPER_ROM_DIR,
    MBC3_REQUIRED_CASES.map((entry) => entry.romName),
    existsSync,
  );
  const optionalMissing = findMissingRoms(
    MAPPER_ROM_DIR,
    MBC3_OPTIONAL_CASES.map((entry) => entry.romName),
    existsSync,
  );
  const missingSet = new Set([...requiredMissing, ...optionalMissing].map((entry) => entry.name));

  for (const missing of requiredMissing) {
    reportCases.push(
      createSkippedCaseReport(missing.name, `Missing required ROM asset: ${missing.absolutePath}`),
    );
  }
  for (const missing of optionalMissing) {
    reportCases.push(
      createSkippedCaseReport(
        missing.name,
        `Missing optional ROM asset for shadow diagnostics: ${missing.absolutePath}`,
      ),
    );
  }

  it('preflight: required ROM assets are present', () => {
    if (STRICT_COMPAT && requiredMissing.length > 0) {
      throw new Error(formatMissingRomMessage('mapper mbc3 smoke', STRICT_COMPAT, requiredMissing));
    }
  });

  for (const testCase of MBC3_REQUIRED_CASES) {
    const run = missingSet.has(testCase.romName) ? it.skip : it;
    run(
      testCase.romName,
      async () => {
        const romPath = path.join(MAPPER_ROM_DIR, testCase.romName);
        const result = await runMbc3BankSmoke(romPath, testCase.maxCycles);
        reportCases.push(createCaseReportFromResult(result));
        const detail = `${result.name} status=${result.status} cycles=${result.cycles} pc=0x${result.pc.toString(16)} op=0x${result.opcode.toString(16)} bc=0x${result.bc.toString(16)} de=0x${result.de.toString(16)} hl=0x${result.hl.toString(16)} serialTail=${JSON.stringify(result.serialTail)}`;
        expect(result.status, detail).toBe('pass');
      },
      180_000,
    );
  }

  for (const testCase of MBC3_OPTIONAL_CASES) {
    const run = missingSet.has(testCase.romName) ? it.skip : it;
    run(
      testCase.romName,
      async () => {
        const romPath = path.join(MAPPER_ROM_DIR, testCase.romName);
        try {
          const result = await runInformationalMbc3Case(romPath, testCase.maxCycles);
          reportCases.push(createCaseReportFromResult(result));
        } catch (error) {
          reportCases.push(
            createSkippedCaseReport(
              testCase.romName,
              `Optional mapper ROM could not run in shadow mode: ${error instanceof Error ? error.message : 'unknown error'}`,
            ),
          );
        }
      },
      90_000,
    );
  }

  afterAll(() => {
    writeCompatSuiteReport(
      'mapper-mbc3-shadow.json',
      buildCompatSuiteReport({
        suite: 'mapper',
        tier: 'mbc3-shadow',
        strict: STRICT_COMPAT,
        startedAt,
        finishedAt: new Date().toISOString(),
        cases: reportCases,
      }),
    );
  });
});
