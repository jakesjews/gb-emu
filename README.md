# GB Emulator (DMG v1)

From-scratch browser Game Boy emulator targeting original DMG behavior.

## Features

- DMG hardware target (no CGB features in v1)
- Cartridge support: ROM-only and MBC1
- Local ROM loading (`.gb`)
- Keyboard + gamepad input
- Auto SRAM persistence in `localStorage` keyed by ROM SHA-1
- Canvas renderer (160x144 internal resolution, pixel scaling)
- Basic debug pane (registers, flags, interrupt state, serial tail)
- Deterministic browser hooks:
  - `window.render_game_to_text()`
  - `window.advanceTime(ms)`

## Controls

- D-pad: Arrow keys
- A: `X`
- B: `Z`
- Start: `Enter`
- Select: `Shift`
- Fullscreen toggle: `F`

## Development

```bash
npm install
npm run dev
```

## Tests

```bash
npm run format:check
npm run test:unit
npm run test:compat:tier1
npm run test:compat:tier2
npm run test:compat   # tier1 + tier2 composite gate
npm run test:e2e
```

CI (GitHub Actions) runs:

- `./scripts/fetch_test_roms.sh` (pinned blargg/mooneye OSS assets)
- `npm run build`
- `npm run format:check`
- `npm run test` (unit + compat; includes tier1 + tier2 mooneye matrix)
- `npm run test:e2e` (deterministic smoke + optional local Tetris smoke that skips without `tests/roms/tetris.gb`)

Auto-format locally:

```bash
npm run format
```

Fetch compatibility ROMs:

```bash
./scripts/fetch_test_roms.sh
```

The ROMs are downloaded to `tests/roms/blargg` and `tests/roms/mooneye` and are gitignored.

## Notes

- This project does not distribute commercial ROMs.
- Bring your own legally obtained ROM files.
- Audio generation is intentionally stubbed in v1.
