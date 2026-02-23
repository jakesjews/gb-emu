import type { CartridgeInfo } from '../../types/emulator';

const ROM_SIZE_MAP: Record<number, number> = {
  0x00: 32 * 1024,
  0x01: 64 * 1024,
  0x02: 128 * 1024,
  0x03: 256 * 1024,
  0x04: 512 * 1024,
  0x05: 1024 * 1024,
  0x06: 2 * 1024 * 1024,
  0x07: 4 * 1024 * 1024,
  0x08: 8 * 1024 * 1024,
};

const RAM_SIZE_MAP: Record<number, number> = {
  0x00: 0,
  0x01: 2 * 1024,
  0x02: 8 * 1024,
  0x03: 32 * 1024,
  0x04: 128 * 1024,
  0x05: 64 * 1024,
};

const CARTRIDGE_TYPE_MAP: Record<number, string> = {
  0x00: 'ROM_ONLY',
  0x01: 'MBC1',
  0x02: 'MBC1+RAM',
  0x03: 'MBC1+RAM+BATTERY',
};

export interface ParsedHeader extends CartridgeInfo {
  typeCode: number;
  romBanks: number;
  ramBanks: number;
}

function parseTitle(rom: Uint8Array): string {
  const bytes = rom.subarray(0x0134, 0x0144);
  let end = bytes.length;
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] === 0) {
      end = i;
      break;
    }
  }

  return new TextDecoder().decode(bytes.subarray(0, end)).trim();
}

export function parseHeader(rom: Uint8Array): ParsedHeader {
  if (rom.length < 0x150) {
    throw new Error('ROM too small to contain a valid Game Boy header.');
  }

  const typeCode = rom[0x0147];
  if (!(typeCode in CARTRIDGE_TYPE_MAP)) {
    throw new Error(`Unsupported cartridge type 0x${typeCode.toString(16).padStart(2, '0')}.`);
  }

  const romSizeCode = rom[0x0148];
  const romSize = ROM_SIZE_MAP[romSizeCode];
  if (!romSize) {
    throw new Error(`Unsupported ROM size code 0x${romSizeCode.toString(16).padStart(2, '0')}.`);
  }

  const ramSizeCode = rom[0x0149];
  const ramSize = RAM_SIZE_MAP[ramSizeCode];
  if (ramSize === undefined) {
    throw new Error(`Unsupported RAM size code 0x${ramSizeCode.toString(16).padStart(2, '0')}.`);
  }

  if (rom.length < romSize) {
    throw new Error(`ROM data is truncated: expected ${romSize} bytes, got ${rom.length}.`);
  }

  const romBanks = Math.max(2, romSize / 0x4000);
  const ramBanks = ramSize === 0 ? 0 : Math.max(1, ramSize / 0x2000);

  return {
    title: parseTitle(rom),
    type: CARTRIDGE_TYPE_MAP[typeCode],
    typeCode,
    romSize,
    ramSize,
    romBanks,
    ramBanks,
    cgbFlag: rom[0x0143],
    sgbFlag: rom[0x0146],
  };
}
