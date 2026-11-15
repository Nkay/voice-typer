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
and types the first transcript that comes back (unless you set a
[primary model](#primary-model) or a [merge model](#merge-model)); later
answers are dropped. A
model that fails or hears nothing does not stop the others, so you never lose a
dictation to a single provider outage. Only when every model fails does a
notification name the first error.

### Primary model

The fastest model is not always the one whose transcript you want. With more
than one model checked, **Primary model** in Settings names the model you
prefer; the other checked models are its backup:

- If the primary answers first, its transcript is typed at once.
- If another model answers first, VoiceTyper waits for the primary until 1.5
  times the answer time of that model. An answer after 1.0 s gives the primary
  until 1.5 s. If the primary answers in that time, its transcript is typed;
  otherwise the other transcript is typed and the late answer is dropped.
- If the primary fails or hears nothing, the other transcript is typed without
  the wait. If every other model fails, VoiceTyper waits for the primary.

So a primary that is stuck costs you at most half of the backup's answer time.
With Microsoft as the primary, both its realtime transcript and its
non-streaming transcript count as the primary's answer. The timing history
marks the primary and shows the wait as its own step. With **none** selected,
the first transcript wins as before.

Microsoft does not type live when other models are checked. It joins the race
twice: with the final transcript of the realtime session that ran during the
hold, and with the non-streaming `MAI-Transcribe-2` model, which receives the
recording after the release like the other providers. The non-streaming model
uses the same key and resource, through the resource's Speech host
(`<resource>.cognitiveservices.azure.com`).

### Merge model

With two or more models checked, a fast chat model can write one text from
their transcripts. Select it as **Merge model** in Settings, for example a
Gemini Flash-Lite or a small Mistral model. The merge model:

- takes the words that make the most sense where the transcripts differ,
- removes fillers such as "um", "uh", "äh" and "ähm", and stutters,
- spells the terms of your [dictionary](#dictionary) as listed,
- keeps everything else as you said it.

VoiceTyper waits for the other models until 2 times the answer time of the
first one: an answer after 1.0 s gives the others until 2.0 s. The realtime
Microsoft transcript is ready at the release, so the clock starts with the
first other answer. Then VoiceTyper merges the transcripts that arrived. The
merge model gets at most 100 dictionary terms and 5 s to answer.

When only one transcript arrived, or when the merge fails, a transcript is
typed as without a merge model (the primary's, if it arrived). A merged text
that is much longer than every transcript counts as failed: the model then
answered the dictation instead of writing it down. The timing history shows the
wait and the merge as their own steps, and a double press copies the merged
text under `[Merged]`.

### Copy every transcript

Double-press the record key (two short taps, the second within 0.4 s of the
first release) to put the transcripts of the last dictation on the clipboard.
With several models checked, this includes the answers that arrived after the
first one was typed, each under its model's label (`[Microsoft (live)]` for the
realtime session); a single transcript is copied without a label. Both taps are too short
to type anything. A longer second press records as usual, even right after a
tap. The copy happens 0.4 s after the second tap, once it is clear that no
third tap follows.

### Record without holding the key

Tap the record key three times (three short taps, each within 0.4 s of the one
before) to start a recording that goes on after you let go. A notification
confirms it and the tray icon shows the recording state. Tap the record key
once more to stop; the recording is then transcribed and typed like any other
dictation. Hold the **summary modifier** during that last tap to get the
summary as well. With **Microsoft** alone the text is typed while you speak,
hands-free.

Pausing VoiceTyper from the tray menu also stops the recording, and its
transcript is typed. There is no time limit: the recording runs until you tap
the key. Remember
that Google rejects recordings of more than about seven minutes, and that with
Microsoft checked the audio is sent while the recording runs.

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
error) and gives you a menu to pause/resume, open Settings, open the timing
history, or quit.

> **A note on typing speed.** Text is typed via synthesized keystrokes, in
> blocks of 20 characters with a small pause between two blocks (2 ms). The
> pauses of a 500-character dictation add up to about 50 ms. Avoid typing
> yourself into the focused field until the tray icon leaves the "processing"
> state.

### Timing history

When a dictation feels slow, the tray menu's **Timing history…** shows where
the time went. The window lists the last 50 dictations, newest first, and for
each one how long every step took:

- **audio ready** — from the release of the key until the recording reached the
  app.
- **queue wait** — how long the dictation waited behind an earlier one that was
  still being transcribed or typed.
- **one row per model** — how long each checked model took to answer, counted
  from the moment the requests were sent. The row says which answer was typed,
  which arrived later, which heard nothing, and which failed (with the error
  code, for example `TIMEOUT`). A model that answers after the text is typed
  fills in its row when it does.
- **wait for primary** — how long a finished transcript of another model
  waited for the primary model (see [Primary model](#primary-model)).
- **wait for other models** — how long the first transcript waited for the
  other models before the merge (see [Merge model](#merge-model)).
- **merge** — the merge request; the note says "failed" when it failed.
- **summary** — the summary request, for a dictation with the summary command.
- **typing** — the synthesized keystrokes, with the number of characters. This
  includes any time typing waited for you to let go of a modifier key. With
  **Microsoft** alone the text is typed while you speak, so the row shows only
  the typing that was left after the final transcript arrived.

The heading of each dictation gives the length of the recording and the total
time from the release of the key until typing finished. The slowest step on the
way to the typed text is highlighted. The window updates while it is open, and
**Clear** empties the list.

### Dictionary

Names that the models do not know — your company, your projects, your
colleagues — often come out wrong. A dictionary file lists them. It is a plain
text file that you can put in your OneDrive folder, so every PC that selects the
same file uses the same list:

```text
# Lines that start with # are comments.
VoiceTyper
WebStorm
Voice Typer, Voicetyper => VoiceTyper
```

- A line with a term gives the term to the models as a hint and corrects its
  case in the transcript (`webstorm` becomes `WebStorm`).
- A line `wrong => right` also replaces each wrong form. Separate several wrong
  forms with commas.
- Corrections apply to whole words and phrases only, without regard to case:
  `VoiceTypers` stays as it is.

The hints go to Mistral as `context_bias`, to Google as `custom_vocabulary` and
to the non-streaming Microsoft model as a phrase list, at most 100 terms. The
Microsoft live session gets no hints, because its API documents no such
setting; the corrections apply to its text all the same. When a provider
rejects the hints, VoiceTyper asks it again without them. With live typing, the
last word (or, for a correction of several words, the last few words) is typed
when the next words arrive, so that a correction can still apply.

VoiceTyper reads the file again at each dictation when it changed, so an edit
applies at the next dictation without a restart. When the file cannot be read
(for example, OneDrive is offline and the file is not on this PC), VoiceTyper
uses the last copy it read and shows a notification.

### Protection against stray shortcuts

Windows combines every synthesized character with the modifier keys that are
physically down at that moment. If AltGr is held while text types — for
example because you start the next dictation before the previous one has
finished typing — `e` becomes `€`, `q` becomes `@`, and Ctrl+Alt or Win
combinations open windows. VoiceTyper therefore checks **Shift, Ctrl, Alt/AltGr
and Win before every block of characters** and pauses while any of them is
down; typing resumes exactly where it stopped once they are released. A block
is sent in one call without a pause, so there is almost no time for a key to
go down in the middle of one.

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
- **Primary model** — one of the checked models, or none. The transcript of the
  primary is preferred to a faster transcript of another model, within a time
  limit (see [Primary model](#primary-model)). Defaults to none.
- **Merge model** — a chat model that writes one text from the transcripts of
  the checked models, or none (see [Merge model](#merge-model)). The list is
  the same as for the summary model. Defaults to none.
- **Language** — `auto` (auto-detect), `de` (German), or `en` (English). Applies
  to whichever provider is in use.
- **Dictionary file** — the [dictionary](#dictionary). **Choose…** selects an
  existing file, **New…** creates one from a template (in your OneDrive folder
  by default) and opens it, **Edit** opens the file in your text editor, and
  **Remove** stops the use of a dictionary. The line under the buttons shows
  the number of terms and corrections. Click **Save** to use a new selection.
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
converted), `primaryModel` (one of the checked models, or `""` for none),
`mergeModel` (a provider-prefixed chat model, or `""` for none),
`microsoftEndpoint`, `microsoftDeployment`, `dictionaryPath`, and the
provider-prefixed `summaryModel`. The API keys are stored separately
(encrypted, as `key.enc` for Mistral, `google-key.enc` for Google and
`microsoft-key.enc` for Microsoft) in the same directory and are not part of
this file.

The timing history is stored next to it as `timings.json`. It holds durations,
model names and character counts only — never the dictated text.

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
