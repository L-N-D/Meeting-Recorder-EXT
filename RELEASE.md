# Release Notes - v1.0.0

## Version
* **Version:** 1.0.0
* **Release Date:** 2026-06-16

## Overview
Screen Recorder is a Google Chrome Extension designed for high-quality screen recording with flexible audio options. It is highly optimized for recording online meetings (such as Google Meet, Zoom, Teams), presentations, and tutorials. The extension supports capturing system/tab audio, local microphone input, and an optional camera preview overlay, packaged inside a modern Manifest V3 architecture.

## Available Features
* **Versatile Capture Sources:** Supports capturing browser tabs, specific application windows, or desktop screens.
  * **Single & Multiple Tabs:** Record a single tab or switch between different tabs on-the-fly using Chrome's native "Share this tab instead" toolbar helper.
  * **Application Windows:** Record a specific application window (e.g., a meeting window, presentation slides, code editor) to keep background activities private.
  * **Single & Multiple Displays:** Choose to record an entire screen. In a multi-monitor setup, you can select which display (Screen 1, Screen 2, etc.) to capture.
* **Smart Audio & Meeting Recording:**
  * Automatically records screen/system audio natively when no microphone is selected (perfect for capturing meeting participants' voices).
  * Automatically records microphone input natively if system audio is not present.
  * Dynamically mixes both system audio and microphone streams using the Web Audio API when both are active. This captures both your own voice and other meeting participants/system sounds, while still routing system audio to your local speakers so you can hear the meeting normally during recording.
* **Camera Overlay Preview:** A floating picture-in-picture webcam popup helper window when "Include Camera" is enabled.
* **Modern Controls UI:** Clean popup control panel featuring:
  * Toggles for Microphone and Camera inputs.
  * Real-time recording duration timer.
  * Clear visual error reporting.
* **Graceful Permissions Onboarding:** A dedicated helper tab (`permissions.html`) to guide users through granting microphone and webcam permissions when first requested.
* **Auto-saving Downloads:** Automatically formats and saves the recording as an `mp4` (or fallback `webm`) file to the browser's default download folder upon stopping.

## Current Limitations
* **OS-specific Audio Capture Limits (Linux vs. Windows/macOS):**
  * **Linux:** Due to Chromium platform constraints, recording system/application audio is **not supported** when capturing the **Entire Screen** or **Application Windows** (the browser's audio share option is disabled natively). System audio capture on Linux is only supported when recording a specific **Chrome Tab**.
  * **Windows & macOS:** Full support for capturing tab audio, and screen-wide/system audio when sharing the **Entire Screen** (Windows/macOS) or specific **Application Windows** (Windows).
* **Browser Compatibility:** Only compatible with Chrome/Chromium-based browsers supporting Manifest V3 `offscreen` API.
* **Webcam Overlay Placement:** The floating camera overlay opens as a static browser popup window (`top: 80`, `left: 80`) and must be moved or resized manually.
* **Memory Constraints:** Recorded segments (Chunks) are accumulated in memory, which may lead to performance degradation during extremely long recordings.

## Known Issues
* None

## Notes
* **Extension Permissions:** The extension requests `offscreen`, `desktopCapture`, `downloads`, and `activeTab` permissions.
* **Audio Permissions:** Tab audio sharing must be explicitly checked in Chrome's native capture dialog for system audio to be recorded.
