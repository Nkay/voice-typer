# VoiceTyper

A small Windows tray app that turns speech into typed text. Hold down the record
key, speak, release it, and the transcript is typed into whatever field currently
has focus - no clicking required.

## How it works

1. Hold **Right Alt** (AltGr) to start recording.
2. Speak.
3. Release the key to stop recording. The audio is sent to the
   [Mistral Voxtral](https://mistral.ai/) transcription API.
4. The returned text is typed into the currently focused field via the keyboard
   (no mouse involved).

A tray icon shows the current state (idle, recording, processing, paused, or
error) and gives you a menu to pause/resume, open Settings, or quit.

## Requirements

- **Windows only.** VoiceTyper relies on Windows-specific APIs (global key
  listening, keyboard synthesis, DPAPI-backed secret storage, login items) and
  is not supported on other platforms.
- [Node.js](https://nodejs.org/) 24 or later.
- A microphone.
- A [Mistral API key](https://console.mistral.ai/) with access to the audio
  transcription endpoint.
- An internet connection - transcription is not local. Every recording is
  uploaded to Mistral's API for processing, and no audio is transcribed
  on-device.

## Install

```bash
npm install
```

## Run in development

```bash
npm start
```

This launches the Electron app. On first run, no Mistral API key is configured
yet, so you'll get a notification prompting you to set one - open the tray
icon's **Settings** menu item to add it.

## Configuring your API key

Right-click the tray icon and choose **Settings**. Paste your Mistral API key
into the "Mistral API key" field and click **Save**. The key is encrypted at
rest using Windows DPAPI (via Electron's `safeStorage`) and stored separately
from the rest of your configuration - it is never written in plain text to
disk.

## Settings

The same Settings window lets you configure:

- **Mistral API key** - leave the field blank to keep the currently saved key.
- **Language** - `auto` (auto-detect), `de` (German), or `en` (English).
- **Record key** - the key you hold to record. Defaults to **Right Alt
  (AltGr)**; can also be set to Left Alt, Right Ctrl, or Left Ctrl.
- **Microphone** - which input device to record from (defaults to the system
  default device).
- **Launch on login** - whether Windows should start VoiceTyper automatically
  when you log in. Off by default.

## Configuration file

Non-secret settings are stored as JSON at:

```
%APPDATA%/VoiceTyper/config.json
```

The Mistral API key is stored separately (encrypted) in the same directory and
is not part of this file.

## Building the installer

Run on Windows (electron-builder cannot cross-compile Windows targets from
other platforms):

```bash
npm run icons && npm run dist
```

This generates the tray/app icons and produces both an NSIS installer and a
portable executable under `dist/`.

## Running tests

```bash
npm test
```

The unit suite (Vitest) mocks all hardware and network dependencies - audio
capture, the global key listener, keyboard synthesis, the Mistral API, and
Windows secret storage - so it runs without any real devices or network
access.

## Notes on privacy and connectivity

Transcription requires an active internet connection. Recorded audio is sent
to Mistral's Voxtral API for processing; VoiceTyper does not transcribe audio
locally.
