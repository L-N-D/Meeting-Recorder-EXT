#!/usr/bin/env bash
# Virtual-EXT Record — manual audio graph diagnostics during recording.
# Run while a recording session is active to compare pactl vs what Chrome should see.
set -euo pipefail

echo "=== pactl list short sources (Virtual-EXT_*) ==="
pactl list short sources | grep -E 'Virtual-EXT_|Name' || echo "(no virtual-ext sources)"

echo ""
echo "=== pactl list short sinks (Virtual-EXT_*) ==="
pactl list short sinks | grep Virtual-EXT_ || echo "(no virtual-ext sinks)"

echo ""
echo "=== pactl modules (null-sink + remap-source) ==="
pactl list short modules | grep -E 'null-sink|remap-source' | grep Virtual-EXT || echo "(no virtual-ext modules)"

echo ""
if command -v wpctl >/dev/null 2>&1; then
  echo "=== wpctl status (first 30 lines) ==="
  wpctl status | head -30
  echo ""
fi

if command -v pw-cli >/dev/null 2>&1; then
  echo "=== pw-cli Node (Virtual-EXT_*) ==="
  pw-cli ls Node 2>/dev/null | grep -i Virtual-EXT || echo "(no virtual-ext nodes in pw-cli)"
  echo ""
fi

echo "=== Chrome visibility note ==="
block="Sources ending in .monitor are NOT listed by Chrome enumerateDevices() on Linux."
echo "$block"
echo "Look for Virtual-EXT_*_mic (module-remap-source) — that is what Chrome should expose as audioinput."
