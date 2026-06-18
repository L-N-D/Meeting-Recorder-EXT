#!/usr/bin/env bash
# Launcher Chrome invokes as the Native Messaging Host.
# Chrome talks to this process over stdin/stdout using the Native Messaging
# protocol, so this script must NOT print anything to stdout itself.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Resolve a node binary (Chrome's PATH is minimal; check common locations).
NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  for c in /usr/bin/node /usr/local/bin/node "$HOME/.nvm/versions/node"/*/bin/node \
           "$HOME/.volta/bin/node" /snap/bin/node; do
    if [ -x "$c" ]; then NODE_BIN="$c"; break; fi
  done
fi
if [ -z "$NODE_BIN" ]; then
  echo "dzi-record native host: node not found in PATH" >&2
  exit 1
fi

# Make sure the audio session env exists (Chrome usually passes it through).
RUN_UID="$(id -u)"
: "${XDG_RUNTIME_DIR:=/run/user/${RUN_UID}}"
export XDG_RUNTIME_DIR
# Without DBus, pactl may target a different PipeWire session than the desktop
# (sink created but invisible in Pavucontrol / wrong graph).
: "${DBUS_SESSION_BUS_ADDRESS:=unix:path=${XDG_RUNTIME_DIR}/bus}"
export DBUS_SESSION_BUS_ADDRESS

exec "$NODE_BIN" "$HERE/host.js"
