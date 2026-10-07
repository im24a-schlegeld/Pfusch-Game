/* Storefront-only bridge. Cookies never cross into the embedded game. */
(() => {
  if (customElements.get('pfusch-game-bridge')) return;
  const parentOrigins = new Set(['https://pfusch-clothing.ch', 'https://www.pfusch-clothing.ch']);
  const statuses = new Set([200, 400, 401, 403, 409, 413, 422, 429, 500, 502, 503, 504]);
  const maxBytes = 131072;
  const isRecord = value => value && typeof value === 'object' && !Array.isArray(value);

  customElements.define('pfusch-game-bridge', class extends HTMLElement {
    connectedCallback() {
      if (!parentOrigins.has(location.origin) || this.receive) return;
      this.frame = this.querySelector('iframe');
      if (!this.frame) return;
      let gameUrl;
      try { gameUrl = new URL(this.frame.src); } catch { return; }
      if (gameUrl.protocol !== 'https:') return;
      this.gameOrigin = gameUrl.origin;
      const configuredLoginOrigin = this.getAttribute('data-login-origin');
      try {
        const loginUrl = new URL(configuredLoginOrigin || gameUrl.origin);
        this.loginOrigin = loginUrl.protocol === 'https:' && loginUrl.hostname.endsWith('.myshopify.dev')
          ? loginUrl.origin : gameUrl.origin;
      } catch { this.loginOrigin = gameUrl.origin; }
      this.guestPage = this.getAttribute('data-customer-state') === 'guest';
      this.setupGamePage();
      this.setupNewsletter();
      this.active = new Map();
      this.receive = event => this.handle(event);
      window.addEventListener('message', this.receive);
    }

    disconnectedCallback() {
      window.removeEventListener('message', this.receive);
      this.receive = null;
      for (const controller of this.active?.values() ?? []) controller.abort();
      this.active?.clear();
      this.resizeObserver?.disconnect();
      window.removeEventListener('resize', this.fitGame);
      window.visualViewport?.removeEventListener('resize', this.fitGame);
      window.visualViewport?.removeEventListener('scroll', this.fitGame);
      this.newsletter?.removeEventListener('close', this.restoreGameFocus);
      this.newsletter?.removeEventListener('click', this.closeNewsletter);
      if (this.newsletter?.open) this.newsletter.close();
      this.main?.classList.remove('pfusch-game-main');
      this.classList.remove('pfusch-game--riding');
      this.fullViewport = false;
      if (!document.querySelector('pfusch-game-bridge')) document.documentElement.classList.remove('pfusch-game-page', 'pfusch-game-ride');
    }

    setupGamePage() {
      this.main = this.closest('main');
      this.main?.classList.add('pfusch-game-main');
      document.documentElement.classList.add('pfusch-game-page');
      this.fitGame = () => {
        const viewport = window.visualViewport;
        const bottom = viewport ? viewport.height + viewport.offsetTop : window.innerHeight;
        const top = Math.max(0, this.getBoundingClientRect().top);
        const height = this.fullViewport ? (viewport?.height ?? window.innerHeight) : bottom - top;
        this.style.setProperty('--pfusch-game-height', `${Math.max(0, Math.floor(height))}px`);
      };
      this.resizeObserver = new ResizeObserver(this.fitGame);
      // Observe the actual header stack: announcement bars and responsive header heights can change.
      for (const header of document.querySelectorAll('.shopify-section-group-header-group, header')) this.resizeObserver.observe(header);
      window.addEventListener('resize', this.fitGame);
      window.visualViewport?.addEventListener('resize', this.fitGame);
      window.visualViewport?.addEventListener('scroll', this.fitGame);
      this.fitGame();
    }

    setRideViewport(active) {
      this.fullViewport = active;
      this.classList.toggle('pfusch-game--riding', active);
      document.documentElement.classList.toggle('pfusch-game-ride', active);
      this.fitGame();
    }

    setupNewsletter() {
      this.newsletter = this.querySelector('dialog');
      if (!this.newsletter) return;
      this.restoreGameFocus = () => {
        const target = this.previousFocus?.isConnected ? this.previousFocus : this.frame;
        target?.focus({ preventScroll: true });
        this.previousFocus = null;
      };
      this.closeNewsletter = event => {
        if (event.target.closest('[data-newsletter-close]')) this.newsletter.close();
      };
      // Native dialog supplies focus trapping, an inert background and Escape-to-close.
      this.newsletter.addEventListener('close', this.restoreGameFocus);
      this.newsletter.addEventListener('click', this.closeNewsletter);
    }

    openNewsletter() {
      if (!this.newsletter || this.newsletter.open) return;
      this.previousFocus = document.activeElement;
      this.newsletter.showModal();
      this.newsletter.querySelector('h2')?.focus({ preventScroll: true });
    }

    async handle(event) {
      if (event.origin !== this.gameOrigin || event.source !== this.frame.contentWindow) return;
      const message = event.data;
      if (isRecord(message) && message.type === 'pfusch:ride-viewport' && message.version === 1
        && typeof message.active === 'boolean'
        && Object.keys(message).every(key => ['type', 'version', 'active'].includes(key))) {
        this.setRideViewport(message.active);
        return;
      }
      if (isRecord(message) && message.type === 'pfusch:open-newsletter' && message.version === 1
        && Object.keys(message).every(key => ['type', 'version'].includes(key))) {
        this.openNewsletter();
        return;
      }
      if (isRecord(message) && message.type === 'pfusch:open-login' && message.version === 1
        && Object.keys(message).every(key => ['type', 'version'].includes(key))) {
        // Start the same Customer Account OAuth flow that the game server
        // uses. A parent-page /account/login only creates the Online Store
        // cookie; it cannot authenticate the cross-origin Oxygen API iframe.
        const login = new URL('/auth/login', this.loginOrigin);
        login.searchParams.set('return_to', location.href);
        window.location.assign(login.href);
        return;
      }
      if (!isRecord(message) || message.type !== 'pfusch:cloud-request' || message.version !== 1
        || typeof message.requestId !== 'string' || !/^[a-zA-Z0-9-]{16,64}$/.test(message.requestId)
        || !['GET', 'POST'].includes(message.method)
        || !['player', 'leaderboard'].includes(message.resource)
        || Object.keys(message).some(key => !['type', 'version', 'requestId', 'method', 'resource', 'period', 'payload'].includes(key))) return;
      if (this.active.has(message.requestId)) return;
      const reply = (status, data) => {
        if (this.isConnected) event.source.postMessage({ type: 'pfusch:cloud-response', version: 1, requestId: message.requestId, status, data }, this.gameOrigin);
      };
      if (this.active.size >= 4) { reply(429, { error: 'busy' }); return; }
      if (message.resource === 'leaderboard' && (message.method !== 'GET' || !['day', 'week', 'all'].includes(message.period))) { reply(400, { error: 'invalid_request' }); return; }
      if (message.resource === 'player' && message.period !== undefined) { reply(400, { error: 'invalid_request' }); return; }
      let body;
      if (message.method === 'POST') {
        const value = message.payload;
        if (!isRecord(value) || !isRecord(value.player) || !Object.hasOwn(value, 'compareDigest')
          || !(value.compareDigest === null || (typeof value.compareDigest === 'string' && /^[a-f0-9]{64}$/i.test(value.compareDigest)))
          || typeof value.csrfToken !== 'string' || value.csrfToken.length > 4096
          || Object.keys(value).some(key => !['player', 'compareDigest', 'csrfToken'].includes(key))) { reply(400, { error: 'invalid_request' }); return; }
        try { body = JSON.stringify(value); }
        catch { reply(400, { error: 'invalid_request' }); return; }
        if (new TextEncoder().encode(body).length > maxBytes) { reply(413, { error: 'too_large' }); return; }
      } else if (message.payload !== undefined) { reply(400, { error: 'invalid_request' }); return; }
      // Liquid confirms only that this page has no signed-in customer. It can
      // select the existing five-ride local trial, never account or newsletter
      // permission. Customer/unknown pages and every write still use the proxy.
      if (this.guestPage && message.method === 'GET' && message.resource === 'player') {
        reply(401, { error: 'guest' });
        return;
      }
      const controller = new AbortController();
      this.active.set(message.requestId, controller);
      const timeout = setTimeout(() => controller.abort(), 14000);
      try {
        const path = message.resource === 'leaderboard' ? '/apps/pfusch-game/leaderboard?period=' + message.period : '/apps/pfusch-game/player';
        const response = await fetch(path, {
          method: message.method,
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
          ...(body ? { body } : {}),
          signal: controller.signal,
        });
        if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Unexpected proxy response');
        const text = await response.text();
        if (new TextEncoder().encode(text).length > maxBytes) throw new Error('Response too large');
        reply(statuses.has(response.status) ? response.status : 502, JSON.parse(text));
      } catch { reply(503, { error: 'unavailable' }); }
      finally { clearTimeout(timeout); this.active.delete(message.requestId); }
    }
  });
})();
