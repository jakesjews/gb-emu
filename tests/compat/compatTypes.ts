import type { DebugSnapshot } from '../../src/types/emulator';

export type CompatStatus = 'pass' | 'fail' | 'timeout';

export interface CompatResult {
  name: string;
  status: CompatStatus;
  cycles: number;
  pc: number;
  opcode: number;
  bc: number;
  de: number;
  hl: number;
  serialTail: string;
}

export function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  const copy = new Uint8Array(buffer.byteLength);
  copy.set(buffer);
  return copy.buffer;
}

export function createCompatResult(
  name: string,
  status: CompatStatus,
  cycles: number,
  snapshot: DebugSnapshot,
  serialOutput: string,
): CompatResult {
  return {
    name,
    status,
    cycles,
    pc: snapshot.pc,
    opcode: snapshot.opcode,
    bc: snapshot.bc,
    de: snapshot.de,
    hl: snapshot.hl,
    serialTail: serialOutput.slice(-240),
  };
}
