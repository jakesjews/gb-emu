import { FLAG_C, FLAG_H, FLAG_N, FLAG_Z } from './flags';

export class Registers {
  public a = 0;

  public f = 0;

  public b = 0;

  public c = 0;

  public d = 0;

  public e = 0;

  public h = 0;

  public l = 0;

  public sp = 0;

  public pc = 0;

  public resetToDmgBootState(): void {
    this.a = 0x01;
    this.f = 0xb0;
    this.b = 0x00;
    this.c = 0x13;
    this.d = 0x00;
    this.e = 0xd8;
    this.h = 0x01;
    this.l = 0x4d;
    this.sp = 0xfffe;
    this.pc = 0x0100;
  }

  public get af(): number {
    return (this.a << 8) | this.f;
  }

  public set af(value: number) {
    this.a = (value >> 8) & 0xff;
    this.f = value & 0xf0;
  }

  public get bc(): number {
    return (this.b << 8) | this.c;
  }

  public set bc(value: number) {
    this.b = (value >> 8) & 0xff;
    this.c = value & 0xff;
  }

  public get de(): number {
    return (this.d << 8) | this.e;
  }

  public set de(value: number) {
    this.d = (value >> 8) & 0xff;
    this.e = value & 0xff;
  }

  public get hl(): number {
    return (this.h << 8) | this.l;
  }

  public set hl(value: number) {
    this.h = (value >> 8) & 0xff;
    this.l = value & 0xff;
  }

  public setFlag(mask: number, enabled: boolean): void {
    if (enabled) {
      this.f = (this.f | mask) & 0xf0;
    } else {
      this.f = this.f & ~mask & 0xf0;
    }
  }

  public getFlag(mask: number): boolean {
    return (this.f & mask) !== 0;
  }

  public setZero(value: boolean): void {
    this.setFlag(FLAG_Z, value);
  }

  public setSubtract(value: boolean): void {
    this.setFlag(FLAG_N, value);
  }

  public setHalfCarry(value: boolean): void {
    this.setFlag(FLAG_H, value);
  }

  public setCarry(value: boolean): void {
    this.setFlag(FLAG_C, value);
  }
}
