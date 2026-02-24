import { test, expect, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';

const TETRIS_ROM_PATH = path.resolve(process.cwd(), 'tests/roms/tetris.gb');
const maybeTest = existsSync(TETRIS_ROM_PATH) ? test : test.skip;

interface RenderState {
  frame_hash: number;
}

async function readState(page: Page): Promise<RenderState> {
  return page.evaluate(() => JSON.parse(window.render_game_to_text()) as RenderState);
}

async function advanceTime(page: Page, ms: number): Promise<void> {
  await page.evaluate((value) => {
    window.advanceTime(value);
  }, ms);
}

async function pressKey(page: Page, key: string, holdMs = 140, settleMs = 220): Promise<void> {
  await page.keyboard.down(key);
  await advanceTime(page, holdMs);
  await page.keyboard.up(key);
  await advanceTime(page, settleMs);
}

async function captureFrameHashes(page: Page, samples = 20, stepMs = 120): Promise<Set<number>> {
  const hashes = new Set<number>();
  for (let i = 0; i < samples; i += 1) {
    hashes.add((await readState(page)).frame_hash);
    await advanceTime(page, stepMs);
  }

  return hashes;
}

maybeTest('tetris gameplay becomes dynamic and reacts to input', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('input[type="file"]', TETRIS_ROM_PATH);
  await page.locator('canvas').click();

  // Drive the emulator deterministically via advanceTime to avoid rAF timing flakes.
  await advanceTime(page, 1500);

  // Boot/title -> 1-player -> game/music/level selections -> gameplay.
  for (const key of ['Enter', 'Enter', 'Enter', 'Enter', 'Enter', 'Enter']) {
    await pressKey(page, key);
    await advanceTime(page, 300);
  }

  let frameHashes = await captureFrameHashes(page);
  if (frameHashes.size <= 1) {
    for (let i = 0; i < 2 && frameHashes.size <= 1; i += 1) {
      await pressKey(page, 'Enter');
      await advanceTime(page, 350);
      frameHashes = await captureFrameHashes(page);
    }
  }

  expect(frameHashes.size, 'gameplay framebuffer should change over time').toBeGreaterThan(1);

  const beforeInputHash = (await readState(page)).frame_hash;

  await pressKey(page, 'ArrowLeft', 160, 120);
  await pressKey(page, 'ArrowRight', 160, 120);
  await pressKey(page, 'ArrowDown', 160, 120);
  await pressKey(page, 'x', 120, 120);
  await advanceTime(page, 500);

  const afterInputHash = (await readState(page)).frame_hash;

  expect(afterInputHash, 'input burst should change gameplay state').not.toBe(beforeInputHash);
});
