import { expect, test, type Page } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});

interface RenderState {
  mode: string;
  joypad: {
    buttons: {
      left: boolean;
      a: boolean;
    };
  };
}

function createMinimalRomFile(): { filePath: string; cleanup: () => void } {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'gb-rom-mobile-'));
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

async function readState(page: Page): Promise<RenderState> {
  return page.evaluate(() => JSON.parse(window.render_game_to_text()) as RenderState);
}

test('mobile view shows virtual controls and updates joypad state via pointer events', async ({
  page,
}) => {
  const fixture = createMinimalRomFile();

  try {
    await page.goto('/');

    await expect(page.locator('.mobile-controls-card')).toBeVisible();
    await expect(page.locator('.debug-card')).toBeHidden();

    await page.setInputFiles('.mobile-controls-card input[type="file"]', fixture.filePath);
    await page.locator('[data-mobile-action="run"]').click();
    await page.waitForTimeout(120);

    const runningState = await readState(page);
    expect(runningState.mode).toBe('running');

    const leftButton = page.locator('[data-mobile-btn="left"]');
    const aButton = page.locator('[data-mobile-btn="a"]');

    await leftButton.dispatchEvent('pointerdown', {
      pointerId: 101,
      pointerType: 'touch',
      button: 0,
      buttons: 1,
      isPrimary: true,
    });

    let state = await readState(page);
    expect(state.joypad.buttons.left).toBe(true);

    await aButton.dispatchEvent('pointerdown', {
      pointerId: 102,
      pointerType: 'touch',
      button: 0,
      buttons: 1,
      isPrimary: false,
    });

    state = await readState(page);
    expect(state.joypad.buttons.left).toBe(true);
    expect(state.joypad.buttons.a).toBe(true);

    await leftButton.dispatchEvent('pointerup', {
      pointerId: 101,
      pointerType: 'touch',
      button: 0,
      buttons: 0,
      isPrimary: true,
    });

    state = await readState(page);
    expect(state.joypad.buttons.left).toBe(false);
    expect(state.joypad.buttons.a).toBe(true);

    await aButton.dispatchEvent('pointerup', {
      pointerId: 102,
      pointerType: 'touch',
      button: 0,
      buttons: 0,
      isPrimary: false,
    });

    state = await readState(page);
    expect(state.joypad.buttons.a).toBe(false);
  } finally {
    fixture.cleanup();
  }
});
