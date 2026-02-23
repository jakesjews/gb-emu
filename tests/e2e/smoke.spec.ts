import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function createMinimalRomFile(): { filePath: string; cleanup: () => void } {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'gb-rom-'));
  const filePath = path.join(tempDir, 'minimal.gb');

  const rom = new Uint8Array(0x8000);
  rom[0x0147] = 0x00;
  rom[0x0148] = 0x00;
  rom[0x0149] = 0x00;
  rom[0x0100] = 0x18;
  rom[0x0101] = 0xfe;

  writeFileSync(filePath, rom);

  return {
    filePath,
    cleanup: () => rmSync(tempDir, { recursive: true, force: true }),
  };
}

test('loads a ROM and exposes deterministic hooks', async ({ page }) => {
  const fixture = createMinimalRomFile();

  try {
    await page.goto('/');

    await page.setInputFiles('input[type="file"]', fixture.filePath);

    await page.getByRole('button', { name: 'Run' }).click();
    await page.waitForTimeout(100);

    const state = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
    expect(state.rom).toBeTruthy();
    expect(state.mode).toBe('running');

    await page.evaluate(() => window.advanceTime(100));

    const stateAfterAdvance = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
    expect(stateAfterAdvance.cpu.cycles).toBeGreaterThan(state.cpu.cycles);
  } finally {
    fixture.cleanup();
  }
});
