import { InterruptController, InterruptFlag } from '../interrupts/InterruptController';

const TAC_TO_DIV_BIT: ReadonlyArray<number> = [9, 3, 5, 7];
const TIMA_RELOAD_DELAY_CYCLES = 4;

export class Timer {
  private divCounter = 0;

  private tima = 0;

  private tma = 0;

  private tac = 0;

  private timaReloadDelay = 0;

  private readonly interrupts: InterruptController;

  public constructor(interrupts: InterruptController) {
    this.interrupts = interrupts;
  }

  public reset(): void {
    this.divCounter = 0;
    this.tima = 0;
    this.tma = 0;
    this.tac = 0;
    this.timaReloadDelay = 0;
  }

  public tick(cycles: number): void {
    for (let i = 0; i < cycles; i += 1) {
      const oldSignal = this.getTimerSignal();
      this.divCounter = (this.divCounter + 1) & 0xffff;
      const signal = this.getTimerSignal();

      if (oldSignal === 1 && signal === 0) {
        this.incrementTimaOnFallingEdge();
      }
      this.tickReloadPipeline();
    }
  }

  public readDIV(): number {
    return (this.divCounter >> 8) & 0xff;
  }

  public writeDIV(): void {
    const oldSignal = this.getTimerSignal();
    this.divCounter = 0;
    const newSignal = this.getTimerSignal();
    if (oldSignal === 1 && newSignal === 0) {
      this.incrementTimaOnFallingEdge();
    }
  }

  public readTIMA(): number {
    return this.tima;
  }

  public writeTIMA(value: number): void {
    if (this.timaReloadDelay > 0) {
      this.timaReloadDelay = 0;
    }

    this.tima = value & 0xff;
  }

  public readTMA(): number {
    return this.tma;
  }

  public writeTMA(value: number): void {
    this.tma = value & 0xff;
  }

  public readTAC(): number {
    return this.tac | 0xf8;
  }

  public writeTAC(value: number): void {
    const oldSignal = this.getTimerSignal();
    this.tac = value & 0x07;
    const newSignal = this.getTimerSignal();
    if (oldSignal === 1 && newSignal === 0) {
      this.incrementTimaOnFallingEdge();
    }
  }

  public isReloadPending(): boolean {
    return this.timaReloadDelay > 0;
  }

  private getTimerSignal(): number {
    if ((this.tac & 0x04) === 0) {
      return 0;
    }

    const bit = TAC_TO_DIV_BIT[this.tac & 0x03] ?? 9;
    return (this.divCounter >> bit) & 0x01;
  }

  private incrementTimaOnFallingEdge(): void {
    if (this.tima === 0xff) {
      this.tima = 0x00;
      this.timaReloadDelay = TIMA_RELOAD_DELAY_CYCLES;
      return;
    }

    this.tima = (this.tima + 1) & 0xff;
  }

  private tickReloadPipeline(): void {
    if (this.timaReloadDelay === 0) {
      return;
    }

    this.timaReloadDelay -= 1;
    if (this.timaReloadDelay !== 0) {
      return;
    }

    this.tima = this.tma;
    this.interrupts.request(InterruptFlag.Timer);
  }
}
