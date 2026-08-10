# VoiceTyper

A small Windows tray app that turns speech into typed text. Hold down the record
key, speak, release it, and the transcript is typed into whatever field currently
has focus — no clicking required.

## How it works

1. Hold **Right Alt** (AltGr) to start recording.
2. Speak.
3. Release the key to stop recording. The audio is sent to the
   [Mistral Voxtral](https://mistral.ai/) transcription API
   (`voxtral-mini-latest`).
4. The returned text is typed into the currently focused field via the keyboard
   (no mouse involved).

Also holding the **summary modifier** (Right Shift by default) at any point during
the hold upgrades that recording to transcript + summary: release the record key
and VoiceTyper sends the transcript to a Mistral chat model for a summary, then
types the transcript, a blank line, and the summary. The modifier is sticky for
the hold — press it any time before releasing the record key, or release it
early, and the upgrade still applies — but release it before the text types to
avoid upper-cased output. It does nothing by itself; the record key must be held
for anything to happen at all. If the summary call fails the transcript is still
typed and a notification says so — a failed summary never costs you your dictation.

A tray icon shows the current state (idle, recording, processing, paused, or
error) and gives you a menu to pause/resume, open Settings, or quit.

> **A note on typing speed.** Text is typed via synthesized keystrokes, one
> character at a time with a small delay between each (2 ms). A long dictation
> can occupy the keyboard for a few seconds, and the summary command roughly
> doubles the character count — transcript plus summary — so it takes about
> twice as long. Avoid typing yourself into the focused field until the tray
> icon leaves the "processing" state.

## Requirements

- **Windows only.** VoiceTyper relies on Windows-specific APIs (global key
  listening, keyboard synthesis, DPAPI-backed secret storage, login items) and
  is not supported on other platforms.
- [Node.js](https://nodejs.org/) 24 or later.
- A microphone.
- A [Mistral API key](https://console.mistral.ai/) with access to the audio
  transcription endpoint.
- An internet connection — transcription is not local. Every recording is
  uploaded to Mistral's API for processing, and no audio is transcribed
  on-device.

## Install

```bash
git clone https://github.com/Nkay/voice-typer.git
cd voice-typer
npm install
```

## Run in development

```bash
npm start
```

This launches the Electron app. On first run, no Mistral API key is configured
yet, so you'll get a notification prompting you to set one — open the tray
icon's **Settings** menu item to add it.

## Configuring your API key

Right-click the tray icon and choose **Settings**. Paste your Mistral API key
into the "Mistral API key" field and click **Save**. The key is encrypted at
rest using Windows DPAPI (via Electron's `safeStorage`) and stored separately
from the rest of your configuration — it is never written in plain text to
disk.

## Settings

The same Settings window lets you configure:

- **Mistral API key** — leave the field blank to keep the currently saved key.
- **Language** — `auto` (auto-detect), `de` (German), or `en` (English).
- **Record key** — the key you hold for a plain transcript. Defaults to **Right
  Alt (AltGr)**. Selectable keys are Left/Right Alt, Left/Right Ctrl,
  Left/Right Shift, F1–F24, and Space.
- **Summary modifier** — the key that, held along with the record key at any
  point during the hold, upgrades a recording to transcript + summary. Defaults
  to **Right Shift**. Must differ from the record key. Set to *— none —* to
  disable the summary command entirely.
- **Summary model** — which Mistral chat model writes the summary. The list is
  fetched from your account, so it reflects the models you actually have access
  to. Needs a saved API key.
- **Summary prompt** — the instructions sent to that model. Put style rules or
  worked examples here.
- **Separator** — what goes between the transcript and the summary: a blank line
  (typed as Shift+Enter twice, so it never submits a chat field), an em dash, or
  two spaces.
- **Microphone** — which input device to record from (defaults to the system
  default device).
- **Launch on login** — whether Windows should start VoiceTyper automatically
  when you log in. Off by default.

> **A note on Space and function keys.** VoiceTyper watches keys, it does not
> intercept them. Binding **Space** means holding it also types spaces into the
> focused field, and function keys may trigger whatever the focused app uses them
> for (F1 help, F5 refresh, F12 devtools). The modifier keys are the safe choice.

## Configuration file

Non-secret settings are stored as JSON at:

```
%APPDATA%\VoiceTyper\config.json
```

The Mistral API key is stored separately (encrypted, as `key.enc`) in the same
directory and is not part of this file.

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

The unit suite (Vitest) mocks all hardware and network dependencies — audio
capture, the global key listener, keyboard synthesis, the Mistral API, and
Windows secret storage — so it runs without any real devices or network
access.

## Notes on privacy and connectivity

Transcription requires an active internet connection. Recorded audio is sent
to Mistral's Voxtral API for processing; VoiceTyper does not transcribe audio
locally.

The summary command sends the transcript text to Mistral's chat-completions API
in a second request, so a summarised dictation reaches Mistral twice: once as
audio, once as text.

## License

[MIT](LICENSE)
