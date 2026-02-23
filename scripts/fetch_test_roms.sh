#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/tests/roms/blargg"
mkdir -p "$OUT_DIR"

BASE_URL="https://raw.githubusercontent.com/retrio/gb-test-roms/master"

fetch() {
  local remote_path="$1"
  local local_name="$2"
  echo "Fetching $local_name"
  curl -fsSL "$BASE_URL/$remote_path" -o "$OUT_DIR/$local_name"
}

fetch "cpu_instrs/cpu_instrs.gb" "cpu_instrs.gb"
fetch "instr_timing/instr_timing.gb" "instr_timing.gb"
fetch "mem_timing/mem_timing.gb" "mem_timing.gb"
fetch "halt_bug.gb" "halt_bug.gb"

echo "Blargg subset downloaded to $OUT_DIR"
