import { SHOPIFY_BRIDGE_VERSION, SHOPIFY_PARENT_ORIGINS, shopifyParentOrigin } from './shopifyBridge';

function loopbackOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === value && url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  } catch { return false; }
}

/** Local preview is layout-only; it never selects the cloud or authentication transport. */
export function rideViewportParentOrigin(embedded: boolean, referrer: string, developmentOrigin?: string): string | null {
  const shop = shopifyParentOrigin(embedded, referrer);
  if (shop) return shop;
  if (!embedded || !developmentOrigin || !loopbackOrigin(developmentOrigin)) return null;
  try { return new URL(referrer).origin === developmentOrigin ? developmentOrigin : null; }
  catch { return null; }
}

/** Coordinate CSS viewport mode with the shop, without browser fullscreen or history interception. */
export function syncShopifyRideViewport(host: Window, parentOrigin: string | null, active: boolean): () => void {
  if (!parentOrigin || host.parent === host || (!SHOPIFY_PARENT_ORIGINS.has(parentOrigin)
    && !(loopbackOrigin(parentOrigin) && host.location.origin === parentOrigin))) return () => {};
  const send = (value: boolean) => {
    host.parent.postMessage({ type: 'pfusch:ride-viewport', version: SHOPIFY_BRIDGE_VERSION, active: value }, parentOrigin);
  };
  const restore = () => send(active);
  const release = () => send(false);
  send(active);
  // A cached iframe can be restored without remounting React. Release the shop
  // when leaving, and restore the current ride state when returning from cache.
  host.addEventListener('pageshow', restore);
  host.addEventListener('pagehide', release);
  return () => {
    host.removeEventListener('pageshow', restore);
    host.removeEventListener('pagehide', release);
    release();
  };
}
