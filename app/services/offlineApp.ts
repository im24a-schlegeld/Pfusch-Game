export interface OfflineAppState {
  state: 'preparing' | 'ready' | 'unavailable' | 'unsupported';
  installable: boolean;
  installed: boolean;
}
interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
let status: OfflineAppState = { state: 'preparing', installable: false, installed: false };
let installPrompt: InstallPrompt | null = null;
let pending: Promise<void> | null = null;
let initialized = false;
const listeners = new Set<() => void>();
function publish(next: Partial<OfflineAppState>) {
  status = { ...status, ...next };
  for (const listener of listeners) listener();
}
export function subscribeOfflineApp(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export const getOfflineAppState = () => status;

function activeWorker(registration: ServiceWorkerRegistration): Promise<ServiceWorker> {
  if (registration.active) return Promise.resolve(registration.active);
  const worker = registration.installing ?? registration.waiting;
  if (!worker) return Promise.reject(new Error('Offline worker unavailable'));
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => { worker.removeEventListener('statechange', changed); reject(new Error('Offline download timed out')); }, 120000);
    const changed = () => {
      if (worker.state !== 'activated' && worker.state !== 'redundant') return;
      window.clearTimeout(timer); worker.removeEventListener('statechange', changed);
      if (worker.state === 'activated') resolve(worker); else reject(new Error('Offline download failed'));
    };
    worker.addEventListener('statechange', changed); changed();
  });
}

function askWorker(worker: ServiceWorker, type: string, urls?: string[]): Promise<{ ready?: boolean }> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = window.setTimeout(() => { channel.port1.close(); reject(new Error('Offline status unavailable')); }, type.endsWith('WARM') ? 60000 : 5000);
    channel.port1.onmessage = (event: MessageEvent<{ ready?: boolean }>) => {
      window.clearTimeout(timeout); channel.port1.close(); resolve(event.data);
    };
    worker.postMessage({ type, ...(urls ? { urls } : {}) }, [channel.port2]);
  });
}

async function prepare() {
  publish({ state: 'preparing' });
  try {
    let registration = await navigator.serviceWorker.getRegistration('/');
    if (navigator.onLine) {
      try { registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }); }
      catch (error) { if (!registration) throw error; }
    }
    if (!registration) throw new Error('Open online first');
    const active = await activeWorker(registration);
    const answer = await askWorker(active, 'PFUSCH_OFFLINE_STATUS');
    if (!answer.ready) throw new Error('Offline package incomplete');
    // Loaded clothing and product art from the first, previously uncontrolled page.
    // The worker only accepts URLs in the build's public asset allowlist.
    if (navigator.onLine) {
      const urls = performance.getEntriesByType('resource').map((entry) => entry.name);
      await askWorker(active, 'PFUSCH_OFFLINE_WARM', urls).catch(() => {});
    }
    publish({ state: 'ready' });
  } catch { publish({ state: 'unavailable' }); }
}
export function prepareOfflineApp() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext || window.parent !== window) {
    publish({ state: 'unsupported' });
    return Promise.resolve();
  }
  return pending ??= prepare().finally(() => { pending = null; });
}
export function registerOfflineApp() {
  if (initialized) return;
  initialized = true;
  publish({ installed: window.matchMedia('(display-mode: standalone)').matches || !!(navigator as Navigator & { standalone?: boolean }).standalone });
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault(); installPrompt = event as InstallPrompt; publish({ installable: true });
  });
  window.addEventListener('appinstalled', () => { installPrompt = null; publish({ installable: false, installed: true }); });
  window.addEventListener('online', () => { void prepareOfflineApp(); });
  // No timers, frame work or polling during gameplay. Download after initial page load.
  if (document.readyState === 'complete') void prepareOfflineApp();
  else window.addEventListener('load', () => { void prepareOfflineApp(); }, { once: true });
}
export async function installOfflineApp() {
  const prompt = installPrompt;
  if (!prompt) return;
  installPrompt = null;
  publish({ installable: false });
  try { await prompt.prompt(); await prompt.userChoice; } catch { /* Closing the browser's prompt is harmless. */ }
}
