export const DMG_COLORS: ReadonlyArray<number> = [0xffe0f8d0, 0xff88c070, 0xff346856, 0xff081820];

export function shadeFromPalette(palette: number, colorId: number): number {
  const shift = (colorId & 0x03) * 2;
  const shade = (palette >> shift) & 0x03;
  return DMG_COLORS[shade] ?? DMG_COLORS[0];
}
