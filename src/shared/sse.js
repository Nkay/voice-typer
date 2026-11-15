// Sends a request whose answer is a stream of server-sent events and passes the
// data of each event to onData. Returns the response; a response that is not
// ok comes back unread, for the caller's error handling.
//
// timeoutMs is the longest silence, before the answer and between two chunks:
// a stream can take longer than one request, but a stalled one must end.
async function streamEvents(url, init, { fetchImpl = fetch, timeoutMs = 30000, onData }) {
  const controller = new AbortController();
  let timer;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), timeoutMs);
  };
  arm();
  try {
    const res = await fetchImpl(url, { ...init, signal: controller.signal });
    if (!res.ok) return res;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const lines = (final) => {
      const parts = buffer.split(/\r?\n/);
      buffer = final ? "" : parts.pop();
      for (const line of parts) {
        if (line.startsWith("data:")) onData(line.slice(5).trim());
      }
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      arm();
      buffer += decoder.decode(value, { stream: true });
      lines(false);
    }
    buffer += decoder.decode();
    lines(true);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { streamEvents };
