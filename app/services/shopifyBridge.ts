export const SHOPIFY_PARENT_ORIGINS = new Set([
  'https://pfusch-clothing.ch',
  'https://www.pfusch-clothing.ch',
]);
export const SHOPIFY_STOREFRONT_ORIGIN = 'https://pfusch-clothing.ch';
export const SHOPIFY_OXYGEN_ORIGIN = 'https://game.pfusch-clothing.ch';
export const SHOPIFY_BRIDGE_VERSION = 1;
export const SHOPIFY_PAYLOAD_LIMIT = 131072;

export interface CloudResponse { status: number; data: unknown }
export type CloudResource = 'player' | 'leaderboard';
export type CloudPeriod = 'day' | 'week' | 'all';
export interface CloudTransport {
  request(method: 'GET' | 'POST', payload?: unknown, resource?: CloudResource, period?: CloudPeriod): Promise<CloudResponse>;
}

/** The browser-provided referrer selects the origin, never a URL parameter. */
export function shopifyParentOrigin(embedded: boolean, referrer: string): string | null {
  if (!embedded) return null;
  try {
    const origin = new URL(referrer).origin;
    return SHOPIFY_PARENT_ORIGINS.has(origin) ? origin : null;
  } catch { return null; }
}

const responseStatuses = new Set([200, 400, 401, 403, 409, 413, 422, 429, 500, 502, 503, 504]);

/** A bounded request/response bridge; Shopify cookies remain in the parent. */
export class ShopifyParentTransport implements CloudTransport {
  constructor(private host: Window, private parentOrigin: string, private timeoutMs = 15000) {
    if (!SHOPIFY_PARENT_ORIGINS.has(parentOrigin) || host.parent === host)
      throw new Error('Unbekannte Shopify-Einbettung');
  }

  request(method: 'GET' | 'POST', payload?: unknown, resource: CloudResource = 'player', period?: CloudPeriod): Promise<CloudResponse> {
    const requestId = this.host.crypto.randomUUID();
    return new Promise((resolve, reject) => {
      let finished = false;
      let retryTimer: number | undefined;
      const finish = (error: Error | null, response?: CloudResponse) => {
        if (finished) return;
        finished = true;
        this.host.clearTimeout(timer);
        if (retryTimer !== undefined) this.host.clearTimeout(retryTimer);
        this.host.removeEventListener('message', receive);
        if (error) reject(error);
        else resolve(response!);
      };
      const receive = (event: MessageEvent) => {
        if (event.origin !== this.parentOrigin || event.source !== this.host.parent) return;
        const data: unknown = event.data;
        if (!data || typeof data !== 'object') return;
        const message = data as Record<string, unknown>;
        if (message.type !== 'pfusch:cloud-response' || message.version !== SHOPIFY_BRIDGE_VERSION || message.requestId !== requestId) return;
        if (typeof message.status !== 'number' || !responseStatuses.has(message.status)) return;
        try {
          if (new TextEncoder().encode(JSON.stringify(message.data)).length > SHOPIFY_PAYLOAD_LIMIT)
            throw new Error('Die Kontoantwort ist zu groß.');
          finish(null, { status: message.status, data: message.data });
        } catch { finish(new Error('Ungültige Kontoantwort')); }
      };
      const timer = this.host.setTimeout(() => finish(new Error('Konto-Verbindung hat nicht geantwortet.')), this.timeoutMs);
      this.host.addEventListener('message', receive);
      const send = () => {
        if (finished) return;
        try {
          this.host.parent.postMessage({ type: 'pfusch:cloud-request', version: SHOPIFY_BRIDGE_VERSION, requestId, method, resource,
            ...(period === undefined ? {} : { period }), ...(payload === undefined ? {} : { payload }) }, this.parentOrigin);
          // The iframe may load before the theme asset. Repeat only reads with
          // the same ID; the parent ignores duplicates while one is active.
          if (method === 'GET' && !finished) retryTimer = this.host.setTimeout(send, 500);
        } catch (error) { finish(error instanceof Error ? error : new Error('Konto-Verbindung fehlgeschlagen')); }
      };
      try {
        if (payload !== undefined && new TextEncoder().encode(JSON.stringify(payload)).length > SHOPIFY_PAYLOAD_LIMIT)
          throw new Error('Der Spielstand ist zu groß.');
        send();
      } catch (error) { finish(error instanceof Error ? error : new Error('Konto-Verbindung fehlgeschlagen')); }
    });
  }
}
