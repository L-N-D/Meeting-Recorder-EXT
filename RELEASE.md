# Release Notes - v1.0.0

## Version
* **Version:** 1.0.0
* **Release Date:** 2026-06-16

## Overview
Screen Recorder is a Google Chrome Extension designed for high-quality screen recording with flexible audio options. It supports capturing system audio, microphone input, and an optional camera preview overlay, packaged inside a modern Manifest V3 architecture.

## Available Features
* **Screen & Tab Capture:** Streamlined recording using the browser's native `navigator.mediaDevices.getDisplayMedia`.
* **Smart Audio Recording:**
  * Automatically records screen/system audio natively when no microphone is selected.
  * Automatically records microphone input natively if system audio is not present.
  * Dynamically mixes both system audio and microphone streams using the Web Audio API when both are active, ensuring the user can still hear system audio through local speakers during recording.
* **Camera Overlay Preview:** A floating picture-in-picture webcam popup helper window when "Include Camera" is enabled.
* **Modern Controls UI:** Clean popup control panel featuring:
  * Toggles for Microphone and Camera inputs.
  * Real-time recording duration timer.
  * Clear visual error reporting.
* **Graceful Permissions Onboarding:** A dedicated helper tab (`permissions.html`) to guide users through granting microphone and webcam permissions when first requested.
* **Auto-saving Downloads:** Automatically formats and saves the recording as an `mp4` (or fallback `webm`) file to the browser's default download folder upon stopping.

## Current Limitations
* **Browser Compatibility:** Only compatible with Chrome/Chromium-based browsers supporting Manifest V3 `offscreen` API.
* **Webcam Overlay Placement:** The floating camera overlay opens as a static browser popup window (`top: 80`, `left: 80`) and must be moved or resized manually.
* **Memory Constraints:** Recorded segments (Chunks) are accumulated in memory, which may lead to performance degradation during extremely long recordings.

## Known Issues
* None

## Notes
* **Extension Permissions:** The extension requests `offscreen`, `desktopCapture`, `downloads`, and `activeTab` permissions.
* **Audio Permissions:** Tab audio sharing must be explicitly checked in Chrome's native capture dialog for system audio to be recorded.
