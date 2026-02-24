import { afterEach, describe, expect, it, vi } from 'vitest';
import { MBC3Mapper } from '../../src/core/cartridge/mbc/MBC3';

function buildBankedRom(banks: number): Uint8Array {
  const rom = new Uint8Array(banks * 0x4000);
  for (let bank = 0; bank < banks; bank += 1) {
    const start = bank * 0x4000;
    rom.fill(bank & 0xff, start, start + 0x4000);
  }

  return rom;
}

describe('MBC3 mapper', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('switches ROM banks and remaps bank 0 in switchable range to bank 1', () => {
    const mapper = new MBC3Mapper(buildBankedRom(8), 0);

    expect(mapper.readRom(0x4000)).toBe(1);

    mapper.writeRom(0x2000, 0x03);
    expect(mapper.readRom(0x4000)).toBe(3);

    mapper.writeRom(0x2000, 0x00);
    expect(mapper.readRom(0x4000)).toBe(1);
  });

  it('gates external RAM and switches RAM banks', () => {
    const mapper = new MBC3Mapper(buildBankedRom(4), 0x8000);

    mapper.writeRom(0x4000, 0x00);
    mapper.writeRam(0x0055, 0x12);
    expect(mapper.readRam(0x0055)).toBe(0xff);

    mapper.writeRom(0x0000, 0x0a);
    mapper.writeRam(0x0055, 0x11);

    mapper.writeRom(0x4000, 0x01);
    mapper.writeRam(0x0055, 0x22);

    mapper.writeRom(0x4000, 0x00);
    expect(mapper.readRam(0x0055)).toBe(0x11);

    mapper.writeRom(0x4000, 0x01);
    expect(mapper.readRam(0x0055)).toBe(0x22);
  });

  it('latches RTC state and sets day carry on overflow', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const mapper = new MBC3Mapper(buildBankedRom(4), 0);
    mapper.writeRom(0x0000, 0x0a);

    mapper.writeRom(0x4000, 0x08);
    mapper.writeRam(0x0000, 58);
    mapper.writeRom(0x4000, 0x09);
    mapper.writeRam(0x0000, 59);
    mapper.writeRom(0x4000, 0x0a);
    mapper.writeRam(0x0000, 23);
    mapper.writeRom(0x4000, 0x0b);
    mapper.writeRam(0x0000, 0xff);
    mapper.writeRom(0x4000, 0x0c);
    mapper.writeRam(0x0000, 0x01);

    mapper.writeRom(0x6000, 0x00);
    mapper.writeRom(0x6000, 0x01);
    mapper.writeRom(0x4000, 0x08);
    expect(mapper.readRam(0x0000)).toBe(58);

    nowSpy.mockReturnValue(1_002_000);
    mapper.writeRom(0x6000, 0x00);
    mapper.writeRom(0x6000, 0x01);
    mapper.writeRom(0x4000, 0x08);
    expect(mapper.readRam(0x0000)).toBe(0);
    mapper.writeRom(0x4000, 0x0c);
    expect(mapper.readRam(0x0000) & 0x80).toBe(0x80);
  });

  it('persists and restores RTC metadata with wall-clock advancement', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(10_000);
    const mapper = new MBC3Mapper(buildBankedRom(4), 0);
    mapper.writeRom(0x0000, 0x0a);
    mapper.writeRom(0x4000, 0x08);
    mapper.writeRam(0x0000, 30);

    const metadata = mapper.exportMetadata();

    nowSpy.mockReturnValue(15_000);
    const restored = new MBC3Mapper(buildBankedRom(4), 0);
    restored.writeRom(0x0000, 0x0a);
    restored.importMetadata(metadata);
    restored.writeRom(0x4000, 0x08);
    expect(restored.readRam(0x0000)).toBe(35);
  });
});
