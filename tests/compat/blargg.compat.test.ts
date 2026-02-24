import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GameBoy } from '../../src/core/system/GameBoy';
import { createCompatResult, toArrayBuffer, type CompatResult } from './compatTypes';

const ROM_DIR = process.env.GB_TEST_ROM_DIR ?? path.resolve(process.cwd(), 'tests/roms/blargg');

const HALT_BUG_PASS_HASH = '3d368e327bea655aa0732f445b2ad8b17f0a50fa';

interface SerialCompatCase {
  kind: 'serial';
  romName: string;
  maxCycles: number;
}

interface HaltBugCompatCase {
  kind: 'halt-bug';
  romName: string;
  settleCycles: number;
  verifyCycles: number;
}

type CompatCase = SerialCompatCase | HaltBugCompatCase;

const COMPAT_CASES: ReadonlyArray<CompatCase> = [
  { kind: 'serial', romName: 'cpu_instrs.gb', maxCycles: 260_000_000 },
  { kind: 'serial', romName: 'instr_timing.gb', maxCycles: 20_000_000 },
  { kind: 'serial', romName: 'mem_timing.gb', maxCycles: 20_000_000 },
  { kind: 'halt-bug', romName: 'halt_bug.gb', settleCycles: 25_000_000, verifyCycles: 5_000_000 },
];

async function runSerialRom(romPath: string, maxCycles: number): Promise<CompatResult> {
  const gb = new GameBoy();
  const name = path.basename(romPath);
  const rom = readFileSync(romPath);
  await gb.loadRom(toArrayBuffer(rom));

  let executed = 0;

  while (executed < maxCycles) {
    executed += gb.stepInstruction();
    const output = gb.getSerialOutput();
    const snapshot = gb.getDebugSnapshot();
    if (output.includes('Passed')) {
      return createCompatResult(name, 'pass', executed, snapshot, output);
    }

    if (output.includes('Failed')) {
      return createCompatResult(name, 'fail', executed, snapshot, output);
    }
  }

  return createCompatResult(name, 'timeout', executed, gb.getDebugSnapshot(), gb.getSerialOutput());
}

function hashFrame(frameBuffer: Uint32Array): string {
  return createHash('sha1').update(Buffer.from(frameBuffer.buffer)).digest('hex');
}

async function runHaltBugRom(
  romPath: string,
  settleCycles: number,
  verifyCycles: number,
): Promise<{ result: CompatResult; summary: string }> {
  const gb = new GameBoy();
  const name = path.basename(romPath);
  const rom = readFileSync(romPath);
  await gb.loadRom(toArrayBuffer(rom));

  let executed = 0;
  while (executed < settleCycles) {
    executed += gb.stepInstruction();
  }

  const firstSnapshot = gb.getDebugSnapshot();
  const firstHash = hashFrame(gb.getFrameBuffer());

  while (executed < settleCycles + verifyCycles) {
    executed += gb.stepInstruction();
  }

  const secondSnapshot = gb.getDebugSnapshot();
  const secondHash = hashFrame(gb.getFrameBuffer());

  const stableLoop = firstSnapshot.pc === secondSnapshot.pc && firstSnapshot.opcode === 0x18;
  const isPassFrame = firstHash === HALT_BUG_PASS_HASH && secondHash === HALT_BUG_PASS_HASH;
  const status = stableLoop && isPassFrame ? 'pass' : 'fail';

  return {
    result: createCompatResult(name, status, executed, secondSnapshot, gb.getSerialOutput()),
    summary: `hashes=${firstHash},${secondHash} pc=${firstSnapshot.pc.toString(16)}->${secondSnapshot.pc.toString(16)} op=${firstSnapshot.opcode.toString(16)}->${secondSnapshot.opcode.toString(16)}`,
  };
}

describe('blargg compatibility subset', () => {
  for (const testCase of COMPAT_CASES) {
    const romPath = path.join(ROM_DIR, testCase.romName);
    const run = existsSync(romPath) ? it : it.skip;

    run(
      testCase.romName,
      async () => {
        if (testCase.kind === 'serial') {
          const result = await runSerialRom(romPath, testCase.maxCycles);
          const detail = `${result.name} status=${result.status} cycles=${result.cycles} pc=0x${result.pc.toString(16)} op=0x${result.opcode.toString(16)} bc=0x${result.bc.toString(16)} de=0x${result.de.toString(16)} hl=0x${result.hl.toString(16)} serialTail=${JSON.stringify(result.serialTail)}`;
          expect(result.status, detail).toBe('pass');
          return;
        }

        const result = await runHaltBugRom(romPath, testCase.settleCycles, testCase.verifyCycles);
        const detail = `${result.summary} status=${result.result.status} cycles=${result.result.cycles} pc=0x${result.result.pc.toString(16)} op=0x${result.result.opcode.toString(16)} bc=0x${result.result.bc.toString(16)} de=0x${result.result.de.toString(16)} hl=0x${result.result.hl.toString(16)} serialTail=${JSON.stringify(result.result.serialTail)}`;
        expect(result.result.status, detail).toBe('pass');
      },
      60_000,
    );
  }
});
