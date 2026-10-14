import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import OfflineInstallHint from '../app/ui/OfflineInstallHint';
import type { OfflineAppState } from '../app/services/offlineApp';

const render = (offline: OfflineAppState) => renderToStaticMarkup(createElement(OfflineInstallHint, {
  offline, dismiss: () => {}, openSettings: () => {},
}));

describe('post-login app installation hint', () => {
  it('offers the native install action when the browser can prompt, with pending offline status', () => {
    const html = render({ installed: false, installable: true, state: 'preparing' });
    expect(html).toContain('data-testid="offline-install-hint"');
    expect(html).toContain('>INSTALLIEREN</button>');
    expect(html).toContain('Offline wird vorbereitet');
    expect(html).not.toContain('offline bereit');
    expect(html).not.toContain('Browsermenü');
    expect(html).toContain('aria-label="Installationshinweis schließen"');
  });

  it('provides browser and Safari instructions without claiming an unavailable package is ready', () => {
    const html = render({ installed: false, installable: false, state: 'unavailable' });
    expect(html).toContain('Browsermenü');
    expect(html).toContain('Safari');
    expect(html).toContain('Zum Home-Bildschirm');
    expect(html).toContain('Offline-Status prüfen');
    expect(html).not.toContain('>INSTALLIEREN</button>');
    expect(html).not.toContain('offline bereit');
    expect(html).toContain('sobald du wieder online bist');
  });

  it('only declares readiness for a ready package, and hides the card after installation', () => {
    expect(render({ installed: false, installable: false, state: 'ready' })).toContain('Spiel ist offline bereit');
    expect(render({ installed: true, installable: false, state: 'ready' })).toBe('');
  });
});
