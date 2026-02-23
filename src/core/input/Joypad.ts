import type { Button } from '../../types/emulator';
import { InterruptController, InterruptFlag } from '../interrupts/InterruptController';

interface JoypadState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  a: boolean;
  b: boolean;
  start: boolean;
  select: boolean;
}

const EMPTY_STATE: JoypadState = {
  up: false,
  down: false,
  left: false,
  right: false,
  a: false,
  b: false,
  start: false,
  select: false,
};

export class Joypad {
  private selectButtons = true;

  private selectDpad = true;

  private state: JoypadState = { ...EMPTY_STATE };

  private previousLowNibble = 0x0f;

  private readonly interrupts: InterruptController;

  private lastWrite = 0x30;

  private lastRead = 0xff;

  private readCount = 0;

  private writeCount = 0;

  private sawButtonSelectLow = false;

  private sawDpadSelectLow = false;

  public constructor(interrupts: InterruptController) {
    this.interrupts = interrupts;
  }

  public reset(): void {
    this.selectButtons = true;
    this.selectDpad = true;
    this.state = { ...EMPTY_STATE };
    this.previousLowNibble = 0x0f;
    this.lastWrite = 0x30;
    this.lastRead = 0xff;
    this.readCount = 0;
    this.writeCount = 0;
    this.sawButtonSelectLow = false;
    this.sawDpadSelectLow = false;
  }

  public read(): number {
    const lowNibble = this.getLowNibble();
    let result = 0xc0;

    if (this.selectButtons) {
      result |= 0x20;
    }

    if (this.selectDpad) {
      result |= 0x10;
    }

    result |= lowNibble;
    this.lastRead = result & 0xff;
    this.readCount += 1;
    return this.lastRead;
  }

  public write(value: number): void {
    this.lastWrite = value & 0xff;
    this.writeCount += 1;
    if ((value & 0x20) === 0) {
      this.sawButtonSelectLow = true;
    }

    if ((value & 0x10) === 0) {
      this.sawDpadSelectLow = true;
    }

    this.selectButtons = (value & 0x20) !== 0;
    this.selectDpad = (value & 0x10) !== 0;
    this.updateInterruptOnEdge();
  }

  public setButtonState(button: Button, pressed: boolean): void {
    if (this.state[button] === pressed) {
      return;
    }

    this.state = Object.assign({}, this.state, { [button]: pressed });
    this.updateInterruptOnEdge();
  }

  public releaseAll(): void {
    this.state = { ...EMPTY_STATE };
    this.updateInterruptOnEdge();
  }

  private updateInterruptOnEdge(): void {
    const current = this.getLowNibble();
    const fellEdge = (this.previousLowNibble & ~current) !== 0;
    if (fellEdge) {
      this.interrupts.request(InterruptFlag.Joypad);
    }

    this.previousLowNibble = current;
  }

  private getLowNibble(): number {
    let value = 0x0f;

    if (!this.selectButtons) {
      if (this.state.start) {
        value &= ~0x08;
      }

      if (this.state.select) {
        value &= ~0x04;
      }

      if (this.state.b) {
        value &= ~0x02;
      }

      if (this.state.a) {
        value &= ~0x01;
      }
    }

    if (!this.selectDpad) {
      if (this.state.down) {
        value &= ~0x08;
      }

      if (this.state.up) {
        value &= ~0x04;
      }

      if (this.state.left) {
        value &= ~0x02;
      }

      if (this.state.right) {
        value &= ~0x01;
      }
    }

    return value & 0x0f;
  }

  public getDebugInfo(): {
    lastRead: number;
    lastWrite: number;
    readCount: number;
    writeCount: number;
    selectButtons: boolean;
    selectDpad: boolean;
    sawButtonSelectLow: boolean;
    sawDpadSelectLow: boolean;
    buttons: JoypadState;
  } {
    return {
      lastRead: this.lastRead,
      lastWrite: this.lastWrite,
      readCount: this.readCount,
      writeCount: this.writeCount,
      selectButtons: this.selectButtons,
      selectDpad: this.selectDpad,
      sawButtonSelectLow: this.sawButtonSelectLow,
      sawDpadSelectLow: this.sawDpadSelectLow,
      buttons: { ...this.state },
    };
  }
}
