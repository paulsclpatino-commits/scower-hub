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

export function describeError(err) {
  if (err?.name === 'TimeoutError') return 'Timed out';
  if (err?.name === 'AbortError') return 'Cancelled';
  if (err instanceof SourceError || err instanceof UserError) return err.message;
  if (err?.status) return `HTTP ${err.status}: ${err.message}`;
  return err?.message || 'Unknown error';
}
