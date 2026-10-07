import { SHOPIFY_BRIDGE_VERSION, SHOPIFY_PARENT_ORIGINS } from './shopifyBridge';

export interface OxygenRuntimeConfig { version: 1; mode: 'oxygen' }

/** Only the server's inert JSON script selects Oxygen. URLs and customer IDs are never configuration. */
export function readOxygenRuntime(document: Pick<Document, 'getElementById'>): OxygenRuntimeConfig | null {
  const element = document.getElementById('pfusch-runtime-config');
  if (!element) return null;
  const raw = element.textContent ?? '';
  if (element.tagName !== 'SCRIPT' || element.getAttribute('type') !== 'application/json' || raw.length > 1024)
    throw new Error('Ungültige Spielserver-Konfiguration.');
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('Ungültige Spielserver-Konfiguration.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Ungültige Spielserver-Konfiguration.');
  const config = value as Record<string, unknown>;
  if (config.version !== 1 || config.mode !== 'oxygen' || Object.keys(config).some((key) => !['version', 'mode'].includes(key)))
    throw new Error('Ungültige Spielserver-Konfiguration.');
  return { version: 1, mode: 'oxygen' };
}

/** The parent supplies only its return route; identity is established by OAuth on the game server. */
export function startOxygenLogin(host: Window, parentOrigin: string | null, parentReturnTo?: string): void {
  if (host.parent !== host && parentOrigin && SHOPIFY_PARENT_ORIGINS.has(parentOrigin)) {
    // If the frame itself is not an Oxygen origin, let the trusted storefront
    // bridge route the click to the configured Oxygen origin.
    if (!host.location?.hostname?.endsWith('.myshopify.dev')) {
      host.parent.postMessage({ type: 'pfusch:open-login', version: SHOPIFY_BRIDGE_VERSION }, parentOrigin);
      return;
    }
    // Navigate immediately from the user gesture. The parent bridge is a
    // useful fallback for older shop themes, but waiting for it makes a
    // missing or stale theme asset look like an inert login button.
    const fallback = new URL('/auth/login', host.location.origin);
    let returnTo = `${parentOrigin}/`;
    try {
      const candidate = new URL(parentReturnTo ?? '');
      if (candidate.origin === parentOrigin) returnTo = candidate.href;
    } catch { /* use the trusted shop root */ }
    fallback.searchParams.set('return_to', returnTo);
    try {
      host.top!.location.href = fallback.href;
      return;
    } catch {
      host.parent.postMessage({ type: 'pfusch:open-login', version: SHOPIFY_BRIDGE_VERSION }, parentOrigin);
    }
    return;
  }
  const current = new URL(host.location.href);
  const login = new URL('/auth/login', current.origin);
  login.searchParams.set('return_to', current.href);
  // OAuth must run top-level, including when an unsupported parent embeds the game.
  if (host.top && host.top !== host) host.top.location.href = login.href;
  else host.location.assign(login.href);
}
