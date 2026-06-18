#!/usr/bin/env bash
# Dzi Record — manual audio graph diagnostics during recording.
# Run while a recording session is active to compare pactl vs what Chrome should see.
set -euo pipefail

echo "=== pactl list short sources (dzi_*) ==="
pactl list short sources | grep -E 'dzi_|Name' || echo "(no dzi sources)"

echo ""
echo "=== pactl list short sinks (dzi_*) ==="
pactl list short sinks | grep dzi_ || echo "(no dzi sinks)"

echo ""
echo "=== pactl modules (null-sink + remap-source) ==="
pactl list short modules | grep -E 'null-sink|remap-source' | grep dzi || echo "(no dzi modules)"

echo ""
if command -v wpctl >/dev/null 2>&1; then
  echo "=== wpctl status (first 30 lines) ==="
  wpctl status | head -30
  echo ""
fi

if command -v pw-cli >/dev/null 2>&1; then
  echo "=== pw-cli Node (dzi_*) ==="
  pw-cli ls Node 2>/dev/null | grep -i dzi || echo "(no dzi nodes in pw-cli)"
  echo ""
fi

echo "=== Chrome visibility note ==="
echo "Sources ending in .monitor are NOT listed by Chrome enumerateDevices() on Linux."
echo "Look for dzi_*_mic (module-remap-source) — that is what Chrome should expose as audioinput."
