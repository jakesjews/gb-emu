import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { CompatResult } from './compatTypes';

export type CompatReportStatus = CompatResult['status'] | 'skipped';

export interface CompatCaseReport {
  name: string;
  status: CompatReportStatus;
  cycles: number;
  pc: number;
  opcode: number;
  bc: number;
  de: number;
  hl: number;
  serialTail: string;
  skipped: boolean;
  reason?: string;
}

export interface CompatSuiteTotals {
  total: number;
  passed: number;
  failed: number;
  timedOut: number;
  skipped: number;
}

export interface CompatSuiteReport {
  suite: string;
  tier: string;
  strict: boolean;
  startedAt: string;
  finishedAt: string;
  totals: CompatSuiteTotals;
  cases: CompatCaseReport[];
}

export interface MissingRom {
  name: string;
  absolutePath: string;
}

const COMPAT_REPORT_DIR = path.resolve(process.cwd(), 'test-results/compat');

export function createCaseReportFromResult(result: CompatResult): CompatCaseReport {
  return {
    name: result.name,
    status: result.status,
    cycles: result.cycles,
    pc: result.pc,
    opcode: result.opcode,
    bc: result.bc,
    de: result.de,
    hl: result.hl,
    serialTail: result.serialTail,
    skipped: false,
  };
}

export function createSkippedCaseReport(name: string, reason: string): CompatCaseReport {
  return {
    name,
    status: 'skipped',
    cycles: 0,
    pc: 0,
    opcode: 0,
    bc: 0,
    de: 0,
    hl: 0,
    serialTail: '',
    skipped: true,
    reason,
  };
}

export function findMissingRoms(
  romDir: string,
  names: ReadonlyArray<string>,
  exists: (path: string) => boolean,
): MissingRom[] {
  return names
    .map((name) => ({
      name,
      absolutePath: path.join(romDir, name),
    }))
    .filter((entry) => !exists(entry.absolutePath));
}

export function formatMissingRomMessage(
  suiteLabel: string,
  strict: boolean,
  missing: ReadonlyArray<MissingRom>,
): string {
  const mode = strict ? 'strict' : 'soft';
  const lines = missing.map((entry) => `- ${entry.name} -> ${entry.absolutePath}`).join('\n');
  return `${suiteLabel}: missing ROM assets in ${mode} mode.\n${lines}\nFetch assets with ./scripts/fetch_test_roms.sh.`;
}

function computeTotals(cases: ReadonlyArray<CompatCaseReport>): CompatSuiteTotals {
  return {
    total: cases.length,
    passed: cases.filter((entry) => entry.status === 'pass').length,
    failed: cases.filter((entry) => entry.status === 'fail').length,
    timedOut: cases.filter((entry) => entry.status === 'timeout').length,
    skipped: cases.filter((entry) => entry.skipped).length,
  };
}

export function buildCompatSuiteReport(params: {
  suite: string;
  tier: string;
  strict: boolean;
  startedAt: string;
  finishedAt: string;
  cases: CompatCaseReport[];
}): CompatSuiteReport {
  const cases = [...params.cases];
  return {
    suite: params.suite,
    tier: params.tier,
    strict: params.strict,
    startedAt: params.startedAt,
    finishedAt: params.finishedAt,
    totals: computeTotals(cases),
    cases,
  };
}

export function writeCompatSuiteReport(fileName: string, report: CompatSuiteReport): void {
  mkdirSync(COMPAT_REPORT_DIR, { recursive: true });
  const outputPath = path.join(COMPAT_REPORT_DIR, fileName);
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}
