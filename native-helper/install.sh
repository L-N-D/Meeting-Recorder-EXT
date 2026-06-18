#!/usr/bin/env bash
# Register the Dzi Record native messaging host with every Chromium-based
# browser found on this machine. Re-run any time the absolute path changes.
set -euo pipefail

HOST_NAME="com.dzi.record_audio"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAUNCHER="$HERE/run-host.sh"

chmod +x "$LAUNCHER" "$HERE/host.js" 2>/dev/null || true

# Browsers' per-user NativeMessagingHosts directories (Linux).
TARGETS=(
  "$HOME/.config/google-chrome/NativeMessagingHosts"
  "$HOME/.config/google-chrome-beta/NativeMessagingHosts"
  "$HOME/.config/chromium/NativeMessagingHosts"
  "$HOME/.config/microsoft-edge/NativeMessagingHosts"
  "$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts"
)

MANIFEST_JSON="$(sed "s#__HOST_PATH__#${LAUNCHER}#g" "$HERE/${HOST_NAME}.json.template")"

installed=0
for dir in "${TARGETS[@]}"; do
  parent="$(dirname "$dir")"
  if [ -d "$parent" ]; then
    mkdir -p "$dir"
    printf '%s\n' "$MANIFEST_JSON" > "$dir/${HOST_NAME}.json"
    echo "installed -> $dir/${HOST_NAME}.json"
    installed=$((installed + 1))
  fi
done

if [ "$installed" -eq 0 ]; then
  echo "No Chromium-based browser config dir found. Creating one for google-chrome…"
  dir="$HOME/.config/google-chrome/NativeMessagingHosts"
  mkdir -p "$dir"
  printf '%s\n' "$MANIFEST_JSON" > "$dir/${HOST_NAME}.json"
  echo "installed -> $dir/${HOST_NAME}.json"
fi

echo
echo "Done. Native host: $LAUNCHER"
echo "Allowed extension id: plmehkdmfenfighdnboaknnolkpngdpb"
echo "If your extension id differs, update allowed_origins in the .json.template and re-run."
