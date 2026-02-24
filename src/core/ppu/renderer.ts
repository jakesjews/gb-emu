import { shadeFromPalette } from './palettes';

export interface RenderRegisters {
  lcdc: number;
  scx: number;
  scy: number;
  wy: number;
  wx: number;
  bgp: number;
  obp0: number;
  obp1: number;
}

function tileMapAddress(lcdc: number, forWindow: boolean): number {
  const useSecondMap = forWindow ? (lcdc & 0x40) !== 0 : (lcdc & 0x08) !== 0;
  return useSecondMap ? 0x1c00 : 0x1800;
}

function tileDataAddress(lcdc: number, tileNumber: number): number {
  if ((lcdc & 0x10) !== 0) {
    return tileNumber * 16;
  }

  const signedIndex = (tileNumber << 24) >> 24;
  return 0x1000 + signedIndex * 16;
}

function readTileColorId(vram: Uint8Array, address: number, x: number, y: number): number {
  const rowAddress = address + y * 2;
  const lo = vram[rowAddress] ?? 0;
  const hi = vram[rowAddress + 1] ?? 0;
  const bit = 7 - x;
  return (((hi >> bit) & 0x01) << 1) | ((lo >> bit) & 0x01);
}

function getBgColorId(vram: Uint8Array, regs: RenderRegisters, x: number, y: number): number {
  const tileX = (x >> 3) & 31;
  const tileY = (y >> 3) & 31;
  const tileMapBase = tileMapAddress(regs.lcdc, false);
  const tileNumber = vram[tileMapBase + tileY * 32 + tileX] ?? 0;
  const tileAddr = tileDataAddress(regs.lcdc, tileNumber);
  return readTileColorId(vram, tileAddr, x & 0x07, y & 0x07);
}

function getWindowColorId(vram: Uint8Array, regs: RenderRegisters, x: number, y: number): number {
  const tileX = (x >> 3) & 31;
  const tileY = (y >> 3) & 31;
  const tileMapBase = tileMapAddress(regs.lcdc, true);
  const tileNumber = vram[tileMapBase + tileY * 32 + tileX] ?? 0;
  const tileAddr = tileDataAddress(regs.lcdc, tileNumber);
  return readTileColorId(vram, tileAddr, x & 0x07, y & 0x07);
}

interface SpritePixel {
  colorId: number;
  palette: number;
  behindBg: boolean;
}

function getSpritePixel(
  vram: Uint8Array,
  oam: Uint8Array,
  regs: RenderRegisters,
  line: number,
  x: number,
): SpritePixel | null {
  if ((regs.lcdc & 0x02) === 0) {
    return null;
  }

  const spriteHeight = (regs.lcdc & 0x04) !== 0 ? 16 : 8;
  const sprites: Array<{ index: number; x: number; y: number; tile: number; flags: number }> = [];

  for (let i = 0; i < 40; i += 1) {
    const base = i * 4;
    const spriteY = (oam[base] ?? 0) - 16;
    const spriteX = (oam[base + 1] ?? 0) - 8;
    const tile = oam[base + 2] ?? 0;
    const flags = oam[base + 3] ?? 0;

    if (line < spriteY || line >= spriteY + spriteHeight) {
      continue;
    }

    sprites.push({ index: i, x: spriteX, y: spriteY, tile, flags });
    if (sprites.length === 10) {
      break;
    }
  }

  sprites.sort((a, b) => {
    if (a.x === b.x) {
      return a.index - b.index;
    }

    return a.x - b.x;
  });

  for (const sprite of sprites) {
    if (x < sprite.x || x >= sprite.x + 8) {
      continue;
    }

    let localX = x - sprite.x;
    let localY = line - sprite.y;

    if ((sprite.flags & 0x20) !== 0) {
      localX = 7 - localX;
    }

    if ((sprite.flags & 0x40) !== 0) {
      localY = spriteHeight - 1 - localY;
    }

    let tile = sprite.tile;
    if (spriteHeight === 16) {
      tile &= 0xfe;
      if (localY >= 8) {
        tile += 1;
        localY -= 8;
      }
    }

    const tileAddr = tile * 16;
    const colorId = readTileColorId(vram, tileAddr, localX, localY);
    if (colorId === 0) {
      continue;
    }

    return {
      colorId,
      palette: (sprite.flags & 0x10) !== 0 ? regs.obp1 : regs.obp0,
      behindBg: (sprite.flags & 0x80) !== 0,
    };
  }

  return null;
}

export function renderScanline(
  frameBuffer: Uint32Array,
  vram: Uint8Array,
  oam: Uint8Array,
  regs: RenderRegisters,
  line: number,
): void {
  const rowStart = line * 160;
  const bgEnabled = (regs.lcdc & 0x01) !== 0;
  const windowEnabled = (regs.lcdc & 0x20) !== 0 && line >= regs.wy;
  const windowX = regs.wx - 7;

  for (let x = 0; x < 160; x += 1) {
    let bgColorId = 0;

    if (bgEnabled) {
      const bgX = (x + regs.scx) & 0xff;
      const bgY = (line + regs.scy) & 0xff;
      bgColorId = getBgColorId(vram, regs, bgX, bgY);
    }

    if (windowEnabled && x >= windowX) {
      const winX = x - windowX;
      const winY = line - regs.wy;
      bgColorId = getWindowColorId(vram, regs, winX, winY);
    }

    let color = shadeFromPalette(regs.bgp, bgColorId);
    const sprite = getSpritePixel(vram, oam, regs, line, x);
    if (sprite) {
      const spriteVisible = !sprite.behindBg || bgColorId === 0;
      if (spriteVisible) {
        color = shadeFromPalette(sprite.palette, sprite.colorId);
      }
    }

    frameBuffer[rowStart + x] = color;
  }
}
