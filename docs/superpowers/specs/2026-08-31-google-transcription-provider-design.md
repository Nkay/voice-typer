# Google Transcription Provider & Gemini Summary Support

**Date:** 2026-08-31
**Status:** Approved

## Goal

Add Google as an alternative transcription provider alongside Mistral, with the option to use both simultaneously for comparison. Additionally, allow Gemini models (e.g. `gemini-3.7-flash`) to be used for summaries instead of or alongside Mistral chat models.

## Configuration & Secrets

### New config fields

- `transcriptionProvider`: `"mistral"` | `"google"` | `"both"` (default: `"mistral"`)
- `summaryModel` now accepts prefixed IDs: `"mistral/mistral-small-latest"`, `"google/gemini-3.7-flash"`

### Secrets

- New encrypted file `google-key.enc` alongside existing `key.enc`
- `createSecrets` extended with `hasGoogleKey()`, `getGoogleKey()`, `setGoogleKey()`

### Validation

- `transcriptionProvider` validated against `["mistral", "google", "both"]`
- "google" or "both" provider requires a Google API key
- Summary model prefix determines API: `google/` prefix calls Gemini, everything else calls Mistral

## Google Modules

### `src/shared/google.js`

Base utilities mirroring `mistral.js`:

- `GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta"`
- `GoogleError` class with `code`/`message` pattern matching `MistralError`
- `errorForStatus()` for Google HTTP errors
- `fetchWithTimeout()` duplicated (same 6-line implementation as `mistral.js`) to keep modules independent

### `src/shared/google-transcriber.js`

Two-step transcription:

1. Upload WAV to Files API: `POST ${GEMINI_API_BASE}/files` with `x-goog-api-key` header
2. Transcribe via Interactions API: `POST ${GEMINI_API_BASE}/interactions` with model `gemini-3.5-transcribe`, referencing the uploaded file URI
3. Return `interaction.output_text`

Same function signature as Mistral: `transcribe(wavBytes, opts)` returning trimmed text. Same retry logic (2 attempts, 30s timeout).

### `src/shared/google-models.js`

- `GET ${GEMINI_API_BASE}/models?key=...`
- Filter for models supporting `generateContent`
- Return sorted list of model IDs

### `src/shared/google-summarizer.js`

- `POST ${GEMINI_API_BASE}/models/{model}:generateContent?key=...`
- Maps system/user messages to Gemini's `contents` + `systemInstruction` format
- Same signature: `summarize(transcript, opts)` returning trimmed text

## Controller & Boot Wiring

### Controller changes

- `_pump()` dispatches based on `cfg.transcriptionProvider`:
  - `"mistral"` — existing `this.transcribe()`
  - `"google"` — `this.googleTranscribe()`
  - `"both"` — both in parallel via `Promise.allSettled()`
- In "both" mode, results typed with `[Mistral]` / `[Google]` labels, joined by the configured separator
- One failure in "both" mode: type the successful result, notify about the failure
- Constructor takes `googleTranscribe` and `googleSummarize` as additional injected dependencies

### Summary dispatch

- `_typeResult()` reads `cfg.summaryModel` prefix:
  - `google/` prefix — strip prefix, call `this.googleSummarize()`
  - No prefix or `mistral/` prefix — call existing `this.summarize()`

### Boot wiring

- Import Google modules
- Create second secrets instance for `google-key.enc`
- Pass `googleTranscribe` and `googleSummarize` into Controller
- `refreshModels()` fetches from both APIs in parallel (if respective keys exist), merges with provider prefix
- `settings:get` returns `hasGoogleKey` alongside `hasKey`
- `settings:save` handles `googleApiKey` field

## Settings UI

### New fields

- **Google API key** — password input below the Mistral key input
- **Transcription provider** — select: Mistral, Google, Both

### Summary model dropdown

- Models have prefixed IDs: `mistral/model-name`, `google/model-name`
- Display labels show provider indicator: `mistral-small-latest (Mistral)`, `gemini-3.7-flash (Google)`
- Models from both providers sorted alphabetically
- Only models from providers with configured keys are shown

### Validation

- Selecting "Google" or "Both" without a Google key returns an error on save
- Selecting a `google/` summary model without a Google key returns an error
- Selecting a `mistral/` summary model without a Mistral key returns an error

## Error Handling

### Provider-specific errors

- `GoogleError` codes mirror `MistralError`: `NO_API_KEY`, `UNAUTHORIZED`, `RATE_LIMIT`, `NETWORK`, `BAD_RESPONSE`
- Controller `_errorMessage()` distinguishes provider in messages

### "Both" mode resilience

- `Promise.allSettled` — one failure does not block the other
- Both fail: show first meaningful error
- One succeeds: type it, notify about the failed provider
- Both succeed: type both with labels and separator

### Files API upload failure

- Upload failure throws `GoogleError("UPLOAD_FAILED", ...)`, treated as retryable

### Model list fetch

- Both fetches run in parallel
- Each can fail independently — partial results shown
- `modelsError` becomes provider-aware