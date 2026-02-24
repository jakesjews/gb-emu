import { describe, expect, it } from 'vitest';
import { APUStub } from '../../src/core/apu/APUStub';
import { Cartridge } from '../../src/core/cartridge/Cartridge';
import { Joypad } from '../../src/core/input/Joypad';
import { InterruptController } from '../../src/core/interrupts/InterruptController';
import { Bus } from '../../src/core/memory/Bus';
import { MMU } from '../../src/core/memory/MMU';
import { PPU } from '../../src/core/ppu/PPU';
import { Serial } from '../../src/core/serial/Serial';
import { Timer } from '../../src/core/timer/Timer';

function buildRom(fill: number): Uint8Array {
  const rom = new Uint8Array(0x8000);
  rom.fill(fill & 0xff);
  rom[0x0147] = 0x00;
  rom[0x0148] = 0x00;
  rom[0x0149] = 0x00;
  return rom;
}

function createBus(romFill = 0x11): { bus: Bus; mmu: MMU } {
  const interrupts = new InterruptController();
  const mmu = new MMU();
  const ppu = new PPU(interrupts);
  const timer = new Timer(interrupts);
  const joypad = new Joypad(interrupts);
  const serial = new Serial(interrupts);
  const apu = new APUStub();
  const bus = new Bus(mmu, ppu, timer, interrupts, joypad, serial, apu);

  const rom = buildRom(romFill);
  const romBuffer = rom.buffer.slice(
    rom.byteOffset,
    rom.byteOffset + rom.byteLength,
  ) as ArrayBuffer;
  bus.attachCartridge(new Cartridge(romBuffer));
  bus.write8(0xff40, 0x00); // Disable LCD so OAM visibility only reflects DMA behavior.

  return { bus, mmu };
}

describe('Bus DMA timing edges', () => {
  it('blocks OAM from the first M-cycle after a fresh DMA start', () => {
    const { bus } = createBus(0x11);
    bus.write8(0xfe00, 0x12);

    bus.write8(0xff46, 0x80);
    expect(bus.read8(0xfe00)).toBe(0x12);

    bus.tick(4); // M1 after write -> DMA bus block active
    expect(bus.read8(0xfe00)).toBe(0xff);
  });

  it('switches to the restarted DMA source immediately while remaining blocked', () => {
    const { bus, mmu } = createBus(0x11);
    mmu.wram.fill(0x77);

    bus.write8(0xff46, 0x00); // ROM source
    bus.tick(8); // DMA block active with ROM source
    expect(bus.read8(0xc000)).toBe(0x11);

    bus.write8(0xff46, 0xc0); // restart from WRAM source
    expect(bus.read8(0xc000)).toBe(0x77);

    bus.tick(4);
    expect(bus.read8(0xc000)).toBe(0x77);
  });
});
