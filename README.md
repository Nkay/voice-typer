# VoiceTyper

A small Windows tray app that turns speech into typed text. Hold down the record
key, speak, release it, and the transcript is typed into whatever field currently
has focus — no clicking required.

Transcription runs through your choice of provider: [Mistral
Voxtral](https://mistral.ai/), [Google Gemini](https://ai.google.dev/), or both
at once for side-by-side comparison.

## How it works

1. Hold **Right Alt** (AltGr) to start recording.
2. Speak.
3. Release the key to stop recording. The audio is sent to the configured
   transcription provider:
   - **Mistral** — the Voxtral transcription API (`voxtral-mini-latest`).
   - **Google** — the Gemini Interactions API (`gemini-3.5-transcribe`), with
     the audio sent inline in the request.
   - **Both** — both providers in parallel.
4. The returned text is typed into the currently focused field via the keyboard
   (no mouse involved).

In **Both** mode the two transcripts are typed one after the other, each under a
`[Mistral]` / `[Google]` label and joined by the configured separator. If only
one provider answers, its transcript is typed anyway and a notification names
the one that failed — you never lose a dictation to a single provider outage.

Also holding the **summary modifier** (Right Shift by default) at any point during
the hold upgrades that recording to transcript + summary: release the record key
and VoiceTyper sends the transcript to your chosen summary model — a Mistral chat
model or a Gemini model — for a summary, then types the transcript, a blank line,
and the summary. The modifier is sticky for the hold — press it any time before
releasing the record key, or release it early, and the upgrade still applies —
but release it before the text types to avoid upper-cased output. It does nothing
by itself; the record key must be held for anything to happen at all. If the
summary call fails the transcript is still typed and a notification says so — a
failed summary never costs you your dictation.

> **The summary gesture does nothing in Both mode.** Comparing two transcripts
> and summarising are separate jobs; with the provider set to **Both** the
> modifier is ignored and you get the two labelled transcripts only.

A tray icon shows the current state (idle, recording, processing, paused, or
error) and gives you a menu to pause/resume, open Settings, or quit.

> **A note on typing speed.** Text is typed via synthesized keystrokes, one
> character at a time with a small delay between each (2 ms). A long dictation
> can occupy the keyboard for a few seconds, and both the summary command and
> Both mode roughly double the character count, so they take about twice as
> long. Avoid typing yourself into the focused field until the tray icon leaves
> the "processing" state.

## Requirements

- **Windows only.** VoiceTyper relies on Windows-specific APIs (global key
  listening, keyboard synthesis, DPAPI-backed secret storage, login items) and
  is not supported on other platforms.
- [Node.js](https://nodejs.org/) 24 or later.
- A microphone.
- An API key for at least one provider:
  - a [Mistral API key](https://console.mistral.ai/) with access to the audio
    transcription endpoint, and/or
  - a [Google Gemini API key](https://aistudio.google.com/apikey).

  **Both** mode needs both keys.
- An internet connection — transcription is not local. Every recording is
  uploaded to the selected provider's API for processing, and no audio is
  transcribed on-device.

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

This launches the Electron app. On first run, no API key is configured yet, so
you'll get a notification prompting you to set one — open the tray icon's
**Settings** menu item to add it.

## Configuring your API keys

Right-click the tray icon and choose **Settings**. Paste your Mistral key into
the "Mistral API key" field, your Gemini key into the "Google API key" field —
whichever you plan to use — and click **Save**. Each key is encrypted at rest
using Windows DPAPI (via Electron's `safeStorage`) and stored separately from
the rest of your configuration; neither is ever written in plain text to disk.

Saving is validated against what you selected: choosing the **Google** or
**Both** provider, or a `google/` summary model, without a Google key on file
is rejected with a message rather than silently failing at record time.

## Settings

The same Settings window lets you configure:

- **Mistral API key** — leave the field blank to keep the currently saved key.
- **Google API key** — likewise; blank keeps the saved key.
- **Transcription provider** — `Mistral`, `Google`, or `Both`. Defaults to
  Mistral.
- **Language** — `auto` (auto-detect), `de` (German), or `en` (English). Applies
  to whichever provider is in use.
- **Record key** — the key you hold for a plain transcript. Defaults to **Right
  Alt (AltGr)**. Selectable keys are Left/Right Alt, Left/Right Ctrl,
  Left/Right Shift, F1–F24, and Space.
- **Summary modifier** — the key that, held along with the record key at any
  point during the hold, upgrades a recording to transcript + summary. Defaults
  to **Right Shift**. Must differ from the record key. Set to *— none —* to
  disable the summary command entirely.
- **Summary model** — which model writes the summary. The list is fetched from
  your accounts, so it reflects the models you actually have access to, and
  entries are prefixed by provider: `mistral-small-latest (Mistral)`,
  `gemini-3.7-flash (Google)`. Only providers with a saved key contribute
  models; if one provider's list fails to load the other is still shown, with a
  message naming what went wrong.
- **Summary prompt** — the instructions sent to that model. Put style rules or
  worked examples here.
- **Separator** — what goes between the transcript and the summary, and between
  the two transcripts in Both mode: a blank line (typed as Shift+Enter twice, so
  it never submits a chat field), an em dash, or two spaces.
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

That includes `transcriptionProvider` (`"mistral"`, `"google"`, or `"both"`) and
the provider-prefixed `summaryModel`. The API keys are stored separately
(encrypted, as `key.enc` for Mistral and `google-key.enc` for Google) in the
same directory and are not part of this file.

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
capture, the global key listener, keyboard synthesis, the Mistral and Gemini
APIs, and Windows secret storage — so it runs without any real devices or
network access.

## Notes on privacy and connectivity

Transcription requires an active internet connection. Recorded audio is sent to
the provider you select — Mistral's Voxtral API, Google's Gemini API, or, in
**Both** mode, to both of them; VoiceTyper does not transcribe audio locally.

The summary command sends the transcript text to the summary model's API in a
second request, so a summarised dictation reaches a provider twice: once as
audio, once as text. If you pick a Gemini summary model while transcribing with
Mistral (or the reverse), that second request goes to the other provider.

Neither provider retains the audio as a stored file: the recording travels
inside the request itself in both cases, rather than being staged through
Google's Files API first.

Because the Google path sends the audio inline, it inherits the API's
request-size limit — about seven minutes of speech at VoiceTyper's 16 kHz mono
capture. A longer recording is rejected before it leaves your machine, with a
notification saying so; the Mistral path has no such ceiling.

## License

[MIT](LICENSE)
