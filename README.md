# VoiceTyper

A small Windows tray app that turns speech into typed text. Hold down the record
key, speak, release it, and the transcript is typed into whatever field currently
has focus — no clicking required.

Transcription runs through your choice of provider: [Mistral
Voxtral](https://mistral.ai/), [Google Gemini](https://ai.google.dev/),
[Microsoft MAI-Transcribe-2-Streaming](https://learn.microsoft.com/azure/ai-services/speech-service/mai-transcribe-2-streaming)
(which types while you speak), or several at once, where the fastest answer
wins.

## How it works

1. Hold **Right Alt** (AltGr) to start recording.
2. Speak.
3. Release the key to stop recording. The audio is sent to each checked
   transcription model:
   - **Mistral** — the Voxtral transcription API (`voxtral-mini-transcribe-3`).
   - **Google** — the Gemini Interactions API (`gemini-3.5-transcribe`), with
     the audio sent inline in the request.
   - **Microsoft** — MAI-Transcribe-2-Streaming over the Foundry Realtime
     WebSocket. Unlike the others it does not wait for the release: the audio is
     streamed while you hold the key, and each piece of text the model confirms
     is typed straight away.
4. The returned text is typed into the currently focused field via the keyboard
   (no mouse involved).

### Live typing with Microsoft

With the **Microsoft** provider, VoiceTyper opens a realtime session when the
record key goes down, streams the microphone in 50 ms slices, and types every
*finalised* segment as soon as the model confirms it. The model's provisional
guesses are never typed, because typed text cannot be taken back. On release a
final commit flushes the last words, usually within a fraction of a second.

Typing never happens while **Shift, Ctrl, Alt, AltGr or Win** is physically
held (see below). With the default record key, Right Alt (AltGr), that means
the text waits during the hold and types the moment you release the key —
still faster than the other providers, because the transcript is already done.
For text that appears *while* you are still speaking, bind a non-modifier
record key such as **F13**–**F24**.

Text that arrives in the first second of a hold is held back, so a tap that is
too short to count still types nothing.

### Several models at once

With more than one model checked, VoiceTyper asks all of them at the same time
and types the first transcript that comes back; later answers are dropped. A
model that fails or hears nothing does not stop the others, so you never lose a
dictation to a single provider outage. Only when every model fails does a
notification name the first error.

Microsoft does not type live when other models are checked. It joins the race
twice: with the final transcript of the realtime session that ran during the
hold, and with the non-streaming `MAI-Transcribe-2` model, which receives the
recording after the release like the other providers. The non-streaming model
uses the same key and resource, through the resource's Speech host
(`<resource>.cognitiveservices.azure.com`).

### Copy every transcript

Double-press the record key (two short taps, the second within 0.4 s of the
first release) to put the transcripts of the last dictation on the clipboard.
With several models checked, this includes the answers that arrived after the
first one was typed, each under its model's label (`[Microsoft (live)]` for the
realtime session); a single transcript is copied without a label. Both taps are too short
to type anything. A longer second press records as usual, even right after a
tap.

Also holding the **summary modifier** (Right Shift by default) at any point during
the hold upgrades that recording to transcript + summary: release the record key
and VoiceTyper sends the transcript to your chosen summary model — a Mistral chat
model or a Gemini model — for a summary, then types the transcript, a blank line,
and the summary. The modifier is sticky for the hold — press it any time before
releasing the record key, or release it early, and the upgrade still applies;
typing waits until you let go of it. It does nothing
by itself; the record key must be held for anything to happen at all. If the
summary call fails the transcript is still typed and a notification says so — a
failed summary never costs you your dictation.

> With several models checked, the summary is made from the transcript that
> won. With **Microsoft** alone the summary is typed after the live transcript.

A tray icon shows the current state (idle, recording, processing, paused, or
error) and gives you a menu to pause/resume, open Settings, or quit.

> **A note on typing speed.** Text is typed via synthesized keystrokes, one
> character at a time with a small delay between each (2 ms). A long dictation
> can occupy the keyboard for a few seconds, and the summary command adds to
> the character count. Avoid typing yourself into the focused field until the
> tray icon leaves the "processing" state.

### Protection against stray shortcuts

Windows combines every synthesized character with the modifier keys that are
physically down at that moment. If AltGr is held while text types — for
example because you start the next dictation before the previous one has
finished typing — `e` becomes `€`, `q` becomes `@`, and Ctrl+Alt or Win
combinations open windows. VoiceTyper therefore checks **Shift, Ctrl, Alt/AltGr
and Win before every character** and pauses while any of them is down; typing
resumes exactly where it stopped once they are released.

Pausing is unlimited while a dictation hold is in progress. Otherwise, if a
modifier stays down for more than 10 seconds, VoiceTyper stops typing, puts the
untyped rest of the text on the clipboard, and tells you so in a notification.

Transcripts are also cleaned before they are typed: control characters (Tab,
Escape, Backspace and the like, which would act as keystrokes) are removed, Tab
becomes a space, and characters outside the Basic Multilingual Plane (emoji)
are dropped, because Windows does not reliably accept them as injected input.

## Requirements

- **Windows only.** VoiceTyper relies on Windows-specific APIs (global key
  listening, keyboard synthesis, DPAPI-backed secret storage, login items) and
  is not supported on other platforms.
- [Node.js](https://nodejs.org/) 24 or later.
- A microphone.
- An API key for at least one provider:
  - a [Mistral API key](https://console.mistral.ai/) with access to the audio
    transcription endpoint, and/or
  - a [Google Gemini API key](https://aistudio.google.com/apikey), and/or
  - a [Microsoft Foundry](https://ai.azure.com/) resource with a
    `MAI-Transcribe-2-Streaming` deployment, plus its API key and endpoint. The
    model is in public preview and is served from Sweden Central, Central US and
    South India.

  With several models checked, VoiceTyper needs the key of every checked model.
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

Saving is validated against what you selected: checking a model whose key
(or, for Microsoft, endpoint) is missing, or a `google/` summary model without
a Google key on file, is rejected with a message rather than silently failing at
record time.

## Settings

The same Settings window lets you configure:

- **Mistral API key** — leave the field blank to keep the currently saved key.
- **Google API key** — likewise; blank keeps the saved key.
- **Microsoft API key** — the key of your Foundry resource; blank keeps the
  saved key.
- **Microsoft endpoint** — the resource root, for example
  `https://my-resource.services.ai.azure.com`. A bare host name and the
  portal's project endpoint (`…/api/projects/<name>`) are accepted and reduced
  to the resource root; any other path or a query is rejected.
- **Microsoft deployment name** — the name you gave the deployment in Foundry.
  Defaults to `MAI-Transcribe-2-Streaming`.
- **Transcription models** — check one or more of `Mistral`, `Google` and
  `Microsoft` (see [Several models at once](#several-models-at-once)). At least
  one must be checked. Defaults to Mistral.
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
- **Separator** — what goes between the transcript and the summary: a blank
  line (typed as Shift+Enter twice, so it never submits a chat field), an em
  dash, or two spaces.
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

That includes `transcriptionModels` (a list of `"mistral"`, `"google"` and
`"microsoft"`; an older `transcriptionProvider` value is read once and
converted), `microsoftEndpoint`, `microsoftDeployment`, and the
provider-prefixed `summaryModel`. The API keys are stored separately
(encrypted, as `key.enc` for Mistral, `google-key.enc` for Google and
`microsoft-key.enc` for Microsoft) in the same directory and are not part of
this file.

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
capture, the global key listener, keyboard synthesis, the Mistral, Gemini and
Microsoft APIs, and Windows secret storage — so it runs without any real
devices or network access.

## Notes on privacy and connectivity

Transcription requires an active internet connection. Recorded audio is sent to
the provider you select — Mistral's Voxtral API, Google's Gemini API,
Microsoft's Foundry APIs, or, with several models checked, to each of them;
VoiceTyper does not transcribe audio locally. With Microsoft the audio leaves
your machine while you speak, not after you release the key.

The summary command sends the transcript text to the summary model's API in a
second request, so a summarised dictation reaches a provider twice: once as
audio, once as text. If you pick a Gemini summary model while transcribing with
Mistral (or the reverse), that second request goes to the other provider.

No provider receives the audio as a stored file: the recording travels inside
the request (or, for Microsoft, the WebSocket session) itself, rather than being
staged through Google's Files API first.

Because the Google path sends the audio inline, it inherits the API's
request-size limit — about seven minutes of speech at VoiceTyper's 16 kHz mono
capture. A longer recording is rejected before it leaves your machine, with a
notification saying so; the Mistral path has no such ceiling.

## License

[MIT](LICENSE)
