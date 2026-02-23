import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GameBoy } from '../../src/core/system/GameBoy';

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

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  const copy = new Uint8Array(buffer.byteLength);
  copy.set(buffer);
  return copy.buffer;
}

async function runSerialRom(romPath: string, maxCycles: number): Promise<{ output: string; passed: boolean }> {
  const gb = new GameBoy();
  const rom = readFileSync(romPath);
  await gb.loadRom(toArrayBuffer(rom));

  let executed = 0;

  while (executed < maxCycles) {
    executed += gb.stepInstruction();
    const output = gb.getSerialOutput();
    if (output.includes('Passed')) {
      return { output, passed: true };
    }

    if (output.includes('Failed')) {
      return { output, passed: false };
    }
  }

  return { output: gb.getSerialOutput(), passed: false };
}

function hashFrame(frameBuffer: Uint32Array): string {
  return createHash('sha1').update(Buffer.from(frameBuffer.buffer)).digest('hex');
}

async function runHaltBugRom(
  romPath: string,
  settleCycles: number,
  verifyCycles: number,
): Promise<{ summary: string; passed: boolean }> {
  const gb = new GameBoy();
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

  return {
    passed: stableLoop && isPassFrame,
    summary: `hashes=${firstHash},${secondHash} pc=${firstSnapshot.pc.toString(16)}->${secondSnapshot.pc.toString(16)} op=${firstSnapshot.opcode.toString(16)}->${secondSnapshot.opcode.toString(16)}`,
  };
}

describe('blargg compatibility subset', () => {
  for (const testCase of COMPAT_CASES) {
    const romPath = path.join(ROM_DIR, testCase.romName);
    const run = existsSync(romPath) ? it : it.skip;

    run(testCase.romName, async () => {
      if (testCase.kind === 'serial') {
        const result = await runSerialRom(romPath, testCase.maxCycles);
        expect(result.passed, result.output).toBe(true);
        return;
      }

      const result = await runHaltBugRom(romPath, testCase.settleCycles, testCase.verifyCycles);
      expect(result.passed, result.summary).toBe(true);
    }, 60_000);
  }
});
