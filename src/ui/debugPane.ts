import type { DebugSnapshot } from '../types/emulator';

function hex(value: number, width: number): string {
  return `0x${(value >>> 0).toString(16).toUpperCase().padStart(width, '0')}`;
}

export class DebugPane {
  private readonly root: HTMLElement;

  private readonly pre: HTMLPreElement;

  public constructor(parent: HTMLElement) {
    this.root = document.createElement('section');
    this.root.className = 'debug-card';

    const title = document.createElement('h2');
    title.textContent = 'Debug';

    this.pre = document.createElement('pre');
    this.pre.textContent = 'Load a ROM to populate debug state.';

    this.root.append(title, this.pre);
    parent.append(this.root);
  }

  public update(snapshot: DebugSnapshot, serialOutput: string): void {
    const lines = [
      `PC ${hex(snapshot.pc, 4)}  SP ${hex(snapshot.sp, 4)}  OP ${hex(snapshot.opcode, 2)}`,
      `AF ${hex(snapshot.af, 4)}  BC ${hex(snapshot.bc, 4)}  DE ${hex(snapshot.de, 4)}  HL ${hex(snapshot.hl, 4)}`,
      `IME ${snapshot.ime ? '1' : '0'}  HALT ${snapshot.halted ? '1' : '0'}  IE ${hex(snapshot.ie, 2)}  IF ${hex(snapshot.if, 2)}`,
      `LY ${hex(snapshot.ly, 2)}  LCDC ${hex(snapshot.lcdc, 2)}  STAT ${hex(snapshot.stat, 2)}  CYC ${snapshot.cycles}`,
      `SERIAL ${JSON.stringify(serialOutput.slice(-80))}`,
    ];

    this.pre.textContent = lines.join('\n');
  }
}
