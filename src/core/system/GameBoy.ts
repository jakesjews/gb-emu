import type { Button, CartridgeInfo, DebugSnapshot } from '../../types/emulator';
import { APUStub } from '../apu/APUStub';
import { Cartridge } from '../cartridge/Cartridge';
import { CPU } from '../cpu/CPU';
import { Joypad } from '../input/Joypad';
import { InterruptController } from '../interrupts/InterruptController';
import { Bus } from '../memory/Bus';
import { MMU } from '../memory/MMU';
import { PPU } from '../ppu/PPU';
import { Serial } from '../serial/Serial';
import { Timer } from '../timer/Timer';

const CYCLES_PER_FRAME = 70224;

export class GameBoy {
  private readonly interrupts = new InterruptController();

  private readonly mmu = new MMU();

  private readonly ppu = new PPU(this.interrupts);

  private readonly timer = new Timer(this.interrupts);

  private readonly joypad = new Joypad(this.interrupts);

  private readonly serial = new Serial(this.interrupts);

  private readonly apu = new APUStub();

  private readonly bus = new Bus(
    this.mmu,
    this.ppu,
    this.timer,
    this.interrupts,
    this.joypad,
    this.serial,
    this.apu,
  );

  private readonly cpu = new CPU(
    this.bus,
    this.interrupts,
    (cycles) => {
      this.tickTimerEarly(cycles);
    },
    (cycles) => {
      this.tickNonTimerSubsystemsEarly(cycles);
    },
  );

  private cartridge: Cartridge | null = null;

  private onFrameHandlers: Array<(frame: Uint32Array) => void> = [];

  private running = false;

  public async loadRom(rom: ArrayBuffer): Promise<void> {
    this.cartridge = new Cartridge(rom);
    this.bus.attachCartridge(this.cartridge);
    this.reset();
  }

  public reset(): void {
    this.running = false;
    this.interrupts.reset();
    this.mmu.reset();
    this.joypad.reset();
    this.serial.reset();
    this.timer.reset();
    this.ppu.reset();
    this.apu.reset();
    this.cpu.reset();

    this.bus.write8(0xff05, 0x00);
    this.bus.write8(0xff06, 0x00);
    this.bus.write8(0xff07, 0x00);
    this.bus.write8(0xff10, 0x80);
    this.bus.write8(0xff11, 0xbf);
    this.bus.write8(0xff12, 0xf3);
    this.bus.write8(0xff14, 0xbf);
    this.bus.write8(0xff16, 0x3f);
    this.bus.write8(0xff17, 0x00);
    this.bus.write8(0xff19, 0xbf);
    this.bus.write8(0xff1a, 0x7f);
    this.bus.write8(0xff1b, 0xff);
    this.bus.write8(0xff1c, 0x9f);
    this.bus.write8(0xff1e, 0xbf);
    this.bus.write8(0xff20, 0xff);
    this.bus.write8(0xff21, 0x00);
    this.bus.write8(0xff22, 0x00);
    this.bus.write8(0xff23, 0xbf);
    this.bus.write8(0xff24, 0x77);
    this.bus.write8(0xff25, 0xf3);
    this.bus.write8(0xff26, 0xf1);
    this.bus.write8(0xff40, 0x91);
    this.bus.write8(0xff42, 0x00);
    this.bus.write8(0xff43, 0x00);
    this.bus.write8(0xff45, 0x00);
    this.bus.write8(0xff47, 0xfc);
    this.bus.write8(0xff48, 0xff);
    this.bus.write8(0xff49, 0xff);
    this.bus.write8(0xff4a, 0x00);
    this.bus.write8(0xff4b, 0x00);
    this.bus.write8(0xffff, 0x00);
  }

  public start(): void {
    this.running = true;
  }

  public pause(): void {
    this.running = false;
  }

  public isRunning(): boolean {
    return this.running;
  }

  public stepInstruction(): number {
    if (!this.cartridge) {
      return 0;
    }

    const cycles = this.cpu.step();
    const earlyTimerCycles = this.cpu.consumeTimerEarlyTickCycles();
    const earlyNonTimerCycles = this.cpu.consumeNonTimerEarlyTickCycles();
    this.tickSubsystems(
      cycles,
      Math.max(0, cycles - earlyTimerCycles),
      Math.max(0, cycles - earlyNonTimerCycles),
    );
    return cycles;
  }

  public stepFrame(): void {
    if (!this.cartridge) {
      return;
    }

    let emitted = false;
    let consumed = 0;
    while (!emitted && consumed < CYCLES_PER_FRAME * 2) {
      const cycles = this.cpu.step();
      consumed += cycles;
      const earlyTimerCycles = this.cpu.consumeTimerEarlyTickCycles();
      const earlyNonTimerCycles = this.cpu.consumeNonTimerEarlyTickCycles();
      emitted = this.tickSubsystems(
        cycles,
        Math.max(0, cycles - earlyTimerCycles),
        Math.max(0, cycles - earlyNonTimerCycles),
      );
    }

    if (!emitted) {
      this.emitFrame();
    }
  }

  public runForCycles(cycles: number): void {
    if (!this.cartridge || cycles <= 0) {
      return;
    }

    let remaining = cycles;
    while (remaining > 0) {
      const elapsed = this.cpu.step();
      remaining -= elapsed;
      const earlyTimerCycles = this.cpu.consumeTimerEarlyTickCycles();
      const earlyNonTimerCycles = this.cpu.consumeNonTimerEarlyTickCycles();
      this.tickSubsystems(
        elapsed,
        Math.max(0, elapsed - earlyTimerCycles),
        Math.max(0, elapsed - earlyNonTimerCycles),
      );
    }
  }

  public setButtonState(button: Button, pressed: boolean): void {
    this.joypad.setButtonState(button, pressed);
  }

  public releaseAllButtons(): void {
    this.joypad.releaseAll();
  }

  public onFrameFinished(callback: (frame: Uint32Array) => void): void {
    this.onFrameHandlers = [...this.onFrameHandlers, callback];
  }

  public getFrameBuffer(): Uint32Array {
    return this.ppu.getFrameBuffer();
  }

  public getDebugSnapshot(): DebugSnapshot {
    return {
      pc: this.cpu.registers.pc,
      sp: this.cpu.registers.sp,
      af: this.cpu.registers.af,
      bc: this.cpu.registers.bc,
      de: this.cpu.registers.de,
      hl: this.cpu.registers.hl,
      ime: this.cpu.ime,
      ie: this.interrupts.readIE(),
      if: this.interrupts.readIF(),
      ly: this.ppu.getLY(),
      lcdc: this.ppu.getLCDC(),
      stat: this.ppu.getSTAT(),
      cycles: this.cpu.cycles,
      opcode: this.cpu.lastOpcode,
      halted: this.cpu.halted,
    };
  }

  public getSerialOutput(): string {
    return this.serial.getOutputAsString();
  }

  public clearSerialOutput(): void {
    this.serial.clearOutput();
  }

  public exportSaveRam(): Uint8Array | null {
    return this.cartridge?.exportRam() ?? null;
  }

  public importSaveRam(data: Uint8Array): void {
    this.cartridge?.importRam(data);
  }

  public exportSaveMetadata(): unknown {
    return this.cartridge?.exportMapperMetadata() ?? null;
  }

  public importSaveMetadata(metadata: unknown): void {
    this.cartridge?.importMapperMetadata(metadata);
  }

  public isSaveRamDirty(): boolean {
    return this.cartridge?.isRamDirty() ?? false;
  }

  public clearSaveRamDirtyFlag(): void {
    this.cartridge?.clearRamDirtyFlag();
  }

  public getCartridgeInfo(): CartridgeInfo | null {
    return this.cartridge?.info ?? null;
  }

  public getRomBytes(): Uint8Array | null {
    return this.cartridge?.getRomBytes() ?? null;
  }

  public getJoypadDebug(): {
    lastRead: number;
    lastWrite: number;
    readCount: number;
    writeCount: number;
    selectButtons: boolean;
    selectDpad: boolean;
    sawButtonSelectLow: boolean;
    sawDpadSelectLow: boolean;
    buttons: {
      up: boolean;
      down: boolean;
      left: boolean;
      right: boolean;
      a: boolean;
      b: boolean;
      start: boolean;
      select: boolean;
    };
  } {
    return this.joypad.getDebugInfo();
  }

  public readByteDebug(address: number): number {
    return this.bus.read8(address & 0xffff);
  }

  public getCompatFlags(): {
    dmaActive: boolean;
    timerReloadPending: boolean;
    lcdEnabled: boolean;
  } {
    return {
      dmaActive: this.bus.isDmaActive(),
      timerReloadPending: this.timer.isReloadPending(),
      lcdEnabled: (this.ppu.getLCDC() & 0x80) !== 0,
    };
  }

  private tickSubsystems(cycles: number, timerCycles = cycles, nonTimerCycles = cycles): boolean {
    if (cycles <= 0 && timerCycles <= 0 && nonTimerCycles <= 0) {
      return false;
    }

    if (nonTimerCycles > 0) {
      this.bus.tick(nonTimerCycles);
      this.ppu.tick(nonTimerCycles);
      this.serial.tick(nonTimerCycles);
      this.apu.tick(nonTimerCycles);
    }

    if (timerCycles > 0) {
      this.timer.tick(timerCycles);
    }

    if (this.ppu.consumeFrameReady()) {
      this.emitFrame();
      return true;
    }

    return false;
  }

  private tickTimerEarly(cycles: number): void {
    if (cycles <= 0) {
      return;
    }

    this.timer.tick(cycles);
  }

  private tickNonTimerSubsystemsEarly(cycles: number): void {
    if (cycles <= 0) {
      return;
    }

    this.bus.tick(cycles);
    this.ppu.tick(cycles);
    this.serial.tick(cycles);
    this.apu.tick(cycles);

    if (this.ppu.consumeFrameReady()) {
      this.emitFrame();
    }
  }

  private emitFrame(): void {
    const frame = this.ppu.getFrameBuffer();
    for (const callback of this.onFrameHandlers) {
      callback(frame);
    }
  }
}
