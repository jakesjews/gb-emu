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
npm run test:unit
npm run test:compat   # blargg subset, skips if ROMs are not present
npm run test:e2e
```

Fetch compatibility ROMs:

```bash
./scripts/fetch_test_roms.sh
```

The ROMs are downloaded to `tests/roms/blargg` and are gitignored.

## Notes

- This project does not distribute commercial ROMs.
- Bring your own legally obtained ROM files.
- Audio generation is intentionally stubbed in v1.
