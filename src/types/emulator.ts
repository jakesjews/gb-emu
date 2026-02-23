export type Button = 'up' | 'down' | 'left' | 'right' | 'a' | 'b' | 'start' | 'select';

export interface DebugSnapshot {
  pc: number;
  sp: number;
  af: number;
  bc: number;
  de: number;
  hl: number;
  ime: boolean;
  ie: number;
  if: number;
  ly: number;
  lcdc: number;
  stat: number;
  cycles: number;
  opcode: number;
  halted: boolean;
}

export interface CartridgeInfo {
  title: string;
  type: string;
  romSize: number;
  ramSize: number;
  cgbFlag: number;
  sgbFlag: number;
}

export interface EmulatorStatus {
  running: boolean;
  fps: number;
  frameCount: number;
  romName: string | null;
  saveState: 'idle' | 'dirty' | 'saved' | 'error';
}
