import { APUStub } from '../apu/APUStub';
import { Cartridge } from '../cartridge/Cartridge';
import { Joypad } from '../input/Joypad';
import { InterruptController } from '../interrupts/InterruptController';
import { MMU } from './MMU';
import { PPU } from '../ppu/PPU';
import { Serial } from '../serial/Serial';
import { Timer } from '../timer/Timer';

export class Bus {
  private static readonly DMA_START_DELAY_CYCLES = 12;

  private cartridge: Cartridge | null = null;

  private readonly mmu: MMU;

  private readonly ppu: PPU;

  private readonly timer: Timer;

  private readonly interrupts: InterruptController;

  private readonly joypad: Joypad;

  private readonly serial: Serial;

  private readonly apu: APUStub;

  private dmaActive = false;

  private dmaSourceBase = 0;

  private dmaByteIndex = 0;

  private dmaCycleAccumulator = 0;

  private dmaStartDelayCycles = 0;

  private dmaRestartPending = false;

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
    this.dmaActive = false;
    this.dmaSourceBase = 0;
    this.dmaByteIndex = 0;
    this.dmaCycleAccumulator = 0;
    this.dmaStartDelayCycles = 0;
    this.dmaRestartPending = false;
  }

  public tick(cycles: number): void {
    if (!this.dmaActive || cycles <= 0) {
      return;
    }

    let remaining = cycles;

    if (this.dmaStartDelayCycles > 0) {
      const consumed = Math.min(this.dmaStartDelayCycles, remaining);
      this.dmaStartDelayCycles -= consumed;
      remaining -= consumed;
      if (this.dmaStartDelayCycles === 0) {
        this.dmaRestartPending = false;
      }
    }

    if (remaining <= 0 || this.dmaStartDelayCycles > 0) {
      return;
    }

    this.dmaCycleAccumulator += remaining;
    while (this.dmaActive && this.dmaCycleAccumulator >= 4) {
      this.dmaCycleAccumulator -= 4;
      const source = (this.dmaSourceBase + this.dmaByteIndex) & 0xffff;
      const value = this.readDmaSourceByte(source);
      this.ppu.writeOamDirect(this.dmaByteIndex, value);
      this.dmaByteIndex += 1;

      if (this.dmaByteIndex >= 0xa0) {
        this.dmaActive = false;
        this.dmaByteIndex = 0;
        this.dmaCycleAccumulator = 0;
        this.dmaStartDelayCycles = 0;
        this.dmaRestartPending = false;
      }
    }
  }

  public isDmaActive(): boolean {
    return this.dmaActive;
  }

  public read8(address: number): number {
    const addr = address & 0xffff;

    if (this.isCpuDmaBlockedAddress(addr) && addr !== 0xff46) {
      return this.readCpuDmaBlockedValue(addr);
    }

    if (addr <= 0x7fff) {
      return this.cartridge?.readRom(addr) ?? 0xff;
    }

    if (addr <= 0x9fff) {
      if (!this.ppu.canReadVRAM()) {
        return 0xff;
      }
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
      if (this.isDmaBlockingActive() || !this.ppu.canReadOAM()) {
        return 0xff;
      }
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

    if (this.isCpuDmaBlockedAddress(addr) && addr !== 0xff46) {
      return;
    }

    if (addr <= 0x7fff) {
      this.cartridge?.writeRom(addr, masked);
      return;
    }

    if (addr <= 0x9fff) {
      if (!this.ppu.canWriteVRAM()) {
        return;
      }
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
      if (this.isDmaBlockingActive() || !this.ppu.canWriteOAM()) {
        return;
      }
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
        this.startDmaTransfer(masked);
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

  private startDmaTransfer(page: number): void {
    const wasActive = this.dmaActive;
    this.dmaActive = true;
    this.dmaSourceBase = (page & 0xff) << 8;
    this.dmaByteIndex = 0;
    this.dmaCycleAccumulator = 0;
    this.dmaStartDelayCycles = Bus.DMA_START_DELAY_CYCLES;
    this.dmaRestartPending = wasActive;
  }

  private isCpuDmaBlockedAddress(address: number): boolean {
    if (!this.isDmaBlockingActive()) {
      return false;
    }

    if (this.isHramAddress(address)) {
      return false;
    }

    if (this.isOamAddress(address)) {
      return true;
    }

    // When DMA source is VRAM, external/WRAM bus stays accessible.
    if (this.isDmaSourceInVram()) {
      return this.isVramAddress(address);
    }

    // Non-VRAM DMA sources occupy the external bus and block non-HRAM accesses.
    return true;
  }

  private isHramAddress(address: number): boolean {
    return address >= 0xff80 && address <= 0xfffe;
  }

  private isVramAddress(address: number): boolean {
    return address >= 0x8000 && address <= 0x9fff;
  }

  private isOamAddress(address: number): boolean {
    return address >= 0xfe00 && address <= 0xfe9f;
  }

  private isDmaSourceInVram(): boolean {
    return this.dmaSourceBase >= 0x8000 && this.dmaSourceBase <= 0x9fff;
  }

  private readDmaSourceByte(address: number): number {
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

    return 0xff;
  }

  private readCpuDmaBlockedValue(address: number): number {
    if (!this.isDmaBlockingActive()) {
      return 0xff;
    }

    if (this.isOamAddress(address)) {
      return 0xff;
    }

    const sourceAddress = (this.dmaSourceBase + this.dmaByteIndex) & 0xffff;
    return this.readDmaSourceByte(sourceAddress);
  }

  private isDmaBlockingActive(): boolean {
    if (!this.dmaActive) {
      return false;
    }

    if (this.dmaRestartPending) {
      return true;
    }

    // Fresh DMA starts blocking one M-cycle after the FF46 write.
    return this.dmaStartDelayCycles <= 8;
  }
}
