import { ApiError } from './auth.js';
import { MAX_BODY_BYTES } from './playerValidation.js';
import { byteLength, utf8 } from './crypto.js';

/** Structural legacy adapter type; importing this module never requires Node. */
export interface NodeRequest extends AsyncIterable<Uint8Array | string> {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined> & { 'content-type'?: string };
  body?: unknown;
}
/** Older worker runtimes expose timeout() before they expose any(). Keep the
 * fallback listeners until cancellation so response bodies are covered too.
 * The shared deadline always fires and releases the remaining listeners. */
function combineSignals(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(signals);
  const controller = new AbortController();
  const listeners: Array<[AbortSignal, () => void]> = [];
  const abort = (signal: AbortSignal) => {
    for (const [source, listener] of listeners) source.removeEventListener('abort', listener);
    listeners.length = 0;
    controller.abort(signal.reason);
  };
  for (const signal of signals) {
    if (signal.aborted) { abort(signal); break; }
    const listener = () => abort(signal);
    listeners.push([signal, listener]);
    signal.addEventListener('abort', listener, { once: true });
  }
  return controller.signal;
}
/** One deadline shared by every request in a secondary operation, including
 * CAS retries. Real fetch cancellation is awaited before the function exits. */
export function withFetchDeadline(request: typeof fetch, milliseconds: number): typeof fetch {
  const deadline = AbortSignal.timeout(milliseconds);
  return (input, init) => request(input, { ...init,
    signal: init?.signal ? combineSignals([init.signal, deadline]) : deadline });
}
function checkLength(length: string | string[] | undefined | null, maxBytes: number) {
  if (length === null) return;
  if (Array.isArray(length) || (length !== undefined && (!/^\d+$/.test(length) || Number(length) > maxBytes)))
    throw new ApiError(413, 'body_too_large');
}
function parseJson(raw: string, maxBytes: number) {
  if (byteLength(raw) > maxBytes) throw new ApiError(413, 'body_too_large');
  try { return JSON.parse(raw); } catch { throw new ApiError(400, 'invalid_json'); }
}
async function readChunks(chunks: AsyncIterable<Uint8Array | string>, maxBytes: number) {
  const decoder = new TextDecoder();
  let bytes = 0, text = '';
  for await (const value of chunks) {
    const chunk = typeof value === 'string' ? utf8(value) : value;
    bytes += chunk.byteLength;
    if (bytes > maxBytes) throw new ApiError(413, 'body_too_large');
    text += decoder.decode(chunk, { stream: true });
  }
  return parseJson(text + decoder.decode(), maxBytes);
}
export async function readBoundedJson(request: NodeRequest, maxBytes = MAX_BODY_BYTES): Promise<unknown> {
  checkLength(request.headers['content-length'], maxBytes);
  let raw: string;
  if (request.body !== undefined) {
    try { raw = request.body instanceof Uint8Array ? new TextDecoder().decode(request.body)
      : typeof request.body === 'string' ? request.body : JSON.stringify(request.body); }
    catch { throw new ApiError(400, 'invalid_json'); }
  } else {
    return readChunks(request, maxBytes);
  }
  if (typeof raw !== 'string') throw new ApiError(400, 'invalid_json');
  return parseJson(raw, maxBytes);
}

/** Worker fetch Request adapter with the same streamed byte cap as the legacy API. */
export async function readBoundedWebJson(request: Request, maxBytes = MAX_BODY_BYTES): Promise<unknown> {
  checkLength(request.headers.get('content-length'), maxBytes);
  if (!request.body) throw new ApiError(400, 'invalid_json');
  const reader = request.body.getReader();
  async function* chunks() {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      try { await reader.cancel(); } catch { /* Preserve the original validation error. */ }
      reader.releaseLock();
    }
  }
  return readChunks(chunks(), maxBytes);
}
