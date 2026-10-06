import type { IncomingMessage } from 'node:http';
import { ApiError } from './auth.js';
import { MAX_BODY_BYTES } from './playerValidation.js';

export type NodeRequest = IncomingMessage & { body?: unknown };
/** One deadline shared by every request in a secondary operation, including
 * CAS retries. Real fetch cancellation is awaited before the function exits. */
export function withFetchDeadline(request: typeof fetch, milliseconds: number): typeof fetch {
  const deadline = AbortSignal.timeout(milliseconds);
  return (input, init) => request(input, { ...init,
    signal: init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline });
}
export async function readBoundedJson(request: NodeRequest): Promise<unknown> {
  const length = request.headers['content-length'];
  if (Array.isArray(length) || (length !== undefined && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)))
    throw new ApiError(413, 'body_too_large');
  let raw: string;
  if (request.body !== undefined) {
    try { raw = Buffer.isBuffer(request.body) ? request.body.toString('utf8')
      : typeof request.body === 'string' ? request.body : JSON.stringify(request.body); }
    catch { throw new ApiError(400, 'invalid_json'); }
  } else {
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const value of request) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) throw new ApiError(413, 'body_too_large');
      chunks.push(chunk);
    }
    raw = Buffer.concat(chunks).toString('utf8');
  }
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > MAX_BODY_BYTES) throw new ApiError(413, 'body_too_large');
  try { return JSON.parse(raw); } catch { throw new ApiError(400, 'invalid_json'); }
}
