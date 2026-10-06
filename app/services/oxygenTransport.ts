import { SHOPIFY_PAYLOAD_LIMIT, type CloudPeriod, type CloudResource, type CloudResponse, type CloudTransport } from './shopifyBridge';

/** Same-origin requests carry the server's HttpOnly OAuth cookie, never browser-supplied identity. */
export class OxygenTransport implements CloudTransport {
  constructor(private requestFetch: typeof fetch = fetch, private timeoutMs = 15000) {}

  async request(method: 'GET' | 'POST', payload?: unknown, resource: CloudResource = 'player', period?: CloudPeriod): Promise<CloudResponse> {
    if (!['GET', 'POST'].includes(method) || !['player', 'leaderboard'].includes(resource)
      || resource === 'leaderboard' && (method !== 'GET' || !period || !['day', 'week', 'all'].includes(period))
      || resource === 'player' && period !== undefined || method === 'GET' && payload !== undefined)
      throw new Error('Ungültige Kontoanfrage.');
    const body = method === 'POST' ? JSON.stringify(payload) : undefined;
    if (method === 'POST' && (!body || new TextEncoder().encode(body).length > SHOPIFY_PAYLOAD_LIMIT))
      throw new Error('Der Spielstand ist ungültig oder zu groß.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const path = resource === 'leaderboard' ? `/api/leaderboard?period=${period}` : '/api/player';
      const response = await this.requestFetch(path, {
        method, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal,
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body } : {}),
      });
      if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Ungültige Kontoantwort.');
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Leere Kontoantwort.');
      let bytes = 0, text = '';
      const decoder = new TextDecoder('utf-8', { fatal: true });
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > SHOPIFY_PAYLOAD_LIMIT) {
            await reader.cancel();
            throw new Error('Die Kontoantwort ist zu groß.');
          }
          text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
      } finally { reader.releaseLock(); }
      return { status: response.status, data: JSON.parse(text) as unknown };
    } finally { clearTimeout(timeout); }
  }
}
