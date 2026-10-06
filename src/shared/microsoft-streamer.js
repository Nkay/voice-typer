const { MicrosoftError, realtimeUrl, errorForStatus, errorForEvent } = require("./microsoft.js");

const DEFAULT_DEPLOYMENT = "MAI-Transcribe-2-Streaming";
const TRANSCRIPTION_EVENT = "conversation.item.input_audio_transcription.";

// Lazy require: tests inject a fake socket and never load ws.
function defaultWebSocket() {
  return require("ws");
}

// One push-to-talk hold is one realtime session: audio is appended while the key
// is down, a single commit at release asks for the final transcript, and the
// socket is closed as soon as it arrives. Finalised text is handed to onDelta
// as it is confirmed; the provisional "intermediate" hypotheses are ignored,
// because typed text cannot be taken back.
//
// Returns { append(pcm16Bytes), finish() → Promise<transcript>, cancel() }.
// Every failure surfaces as a rejection of finish(); nothing throws later.
function openStream(opts = {}) {
  const {
    apiKey,
    endpoint,
    deployment = DEFAULT_DEPLOYMENT,
    language = "auto",
    sampleRate = 16000,
    onDelta = () => {},
    WebSocketImpl = defaultWebSocket(),
    connectTimeoutMs = 10000,
    finishTimeoutMs = 10000,
    timers = { setTimeout, clearTimeout },
  } = opts;

  if (!apiKey) throw new MicrosoftError("NO_API_KEY", "No Microsoft API key configured");
  const url = realtimeUrl(endpoint);

  let settled = false;
  let ready = false;
  let finishing = false;
  let committed = false;
  let sentAudio = false;
  let transcript = "";
  const backlog = [];
  let finishTimer = null;

  let resolveDone;
  let rejectDone;
  const done = new Promise((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  // A failure during the hold is reported by finish(); until then it must not
  // count as an unhandled rejection.
  done.catch(() => {});

  const ws = new WebSocketImpl(url, {
    headers: { "api-key": apiKey },
    handshakeTimeout: connectTimeoutMs,
  });

  const connectTimer = timers.setTimeout(
    () => fail(new MicrosoftError("TIMEOUT", "Microsoft transcription session did not start")),
    connectTimeoutMs
  );

  function clearTimers() {
    timers.clearTimeout(connectTimer);
    if (finishTimer) timers.clearTimeout(finishTimer);
  }

  function shutdown() {
    clearTimers();
    try {
      ws.close();
    } catch {
      // Closing a socket that is still connecting throws in some
      // implementations; the session is over either way.
    }
  }

  function succeed(text) {
    if (settled) return;
    settled = true;
    resolveDone(text);
    shutdown();
  }

  function fail(err) {
    if (settled) return;
    settled = true;
    rejectDone(err);
    shutdown();
  }

  function send(event) {
    try {
      ws.send(JSON.stringify(event));
      return true;
    } catch (err) {
      fail(new MicrosoftError("NETWORK", `Network error: ${err.message}`));
      return false;
    }
  }

  function sendAudio(bytes) {
    if (!bytes || bytes.length === 0) return;
    if (send({ type: "input_audio_buffer.append", audio: Buffer.from(bytes).toString("base64") })) {
      sentAudio = true;
    }
  }

  function commit() {
    if (!sentAudio) {
      succeed("");
      return;
    }
    if (send({ type: "input_audio_buffer.commit" })) committed = true;
  }

  function configure() {
    // Auto-detection means leaving the language out. The docs show
    // `language: null`, but the service rejects null with "expected one of …".
    const transcription = { model: deployment };
    if (language && language !== "auto") transcription.language = language;
    send({
      type: "session.update",
      session: {
        type: "transcription",
        audio: {
          input: {
            format: { type: "audio/pcm", rate: sampleRate },
            transcription,
            turn_detection: null,
            noise_reduction: null,
          },
        },
      },
    });
  }

  function handle(event) {
    switch (event && event.type) {
      case "session.created":
        configure();
        break;
      case "session.updated":
        if (ready) break;
        ready = true;
        timers.clearTimeout(connectTimer);
        while (backlog.length > 0 && !settled) sendAudio(backlog.shift());
        if (finishing && !settled) commit();
        break;
      case TRANSCRIPTION_EVENT + "delta":
        if (typeof event.delta === "string" && event.delta.length > 0) {
          transcript += event.delta;
          try {
            onDelta(event.delta);
          } catch (err) {
            console.error("VoiceTyper: onDelta failed", err);
          }
        }
        break;
      case TRANSCRIPTION_EVENT + "completed":
        if (committed) succeed(typeof event.transcript === "string" ? event.transcript : transcript);
        break;
      case "error":
      case TRANSCRIPTION_EVENT + "failed":
        fail(errorForEvent(event));
        break;
      default:
        break;
    }
  }

  ws.on("unexpected-response", (req, res) => {
    fail(errorForStatus(res && res.statusCode));
    if (req && typeof req.destroy === "function") req.destroy();
  });
  ws.on("error", (err) => fail(new MicrosoftError("NETWORK", `Network error: ${err && err.message}`)));
  ws.on("close", (code) => fail(new MicrosoftError("NETWORK", `Connection closed (${code})`)));
  ws.on("message", (data) => {
    // ws hands over each message whole, so a multi-byte character is never
    // split across two parses.
    let event;
    try {
      event = JSON.parse(Buffer.isBuffer(data) ? data.toString("utf8") : String(data));
    } catch {
      fail(new MicrosoftError("BAD_RESPONSE", "Malformed message from transcription API"));
      return;
    }
    handle(event);
  });

  return {
    append(bytes) {
      if (settled || committed) return;
      if (ready) sendAudio(bytes);
      else backlog.push(bytes);
    },
    finish() {
      if (!finishing && !settled) {
        finishing = true;
        finishTimer = timers.setTimeout(
          () => fail(new MicrosoftError("TIMEOUT", "Microsoft transcription timed out")),
          finishTimeoutMs
        );
        if (ready) commit();
      }
      return done;
    },
    cancel() {
      succeed("");
    },
  };
}

module.exports = { openStream, DEFAULT_DEPLOYMENT };
