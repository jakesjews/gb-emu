# GB Emulator (DMG v1)

From-scratch browser Game Boy emulator targeting original DMG behavior.

## Features

- DMG hardware target (no CGB features in v1)
- Cartridge support: ROM-only, MBC1, MBC3 (basic RTC v1), and MBC5
- Local ROM loading (`.gb`)
- Keyboard + gamepad input
- Auto save persistence in `localStorage` keyed by ROM SHA-1 (SRAM + mapper metadata)
- Canvas renderer (160x144 internal resolution, pixel scaling)
- DMG APU v1 audio (CH1/CH2/CH3/CH4, stereo routing via NR50/NR51/NR52)
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
- Audio mute toggle: UI button
- Audio volume: UI slider (0..1)

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
npm run test:compat:mapper:strict
npm run test:compat:mapper:shadow
npm run test:compat        # strict gate (blargg + tier1 + tier2 + tier3a + tier3b + mapper-required)
npm run test:compat:soft   # local convenience mode (allows missing ROM assets)
npm run test:compat:extended # strict required set + optional mapper RTC diagnostics
npm run test:compat:report # writes test-results/compat/summary.md
npm run test:audio:smoke   # deterministic APU/pipeline unit smoke
npm run test:e2e
```

CI (GitHub Actions) runs:

- `./scripts/fetch_test_roms.sh` (pinned blargg/mooneye OSS assets)
- `npm run build`
- `npm run format:check`
- `npm run test:unit`
- `npm run test:compat` (strict required gate: blargg + mooneye tier1/tier2/tier3a/tier3b + mapper required suites)
- `npm run test:compat:mapper:shadow` (optional informational RTC diagnostics, non-blocking)
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

The ROMs are downloaded to `tests/roms/blargg`, `tests/roms/mooneye`, and `tests/roms/mapper` and are gitignored.
Compatibility artifacts are emitted to `test-results/compat/`:

- `blargg.json`
- `mooneye-tier1.json`
- `mooneye-tier2.json`
- `mooneye-tier3a.json`
- `mooneye-tier3b.json`
- `mapper-mbc5.json`
- `mapper-mbc3.json`
- `mapper-mbc3-rtc-shadow.json` (optional informational diagnostics)
- `summary.md`

Tier-3B and mapper-required suites are promoted into strict gating (experimental policy, promoted on green).
`mapper-mbc3-rtc-shadow` remains informational and non-blocking.

## Notes

- This project does not distribute commercial ROMs.
- Bring your own legally obtained ROM files.
- Audio is gameplay-accurate DMG v1 (not cycle-perfect for every hardware edge quirk).
