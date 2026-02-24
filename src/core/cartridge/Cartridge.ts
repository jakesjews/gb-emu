import type { CartridgeInfo } from '../../types/emulator';
import { parseHeader } from './header';
import { MBC1Mapper } from './mbc/MBC1';
import { MBC3Mapper } from './mbc/MBC3';
import { MBC5Mapper } from './mbc/MBC5';
import { RomOnlyMapper } from './mbc/RomOnly';

export interface Mapper {
  dirtyRam: boolean;
  readRom(address: number): number;
  writeRom(address: number, value: number): void;
  readRam(address: number): number;
  writeRam(address: number, value: number): void;
  getRam(): Uint8Array | null;
  loadRam(data: Uint8Array): void;
  clearDirtyFlag(): void;
  exportMetadata?(): unknown;
  importMetadata?(metadata: unknown): void;
}

export class Cartridge {
  public readonly info: CartridgeInfo;

  private readonly mapper: Mapper;

  private readonly romBytes: Uint8Array;

  public constructor(romBuffer: ArrayBuffer) {
    this.romBytes = new Uint8Array(romBuffer);
    const parsed = parseHeader(this.romBytes);
    this.info = {
      title: parsed.title,
      type: parsed.type,
      romSize: parsed.romSize,
      ramSize: parsed.ramSize,
      cgbFlag: parsed.cgbFlag,
      sgbFlag: parsed.sgbFlag,
    };

    switch (parsed.typeCode) {
      case 0x00:
        this.mapper = new RomOnlyMapper(this.romBytes, parsed.ramSize);
        break;
      case 0x01:
      case 0x02:
      case 0x03:
        this.mapper = new MBC1Mapper(this.romBytes, parsed.ramSize);
        break;
      case 0x0f:
      case 0x10:
      case 0x11:
      case 0x12:
      case 0x13:
        this.mapper = new MBC3Mapper(this.romBytes, parsed.ramSize);
        break;
      case 0x19:
      case 0x1a:
      case 0x1b:
      case 0x1c:
      case 0x1d:
      case 0x1e:
        this.mapper = new MBC5Mapper(this.romBytes, parsed.ramSize);
        break;
      default:
        throw new Error(`Unsupported cartridge type ${parsed.type}.`);
    }
  }

  public readRom(address: number): number {
    return this.mapper.readRom(address & 0x7fff);
  }

  public writeRom(address: number, value: number): void {
    this.mapper.writeRom(address & 0x7fff, value & 0xff);
  }

  public readRam(address: number): number {
    return this.mapper.readRam(address & 0x1fff);
  }

  public writeRam(address: number, value: number): void {
    this.mapper.writeRam(address & 0x1fff, value & 0xff);
  }

  public isRamDirty(): boolean {
    return this.mapper.dirtyRam;
  }

  public clearRamDirtyFlag(): void {
    this.mapper.clearDirtyFlag();
  }

  public exportRam(): Uint8Array | null {
    const ram = this.mapper.getRam();
    if (!ram) {
      return null;
    }

    return new Uint8Array(ram);
  }

  public importRam(data: Uint8Array): void {
    this.mapper.loadRam(data);
  }

  public exportMapperMetadata(): unknown {
    return this.mapper.exportMetadata?.() ?? null;
  }

  public importMapperMetadata(metadata: unknown): void {
    this.mapper.importMetadata?.(metadata);
  }

  public getRomBytes(): Uint8Array {
    return this.romBytes;
  }
}
