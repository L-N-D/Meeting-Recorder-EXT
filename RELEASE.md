# Release Notes — v2.0.0

## Version
* **Version:** 2.0.0
* **Release Date:** 2026-06-17

## Overview
Screen Recorder is a Chrome (Manifest V3) extension for high-quality screen
recording with flexible audio and a Focus 1-1 mode that follows the tab you are
viewing. The background service worker owns all recording state; the popup is a
thin client that sends commands and renders broadcast state.

## Features
* **Screen & tab capture** using the native `getDisplayMedia` screen picker.
* **Focus 1-1 (single active source):** select a set of tabs and the recording
  automatically follows whichever selected tab is active, switching the source
  without stopping `MediaRecorder` (a hidden canvas keeps the output stable).
* **Smart audio:**
  * Records system audio alone, microphone alone, or mixes both via the Web
    Audio API with adjustable mic / system gains.
  * Optional monitoring of system audio through the local speakers while
    recording.
* **Camera overlay:** an optional extension-origin webcam preview window that
  reuses the extension's camera permission (reliable on any site).
* **Pause / resume** with an accurate, pause-aware duration timer.
* **Crash-resistant storage:** recording chunks stream to IndexedDB rather than
  accumulating in memory.
* **Reliable downloads:** the offscreen document is kept alive until the browser
  confirms the download has completed, preventing truncated files.

## Current Limitations
* Chromium-based browsers only (requires MV3 `offscreen` API).
* In Focus 1-1, switching tabs carries video across sources; per-tab audio is
  not re-mixed mid-recording.
* The camera preview is a separate floating window and is not composited into
  the recorded video.

## Notes
* **Permissions:** `offscreen`, `desktopCapture`, `tabCapture`, `tabs`,
  `downloads`, `activeTab`, `scripting`, `storage`, and `<all_urls>` host access.
* **System audio:** the "Share tab/system audio" checkbox must be ticked in
  Chrome's screen-picker dialog for system audio to be captured.

## Changes since v1.0.0
* Added Focus 1-1 tab-following recording and the audio mix panel.
* Added pause / resume and a live mic level meter.
* Switched the camera overlay to a reliable extension-origin window.
* Fixed a download race that could truncate large recordings.
* Removed dead code (unused in-page widget, permissions onboarding page, and
  unwired "add source" path) for a cleaner, easier-to-debug codebase.
