import { InterruptController, InterruptFlag } from '../interrupts/InterruptController';

const TRANSFER_CYCLES = 4096;
const DISCONNECTED_RX_BYTE = 0xff;

export class Serial {
  private sb = 0;

  private sc = 0x7e;

  private transferCycles = 0;

  private transferInProgress = false;

  private readonly outputBytes: number[] = [];

  private readonly interrupts: InterruptController;

  public constructor(interrupts: InterruptController) {
    this.interrupts = interrupts;
  }

  public reset(): void {
    this.sb = 0;
    this.sc = 0x7e;
    this.transferCycles = 0;
    this.transferInProgress = false;
    this.outputBytes.length = 0;
  }

  public tick(cycles: number): void {
    if (!this.transferInProgress) {
      return;
    }

    this.transferCycles += cycles;
    if (this.transferCycles < TRANSFER_CYCLES) {
      return;
    }

    this.transferCycles -= TRANSFER_CYCLES;
    this.transferInProgress = false;
    this.sc &= 0x7f;
    const transmitted = this.sb;
    this.outputBytes.push(transmitted);
    // With no link peer connected, incoming bits read high.
    this.sb = DISCONNECTED_RX_BYTE;
    this.interrupts.request(InterruptFlag.Serial);
  }

  public readSB(): number {
    return this.sb;
  }

  public writeSB(value: number): void {
    this.sb = value & 0xff;
  }

  public readSC(): number {
    return this.sc | 0x7e;
  }

  public writeSC(value: number): void {
    this.sc = value & 0x83;

    // Only internal clock mode auto-shifts bits without an external partner.
    if ((this.sc & 0x81) === 0x81) {
      this.transferInProgress = true;
      this.transferCycles = 0;
      return;
    }

    this.transferInProgress = false;
    this.transferCycles = 0;
  }

  public getOutputAsString(): string {
    return String.fromCharCode(...this.outputBytes);
  }

  public clearOutput(): void {
    this.outputBytes.length = 0;
  }
}
