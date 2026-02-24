import type { Mapper } from '../Cartridge';

export class MBC5Mapper implements Mapper {
  private readonly rom: Uint8Array;

  private readonly romBanks: number;

  private readonly ramBanks: number;

  private readonly ram: Uint8Array;

  private ramEnabled = false;

  private romBank = 1;

  private ramBank = 0;

  public dirtyRam = false;

  public constructor(rom: Uint8Array, ramSize: number) {
    this.rom = rom;
    this.romBanks = Math.max(2, rom.length / 0x4000);
    this.ramBanks = ramSize === 0 ? 0 : Math.max(1, ramSize / 0x2000);
    this.ram = new Uint8Array(ramSize);
  }

  public readRom(address: number): number {
    if (address < 0x4000) {
      return this.rom[address] ?? 0xff;
    }

    const bank = this.romBank % this.romBanks;
    const bankOffset = bank * 0x4000;
    return this.rom[bankOffset + (address - 0x4000)] ?? 0xff;
  }

  public writeRom(address: number, value: number): void {
    const maskedValue = value & 0xff;

    if (address <= 0x1fff) {
      this.ramEnabled = (maskedValue & 0x0f) === 0x0a;
      return;
    }

    if (address <= 0x2fff) {
      this.romBank = (this.romBank & 0x100) | maskedValue;
      return;
    }

    if (address <= 0x3fff) {
      this.romBank = ((maskedValue & 0x01) << 8) | (this.romBank & 0xff);
      return;
    }

    if (address <= 0x5fff) {
      // Rumble carts use high bits here; keep lower nibble for bank selection.
      this.ramBank = maskedValue & 0x0f;
    }
  }

  public readRam(address: number): number {
    if (!this.ramEnabled || this.ram.length === 0) {
      return 0xff;
    }

    const bank = this.getRamBank();
    const offset = bank * 0x2000 + (address & 0x1fff);
    return this.ram[offset] ?? 0xff;
  }

  public writeRam(address: number, value: number): void {
    if (!this.ramEnabled || this.ram.length === 0) {
      return;
    }

    const bank = this.getRamBank();
    const offset = bank * 0x2000 + (address & 0x1fff);
    this.ram[offset] = value & 0xff;
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

  private getRamBank(): number {
    if (this.ramBanks <= 1) {
      return 0;
    }

    return this.ramBank % this.ramBanks;
  }
}
