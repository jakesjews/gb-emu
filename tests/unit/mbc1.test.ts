import { describe, expect, it } from 'vitest';
import { MBC1Mapper } from '../../src/core/cartridge/mbc/MBC1';

function buildBankedRom(banks: number): Uint8Array {
  const rom = new Uint8Array(banks * 0x4000);
  for (let bank = 0; bank < banks; bank += 1) {
    rom.fill(bank & 0xff, bank * 0x4000, (bank + 1) * 0x4000);
  }

  return rom;
}

describe('MBC1 mapper', () => {
  it('switches ROM banks', () => {
    const rom = buildBankedRom(8);
    const mapper = new MBC1Mapper(rom, 0);

    expect(mapper.readRom(0x4000)).toBe(1);

    mapper.writeRom(0x2000, 0x03);
    expect(mapper.readRom(0x4000)).toBe(3);

    mapper.writeRom(0x2000, 0x00);
    expect(mapper.readRom(0x4000)).toBe(1);
  });

  it('honors RAM enable for writes', () => {
    const rom = buildBankedRom(4);
    const mapper = new MBC1Mapper(rom, 0x2000);

    mapper.writeRam(0x0100, 0x42);
    expect(mapper.readRam(0x0100)).toBe(0xff);

    mapper.writeRom(0x0000, 0x0a);
    mapper.writeRam(0x0100, 0x42);
    expect(mapper.readRam(0x0100)).toBe(0x42);
  });
});
