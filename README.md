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
npm run test:compat:tier3a
npm run test:compat:tier3b
npm run test:compat        # strict gate (tier1 + tier2 + tier3a)
npm run test:compat:soft   # local convenience mode (allows missing ROM assets)
npm run test:compat:extended # strict required set + shadow tier3b
npm run test:compat:report # writes test-results/compat/summary.md
npm run test:e2e
```

CI (GitHub Actions) runs:

- `./scripts/fetch_test_roms.sh` (pinned blargg/mooneye OSS assets)
- `npm run build`
- `npm run format:check`
- `npm run test:unit`
- `npm run test:compat` (strict tier1 + tier2 + tier3a gate with zero allowed skips)
- `GB_COMPAT_STRICT=0 npm run test:compat:tier3b` (informational shadow coverage)
- `npm run test:compat:report` (generates CI-friendly summary)
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
Compatibility artifacts are emitted to `test-results/compat/`:

- `blargg.json`
- `mooneye-tier1.json`
- `mooneye-tier2.json`
- `mooneye-tier3a.json`
- `mooneye-tier3b.json` (when shadow tier is run)
- `summary.md`

Tier-3B shadow currently covers 11 DMG-in-scope ROMs.
`acceptance/oam_dma/sources-GS.gb` is intentionally excluded because it requires MBC5 (`0x1B`), which is out of current cartridge scope.
Promotion policy: Tier-3B moves into strict required gating after 3 consecutive green shadow runs on `main`.

## Notes

- This project does not distribute commercial ROMs.
- Bring your own legally obtained ROM files.
- Audio generation is intentionally stubbed in v1.
