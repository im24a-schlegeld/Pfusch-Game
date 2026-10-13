import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { handleOxygenRequest } from '../server/oxygen/runtime';
import manifest from '../public/manifest.json' with { type: 'json' };

describe('public install manifest on Oxygen', () => {
  it('links the JSON asset type supported by the live CDN', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    expect(html).toContain('<link rel="manifest" href="/manifest.json"');
    expect(manifest.id).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.map(icon => icon.sizes)).toEqual(['192x192', '512x512']);
  });

  it('serves the same manifest for previously loaded pages without authentication or storage changes', async () => {
    const request = vi.fn<typeof fetch>();
    const response = await handleOxygenRequest(new Request('https://game.pfusch-clothing.ch/manifest.webmanifest'), {}, '<head></head>', request);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/manifest+json; charset=utf-8');
    expect(response.headers.has('set-cookie')).toBe(false);
    expect(await response.json()).toEqual(manifest);
    expect(request).not.toHaveBeenCalled();
  });

  it('supports a public HEAD check and rejects mutation methods on the compatibility URL', async () => {
    const request = vi.fn<typeof fetch>();
    const head = await handleOxygenRequest(new Request('https://game.pfusch-clothing.ch/manifest.webmanifest', { method: 'HEAD' }), {}, '<head></head>', request);
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    const post = await handleOxygenRequest(new Request('https://game.pfusch-clothing.ch/manifest.webmanifest', { method: 'POST' }), {}, '<head></head>', request);
    expect(post.status).toBe(405);
    expect(request).not.toHaveBeenCalled();
  });
});
