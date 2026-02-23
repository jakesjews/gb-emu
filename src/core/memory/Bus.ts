import { APUStub } from '../apu/APUStub';
import { Cartridge } from '../cartridge/Cartridge';
import { Joypad } from '../input/Joypad';
import { InterruptController } from '../interrupts/InterruptController';
import { MMU } from './MMU';
import { PPU } from '../ppu/PPU';
import { Serial } from '../serial/Serial';
import { Timer } from '../timer/Timer';

export class Bus {
  private cartridge: Cartridge | null = null;

  private readonly mmu: MMU;

  private readonly ppu: PPU;

  private readonly timer: Timer;

  private readonly interrupts: InterruptController;

  private readonly joypad: Joypad;

  private readonly serial: Serial;

  private readonly apu: APUStub;

  public constructor(
    mmu: MMU,
    ppu: PPU,
    timer: Timer,
    interrupts: InterruptController,
    joypad: Joypad,
    serial: Serial,
    apu: APUStub,
  ) {
    this.mmu = mmu;
    this.ppu = ppu;
    this.timer = timer;
    this.interrupts = interrupts;
    this.joypad = joypad;
    this.serial = serial;
    this.apu = apu;
  }

  public attachCartridge(cartridge: Cartridge): void {
    this.cartridge = cartridge;
  }

  public getCartridge(): Cartridge | null {
    return this.cartridge;
  }

  public reset(): void {
    this.mmu.reset();
  }

  public read8(address: number): number {
    const addr = address & 0xffff;

    if (addr <= 0x7fff) {
      return this.cartridge?.readRom(addr) ?? 0xff;
    }

    if (addr <= 0x9fff) {
      return this.ppu.readVRAM(addr - 0x8000);
    }

    if (addr <= 0xbfff) {
      return this.cartridge?.readRam(addr - 0xa000) ?? 0xff;
    }

    if (addr <= 0xdfff) {
      return this.mmu.wram[addr - 0xc000];
    }

    if (addr <= 0xfdff) {
      return this.mmu.wram[addr - 0xe000];
    }

    if (addr <= 0xfe9f) {
      return this.ppu.readOAM(addr - 0xfe00);
    }

    if (addr <= 0xfeff) {
      return 0xff;
    }

    if (addr === 0xff00) {
      return this.joypad.read();
    }

    if (addr === 0xff01) {
      return this.serial.readSB();
    }

    if (addr === 0xff02) {
      return this.serial.readSC();
    }

    if (addr === 0xff04) {
      return this.timer.readDIV();
    }

    if (addr === 0xff05) {
      return this.timer.readTIMA();
    }

    if (addr === 0xff06) {
      return this.timer.readTMA();
    }

    if (addr === 0xff07) {
      return this.timer.readTAC();
    }

    if (addr === 0xff0f) {
      return this.interrupts.readIF();
    }

    if (addr >= 0xff10 && addr <= 0xff3f) {
      return this.apu.read(addr);
    }

    if (addr >= 0xff40 && addr <= 0xff4b) {
      return this.ppu.readRegister(addr);
    }

    if (addr >= 0xff80 && addr <= 0xfffe) {
      return this.mmu.hram[addr - 0xff80];
    }

    if (addr === 0xffff) {
      return this.interrupts.readIE();
    }

    return 0xff;
  }

  public write8(address: number, value: number): void {
    const addr = address & 0xffff;
    const masked = value & 0xff;

    if (addr <= 0x7fff) {
      this.cartridge?.writeRom(addr, masked);
      return;
    }

    if (addr <= 0x9fff) {
      this.ppu.writeVRAM(addr - 0x8000, masked);
      return;
    }

    if (addr <= 0xbfff) {
      this.cartridge?.writeRam(addr - 0xa000, masked);
      return;
    }

    if (addr <= 0xdfff) {
      this.mmu.wram[addr - 0xc000] = masked;
      return;
    }

    if (addr <= 0xfdff) {
      this.mmu.wram[addr - 0xe000] = masked;
      return;
    }

    if (addr <= 0xfe9f) {
      this.ppu.writeOAM(addr - 0xfe00, masked);
      return;
    }

    if (addr <= 0xfeff) {
      return;
    }

    if (addr === 0xff00) {
      this.joypad.write(masked);
      return;
    }

    if (addr === 0xff01) {
      this.serial.writeSB(masked);
      return;
    }

    if (addr === 0xff02) {
      this.serial.writeSC(masked);
      return;
    }

    if (addr === 0xff04) {
      this.timer.writeDIV();
      return;
    }

    if (addr === 0xff05) {
      this.timer.writeTIMA(masked);
      return;
    }

    if (addr === 0xff06) {
      this.timer.writeTMA(masked);
      return;
    }

    if (addr === 0xff07) {
      this.timer.writeTAC(masked);
      return;
    }

    if (addr === 0xff0f) {
      this.interrupts.writeIF(masked);
      return;
    }

    if (addr >= 0xff10 && addr <= 0xff3f) {
      this.apu.write(addr, masked);
      return;
    }

    if (addr >= 0xff40 && addr <= 0xff4b) {
      this.ppu.writeRegister(addr, masked);
      if (addr === 0xff46) {
        this.doDmaTransfer(masked);
      }
      return;
    }

    if (addr >= 0xff80 && addr <= 0xfffe) {
      this.mmu.hram[addr - 0xff80] = masked;
      return;
    }

    if (addr === 0xffff) {
      this.interrupts.writeIE(masked);
    }
  }

  public read16(address: number): number {
    const lo = this.read8(address);
    const hi = this.read8((address + 1) & 0xffff);
    return lo | (hi << 8);
  }

  public write16(address: number, value: number): void {
    this.write8(address, value & 0xff);
    this.write8((address + 1) & 0xffff, (value >> 8) & 0xff);
  }

  private doDmaTransfer(page: number): void {
    const source = (page & 0xff) << 8;
    for (let i = 0; i < 0xa0; i += 1) {
      const value = this.read8((source + i) & 0xffff);
      this.ppu.writeOamDirect(i, value);
    }
  }
}
