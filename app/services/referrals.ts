import type { StorageDriver } from './index';
import type { CloudTransport } from './shopifyBridge';

export interface InviteService {
  getInvite(): Promise<{ code: string; guardianBells?: number } | null>;
  capture(search: string): void;
  acceptPending(): Promise<void>;
}
const pendingKey = 'pfusch:invitation:v1';
const validCode = (code: unknown): code is string => typeof code === 'string' && code.length <= 512 && /^v1\.[\w-]{16}\.[\w-]+$/.test(code);
const record = (data: unknown): data is Record<string, unknown> => !!data && typeof data === 'object' && !Array.isArray(data);

/** Only opaque attribution is persisted. Sessions, CSRF and coin grants stay on the server. */
export class OxygenInvites implements InviteService {
  private pending = '';
  private accepting: Promise<void> | null = null;
  constructor(private storage: StorageDriver, private request: typeof fetch, private online = () => typeof navigator === 'undefined' || navigator.onLine !== false) {
    try { const stored = storage.getItem(pendingKey); if (validCode(stored)) this.pending = stored; } catch { /* Memory-only attribution still works until navigation. */ }
  }
  capture(search: string) {
    if (search.length > 2048 || this.pending) return;
    const params = new URLSearchParams(search), code = params.get('ref');
    if (params.get('share') !== 'invite' || params.getAll('ref').length !== 1 || !validCode(code)) return;
    this.pending = code;
    try { this.storage.setItem(pendingKey, code); } catch { /* Optional attribution must not block play. */ }
  }
  private async call(body?: { code: string; csrfToken: string }) {
    const response = await this.request('/api/referral', { method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
      signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Einladung ist vorübergehend nicht erreichbar.');
    const raw = await response.text();
    if (raw.length > 8192) throw new Error('Ungültige Einladung.');
    const data: unknown = JSON.parse(raw);
    if (!record(data)) throw new Error('Ungültige Einladung.');
    return { status: response.status, data };
  }
  async getInvite(): Promise<{ code: string; guardianBells?: number } | null> {
    if (!this.online()) return null;
    try { const result = await this.call(); return result.status === 200 && validCode(result.data.code)
      ? { code: result.data.code, ...(result.data.guardianBells === 1 ? { guardianBells: 1 } : {}) } : null; } catch { return null; }
  }
  acceptPending(): Promise<void> {
    if (!this.pending) return Promise.resolve();
    if (this.accepting) return this.accepting;
    this.accepting = this.accept().finally(() => { this.accepting = null; });
    return this.accepting;
  }
  private clearPending() {
    this.pending = '';
    try { this.storage.setItem(pendingKey, ''); } catch { /* Repeating the same claim on reopen is idempotent. */ }
  }
  private async accept() {
    if (!this.online()) throw new Error('Die Einladung wird zusammen mit deinem Spielstand synchronisiert.');
    const token = await this.call();
    if (token.status !== 200 || typeof token.data.csrfToken !== 'string') throw new Error('Die Einladung wartet auf die Kontoverbindung.');
    const result = await this.call({ code: this.pending, csrfToken: token.data.csrfToken });
    if (result.status === 200 && result.data.accepted === true) { this.clearPending(); return; }
    if ([400, 404, 409].includes(result.status) && ['invalid_invitation', 'self_invitation', 'existing_player', 'invitation_already_used', 'invitation_account_unavailable'].includes(String(result.data.error))) {
      this.clearPending(); return;
    }
    throw new Error('Die Einladung wartet auf die Kontoverbindung.');
  }
}

/** Attach before the first account save, including a restored offline outbox. */
export function withInvitations(transport: CloudTransport, invites: InviteService): CloudTransport {
  return { async request(method, payload, resource, period) {
    if (method === 'POST' && (!resource || resource === 'player')) await invites.acceptPending();
    return transport.request(method, payload, resource, period);
  } };
}
