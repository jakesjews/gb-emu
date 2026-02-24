export enum InterruptFlag {
  VBlank = 0x01,
  LCDStat = 0x02,
  Timer = 0x04,
  Serial = 0x08,
  Joypad = 0x10,
}

const INTERRUPT_VECTORS: ReadonlyArray<{ mask: number; vector: number }> = [
  { mask: InterruptFlag.VBlank, vector: 0x40 },
  { mask: InterruptFlag.LCDStat, vector: 0x48 },
  { mask: InterruptFlag.Timer, vector: 0x50 },
  { mask: InterruptFlag.Serial, vector: 0x58 },
  { mask: InterruptFlag.Joypad, vector: 0x60 },
];

export class InterruptController {
  private ie = 0;

  private if = 0xe1;

  public reset(): void {
    this.ie = 0;
    this.if = 0xe1;
  }

  public readIE(): number {
    return this.ie;
  }

  public writeIE(value: number): void {
    this.ie = value & 0x1f;
  }

  public readIF(): number {
    return this.if | 0xe0;
  }

  public writeIF(value: number): void {
    this.if = (value & 0x1f) | 0xe0;
  }

  public request(flag: InterruptFlag): void {
    this.if = (this.if | flag) & 0xff;
  }

  public clear(flag: InterruptFlag): void {
    this.if = (this.if & ~flag) | 0xe0;
  }

  public hasPending(): boolean {
    return this.getPendingMask() !== 0;
  }

  public getPendingMask(): number {
    return this.ie & this.if & 0x1f;
  }

  public getHighestPriorityPendingMask(mask = this.getPendingMask()): number {
    for (const candidate of INTERRUPT_VECTORS) {
      if ((mask & candidate.mask) !== 0) {
        return candidate.mask;
      }
    }

    return 0;
  }

  public getVectorForMask(mask: number): number | null {
    for (const candidate of INTERRUPT_VECTORS) {
      if ((mask & candidate.mask) !== 0) {
        return candidate.vector;
      }
    }

    return null;
  }

  public consumePendingByMask(mask: number): number | null {
    const highest = this.getHighestPriorityPendingMask(mask);
    if (highest === 0) {
      return null;
    }

    this.clear(highest as InterruptFlag);
    return this.getVectorForMask(highest);
  }

  public consumeNextPendingVector(): number | null {
    return this.consumePendingByMask(this.getPendingMask());
  }
}
