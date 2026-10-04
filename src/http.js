// In a Windows 10 console, clicking the window enters "select" mode and any
// console write then blocks the whole server until Esc is pressed. So per-search
// logging stays off in an interactive Windows console unless SCOWER_DEBUG is set;
// hosted deployments (no TTY) keep their logs.
const quietConsole = process.platform === 'win32' && process.stdout.isTTY && !process.env.SCOWER_DEBUG;

export function logWarning(...args) {
  if (!quietConsole) console.warn(...args);
}

/** An error whose message is safe to show to the shopper. */
export class UserError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export class SourceError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function combineSignals(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function errorMessageFrom(body, text) {
  if (!body) return text.slice(0, 200);
  if (typeof body.error === 'string') return body.error;
  if (body.error?.message) return body.error.message;
  if (Array.isArray(body.errors) && body.errors[0]) {
    return body.errors[0].longMessage || body.errors[0].message || JSON.stringify(body.errors[0]);
  }
  if (body.error_description) return body.error_description;
  return text.slice(0, 200);
}

export async function fetchJson(url, { signal, timeoutMs = 20_000, ...init } = {}) {
  const res = await fetch(url, { ...init, signal: combineSignals(signal, timeoutMs) });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    throw new SourceError(`HTTP ${res.status}: ${errorMessageFrom(body, text) || res.statusText}`, res.status);
  }
  if (body == null) throw new SourceError('Unexpected non-JSON response');
  return body;
}

const NETWORK_CODES = {
  ENOTFOUND: "can't find the server (check your internet connection)",
  EAI_AGAIN: "can't find the server (check your internet connection)",
  ECONNREFUSED: 'connection refused',
  ECONNRESET: 'connection dropped',
  ETIMEDOUT: 'connection timed out',
  UND_ERR_CONNECT_TIMEOUT: 'connection timed out',
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'secure connection blocked, often by antivirus or a proxy that scans HTTPS',
  SELF_SIGNED_CERT_IN_CHAIN: 'secure connection blocked, often by antivirus or a proxy that scans HTTPS',
  CERT_HAS_EXPIRED: 'secure connection failed (check your computer clock)',
};

export function describeError(err) {
  if (err?.name === 'TimeoutError') return 'Timed out';
  // Node's fetch hides the real reason in err.cause.
  const code = err?.cause?.code;
  if (err?.message === 'fetch failed' && code) return `Network error: ${NETWORK_CODES[code] || code}`;
  if (err?.name === 'AbortError') return 'Cancelled';
  if (err instanceof SourceError || err instanceof UserError) return err.message;
  if (err?.status) return `HTTP ${err.status}: ${err.message}`;
  return err?.message || 'Unknown error';
}
