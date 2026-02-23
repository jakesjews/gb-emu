import type { Mapper } from '../Cartridge';

export class RomOnlyMapper implements Mapper {
  private readonly rom: Uint8Array;

  public readonly ram: Uint8Array;

  public dirtyRam = false;

  public constructor(rom: Uint8Array, ramSize: number) {
    this.rom = rom;
    this.ram = new Uint8Array(ramSize);
  }

  public readRom(address: number): number {
    return this.rom[address] ?? 0xff;
  }

  public writeRom(_address: number, _value: number): void {
    // ROM only carts ignore writes in ROM space.
  }

  public readRam(address: number): number {
    if (this.ram.length === 0) {
      return 0xff;
    }

    return this.ram[address % this.ram.length];
  }

  public writeRam(address: number, value: number): void {
    if (this.ram.length === 0) {
      return;
    }

    this.ram[address % this.ram.length] = value & 0xff;
    this.dirtyRam = true;
  }

  public getRam(): Uint8Array | null {
    if (this.ram.length === 0) {
      return null;
    }

    return this.ram;
  }

  public loadRam(data: Uint8Array): void {
    if (this.ram.length === 0) {
      return;
    }

    const length = Math.min(this.ram.length, data.length);
    this.ram.set(data.subarray(0, length), 0);
    this.dirtyRam = false;
  }

  public clearDirtyFlag(): void {
    this.dirtyRam = false;
  }
}
