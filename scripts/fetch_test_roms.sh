#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BLARGG_DIR="$ROOT_DIR/tests/roms/blargg"
MOONEYE_DIR="$ROOT_DIR/tests/roms/mooneye"
MAPPER_DIR="$ROOT_DIR/tests/roms/mapper"
mkdir -p "$BLARGG_DIR"
mkdir -p "$MOONEYE_DIR"
mkdir -p "$MAPPER_DIR"

BASE_URL="https://raw.githubusercontent.com/retrio/gb-test-roms/master"
MOONEYE_BASE_URL="https://gekkio.fi/files/mooneye-test-suite/mts-20240926-1737-443f6e1"
MOONEYE_ARCHIVE="mts-20240926-1737-443f6e1.tar.xz"
MBC3_TEST_URL="https://github.com/ZoomTen/mbc30test/releases/download/v1.1/MBC3_Test.gbc"
RTC3_TEST_URL="https://github.com/aaaaaa123456789/rtc3test/releases/download/v004/rtc3test.gb"
MBC3_OPTIONAL_TEST_URL="https://github.com/EricKirschenmann/MBC3-Tester-gb/releases/download/v1.0/mbctest.gb"

fetch() {
  local remote_path="$1"
  local local_name="$2"
  echo "Fetching $local_name"
  curl -fsSL "$BASE_URL/$remote_path" -o "$BLARGG_DIR/$local_name"
}

fetch "cpu_instrs/cpu_instrs.gb" "cpu_instrs.gb"
fetch "instr_timing/instr_timing.gb" "instr_timing.gb"
fetch "mem_timing/mem_timing.gb" "mem_timing.gb"
fetch "halt_bug.gb" "halt_bug.gb"

echo "Blargg subset downloaded to $BLARGG_DIR"

TMP_ARCHIVE="$(mktemp)"
trap 'rm -f "$TMP_ARCHIVE"' EXIT

echo "Fetching mooneye bundle $MOONEYE_ARCHIVE"
curl -fsSL "$MOONEYE_BASE_URL/$MOONEYE_ARCHIVE" -o "$TMP_ARCHIVE"
rm -rf "$MOONEYE_DIR"
mkdir -p "$MOONEYE_DIR"
tar -xJf "$TMP_ARCHIVE" --strip-components=1 -C "$MOONEYE_DIR"

echo "Mooneye bundle extracted to $MOONEYE_DIR"

echo "Fetching mapper compatibility ROMs (required)"
curl -fsSL "$MBC3_TEST_URL" -o "$MAPPER_DIR/MBC3_Test.gbc"
curl -fsSL "$RTC3_TEST_URL" -o "$MAPPER_DIR/rtc3test.gb"
echo "Fetched required mapper ROMs: MBC3_Test.gbc, rtc3test.gb"

echo "Fetching mapper compatibility ROMs (optional)"
if curl -fsSL "$MBC3_OPTIONAL_TEST_URL" -o "$MAPPER_DIR/mbctest.gb"; then
  echo "Fetched optional mapper ROM: mbctest.gb"
else
  echo "Warning: optional mapper ROM mbctest.gb could not be downloaded." >&2
  rm -f "$MAPPER_DIR/mbctest.gb"
fi

echo "Mapper ROMs downloaded to $MAPPER_DIR"
