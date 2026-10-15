import { describe, expect, it, vi } from 'vitest';
import { isDashboardEditor, handleDashboardPlayers, handleGamePresence, listDashboardPlayers } from '../server/oxygen/adminManagement';
import type { ShopifyConfig } from '../server/shopify/auth';

const config: ShopifyConfig = { shop: 'demo-tests.myshopify.com', clientId: 'test-admin-app-key', secret: 'local-test-secret' };
const url = (input: RequestInfo | URL) => typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
const mock = (data: Record<string, unknown>) => vi.fn<typeof fetch>(async input => {
  if (url(input).endsWith('/oauth/access_token')) return Response.json({
    access_token: 'test-only-token', expires_in: 7200, scope: 'write_customers,write_discounts',
  });
  return Response.json({ data });
});

describe('Shopify dashboard management', () => {
  it('grants write permissions only to explicitly allowlisted numeric staff IDs', () => {
    expect(isDashboardEditor('123', undefined)).toBe(false);
    expect(isDashboardEditor('123', '')).toBe(false);
    expect(isDashboardEditor('123', '1234,777')).toBe(false);
    expect(isDashboardEditor('123', '1234, 123, 777')).toBe(true);
    expect(isDashboardEditor('123', 'not-a-staff-id')).toBe(false);
  });
  it('rejects any unsigned or anonymous user edit before a Shopify request', async () => {
    const network = vi.fn<typeof fetch>();
    const request = new Request('https://game.example/api/admin/players', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: '77', field: 'coins', value: 500 }),
    });
    expect((await handleDashboardPlayers(request, config, network, '123')).status).toBe(401);
    expect(network).not.toHaveBeenCalled();
  });
  it('shows real Shopify e-mail and only an observed, recent signed-in presence', async () => {
    const now = Date.now();
    const data = { customers: { nodes: [
      { id: 'gid://shopify/Customer/77', email: 'customer@example.com', firstName: 'Alex', lastName: 'Rider',
        game: { value: JSON.stringify({ version: 1, xp: 150, coins: 90, guardianBells: { earned: 2, spent: 1 }, runsPlayed: 3 }) },
        presence: { value: JSON.stringify({ lastSeen: now - 35_000 }) } },
      { id: 'gid://shopify/Customer/78', email: null, firstName: null, lastName: null, game: null,
        presence: { value: JSON.stringify({ lastSeen: now - 250_000 }) } },
    ], pageInfo: { hasNextPage: false, endCursor: null } } };
    const result = await listDashboardPlayers(config, mock(data), new URL('https://game.example/api/admin/players'), now);
    expect(result.rows[0]).toMatchObject({ id: '77', email: 'customer@example.com', name: 'Alex Rider', online: true });
    expect(result.rows[1]).toMatchObject({ email: null, online: false, player: null });
    expect(result.live).toBe(1);
    expect(result.liveSampleOnly).toBe(true);
  });
  it('rejects malformed searches rather than forwarding them to Shopify', async () => {
    const network = vi.fn<typeof fetch>();
    await expect(listDashboardPlayers(config, network, new URL('https://game.example/api/admin/players?q=%00'), Date.now()))
      .rejects.toMatchObject({ status: 400 });
    expect(network).not.toHaveBeenCalled();
  });
  it('never accepts guest, unauthenticated presence writes', async () => {
    const network = vi.fn<typeof fetch>();
    const response = await handleGamePresence(new Request('https://game.example/api/presence/ping', { method: 'POST' }), config, '', network);
    expect(response.status).toBe(401);
    expect(network).not.toHaveBeenCalled();
  });
});
