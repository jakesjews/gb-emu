import { describe, expect, it } from 'vitest';
import { MBC5Mapper } from '../../src/core/cartridge/mbc/MBC5';

function buildBankedRom(banks: number): Uint8Array {
  const rom = new Uint8Array(banks * 0x4000);
  for (let bank = 0; bank < banks; bank += 1) {
    const start = bank * 0x4000;
    rom[start] = bank & 0xff;
    rom[start + 1] = (bank >> 8) & 0xff;
  }

  return rom;
}

describe('MBC5 mapper', () => {
  it('supports 9-bit ROM bank selection', () => {
    const mapper = new MBC5Mapper(buildBankedRom(512), 0);
    expect(mapper.readRom(0x4000)).toBe(1);
    expect(mapper.readRom(0x4001)).toBe(0);

    mapper.writeRom(0x2000, 0x34);
    mapper.writeRom(0x3000, 0x01);
    expect(mapper.readRom(0x4000)).toBe(0x34);
    expect(mapper.readRom(0x4001)).toBe(0x01);
  });

  it('gates and switches RAM banks', () => {
    const mapper = new MBC5Mapper(buildBankedRom(16), 0x10000);

    mapper.writeRam(0x0123, 0x10);
    expect(mapper.readRam(0x0123)).toBe(0xff);

    mapper.writeRom(0x0000, 0x0a);
    mapper.writeRom(0x4000, 0x02);
    mapper.writeRam(0x0123, 0x77);
    mapper.writeRom(0x4000, 0x03);
    mapper.writeRam(0x0123, 0x88);

    mapper.writeRom(0x4000, 0x02);
    expect(mapper.readRam(0x0123)).toBe(0x77);
    mapper.writeRom(0x4000, 0x03);
    expect(mapper.readRam(0x0123)).toBe(0x88);
  });
});
