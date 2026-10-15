/** Only signed-in Oxygen customers can be counted. Guests are intentionally excluded. */
export function startOnlinePresence() {
  if (typeof window === 'undefined' || !document.getElementById('pfusch-runtime-config')) return;
  let pending = false;
  let lastAttempt = 0;
  const ping = () => {
    if (document.visibilityState !== 'visible' || !navigator.onLine || pending) return;
    const now = Date.now();
    if (now - lastAttempt < 75_000) return;
    lastAttempt = now;
    pending = true;
    void fetch('/api/presence/ping', { method: 'POST', credentials: 'same-origin', cache: 'no-store' })
      .catch(() => { /* Presence must never affect playable game or login. */ })
      .finally(() => { pending = false; });
  };
  // Lives for the lifetime of the standalone game document.
  window.setInterval(ping, 90_000);
  document.addEventListener('visibilitychange', ping);
  window.addEventListener('online', ping);
  ping();
}
