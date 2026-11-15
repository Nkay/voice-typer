// Sends a request whose answer streams in as server-sent events. deltaOf turns
// the data of one event into a piece of text ("" for none); onDelta gets each
// piece. Resolves with the response and the whole text. A response that is not
// ok comes back unread, for the caller's error handling.
//
// timeoutMs is the longest silence, before the answer and between two chunks:
// a stream can take longer than one request, but a stalled one must end.
//
// An error that onDelta throws stops the stream and comes out unchanged, with
// `fromCaller` set; every other error is one of the connection.
async function streamText(url, init, { fetchImpl = fetch, timeoutMs = 30000, deltaOf, onDelta }) {
  const controller = new AbortController();
  let timer;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), timeoutMs);
  };
  let text = "";
  let buffer = "";
  const lines = (final) => {
    const parts = buffer.split(/\r?\n/);
    buffer = final ? "" : parts.pop();
    for (const line of parts) {
      if (!line.startsWith("data:")) continue;
      const delta = deltaOf(line.slice(5).trim());
      if (!delta) continue;
      text += delta;
      try {
        onDelta(delta);
      } catch (err) {
        throw Object.assign(err, { fromCaller: true });
      }
    }
  };
  // False until the stream ended or an error response came back unread.
  let ended = false;
  arm();
  try {
    const res = await fetchImpl(url, { ...init, signal: controller.signal });
    if (!res.ok) {
      ended = true;
      return { res, text };
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      arm();
      buffer += decoder.decode(value, { stream: true });
      lines(false);
    }
    buffer += decoder.decode();
    lines(true);
    ended = true;
    return { res, text };
  } finally {
    clearTimeout(timer);
    // A stream that stopped early must not keep the connection, and the model
    // must not write on.
    if (!ended) controller.abort();
  }
}

module.exports = { streamText };
