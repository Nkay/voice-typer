class MicrosoftError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "MicrosoftError";
    this.code = code;
  }
}

// Reduces whatever the user pasted from the Foundry portal to the resource root
// ("https://<resource>.services.ai.azure.com"). A missing scheme is tolerated,
// because the portal shows the bare host in some places, and so is the project
// path ("/api/projects/<name>"), because the portal's headline "project
// endpoint" includes it while the realtime API lives on the resource host. Any
// other path, a query or credentials are rejected: the realtime path is
// appended here and anything else would silently point at the wrong service.
// Returns "" when unusable.
function normalizeEndpoint(raw) {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (trimmed.length === 0) return "";
  let url;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return "";
  }
  if (url.protocol !== "https:" && url.protocol !== "wss:") return "";
  if (!url.hostname.includes(".")) return "";
  if (url.username || url.password || url.search || url.hash) return "";
  const isRoot = url.pathname === "/" || url.pathname === "";
  if (!isRoot && !/^\/api\/projects\/[^/]+\/?$/.test(url.pathname)) return "";
  return `https://${url.host}`;
}

function realtimeUrl(endpoint) {
  const root = normalizeEndpoint(endpoint);
  if (!root) throw new MicrosoftError("NO_ENDPOINT", "No Microsoft endpoint configured");
  return `wss://${new URL(root).host}/mai/v1/realtime?intent=transcription`;
}

// Handshake rejections. A 404 almost always means the endpoint is not a
// Foundry resource, so it gets its own code rather than a bare "HTTP 404".
function errorForStatus(status) {
  if (status === 401 || status === 403) return new MicrosoftError("UNAUTHORIZED", "Invalid Microsoft API key");
  if (status === 404) return new MicrosoftError("NOT_FOUND", "Microsoft endpoint not found");
  if (status === 429) return new MicrosoftError("RATE_LIMIT", "Rate limited");
  return new MicrosoftError("HTTP", `HTTP ${status}`);
}

// Errors reported inside the socket follow the OpenAI Realtime shape:
// {type: "error", error: {type, code, message}}.
function errorForEvent(event) {
  const error = (event && event.error) || {};
  const tag = `${error.code || ""} ${error.type || ""}`.toLowerCase();
  const message = typeof error.message === "string" && error.message ? error.message : "Transcription error";
  if (/auth|api[_-]?key|unauthori[sz]ed|forbidden/.test(tag)) {
    return new MicrosoftError("UNAUTHORIZED", "Invalid Microsoft API key");
  }
  if (/rate|quota/.test(tag)) return new MicrosoftError("RATE_LIMIT", "Rate limited");
  // An unknown deployment name is not reported as such: the service falls back
  // to a non-MAI model and then rejects the 16 kHz format, which only an MAI
  // transcription model accepts.
  if (/deployment|model_not_found|not_found/.test(tag) || /PCM input rate must be/i.test(message)) {
    return new MicrosoftError("NOT_FOUND", `Microsoft deployment not found: ${message}`);
  }
  return new MicrosoftError("SERVER", message);
}

module.exports = { MicrosoftError, normalizeEndpoint, realtimeUrl, errorForStatus, errorForEvent };
