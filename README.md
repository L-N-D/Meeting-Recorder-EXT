# Screen Recorder

A Chrome (Manifest V3) extension for high-quality screen recording with flexible
audio and a **Focus 1-1** mode that follows the tab you are viewing.

Built with [WXT](https://wxt.dev/) + React + TypeScript.

## Features

- **Screen / tab capture** via the native screen picker (`getDisplayMedia`).
- **Focus 1-1** — pick a set of tabs; the recording automatically follows
  whichever selected tab you switch to, producing a single continuous file.
- **Audio mixing** — record system audio, microphone, or both. When both are
  present they are mixed with adjustable gains using the Web Audio API.
- **Camera overlay** — an optional floating webcam preview window.
- **Pause / resume** and a live duration timer.
- **Crash-resistant storage** — chunks are streamed to IndexedDB instead of RAM,
  so long recordings don't exhaust memory.
- **Auto-save** — the finished recording is downloaded as `.mp4` (or `.webm`
  fallback) once the download completes.

## Architecture

| Part | File(s) | Responsibility |
| --- | --- | --- |
| Popup UI | `entrypoints/popup/`, `components/` | Thin client: send commands, render state |
| Background SW | `entrypoints/background.ts` | State machine, offscreen handshake, Focus 1-1, downloads |
| Offscreen doc | `entrypoints/offscreen/` | Actual capture, audio mixing, `MediaRecorder` |
| Camera window | `entrypoints/camera/` | Extension-origin webcam preview |
| Capture utils | `utils/` | Recorder, canvas router, audio mixer, chunk storage |

The popup never holds recording state of its own — the **background service
worker is the single source of truth** and broadcasts `STATE_CHANGED` updates.

## Development

```bash
npm install
npm run dev       # launch with HMR (Chrome)
npm run compile   # type-check only (tsc --noEmit)
npm run build     # production build into dist/chrome-mv3
npm run zip       # build + package a zip for the Web Store
```

Load the unpacked extension from `dist/chrome-mv3` (or the dev build) via
`chrome://extensions` → **Load unpacked**.

## Requirements

- Chromium-based browser with MV3 `offscreen` API support.
- For system audio, the "Share tab audio / system audio" checkbox must be ticked
  in Chrome's screen-picker dialog.
