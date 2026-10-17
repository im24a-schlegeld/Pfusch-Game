import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import SaveAccessGate from '../app/ui/SaveAccessGate';

vi.mock('@/components/ui/dialog', () => {
  const content = ({ children }: { children?: ReactNode }) => children;
  return { Dialog: content, DialogContent: content, DialogDescription: content, DialogTitle: content };
});

const denied = { allowed: false, reason: 'newsletter_required' as const, completedRuns: 5, freeRuns: 5 as const };
const render = (authenticated: boolean) => renderToStaticMarkup(createElement(SaveAccessGate, {
  open: true, access: denied, authenticated, checking: false, loginHref: '/auth/login',
  onNewsletter: () => {}, onStart: () => {}, back: () => {},
}));

describe('newsletter gate after account login', () => {
  it('keeps newsletter denial actionable without asking an authenticated player to log in again', () => {
    const html = render(true);
    expect(html).toContain('NEWSLETTER ABONNIEREN');
    expect(html).toContain('ZUM NEWSLETTER');
    expect(html).not.toContain('MIT PFUSCH-KONTO ANMELDEN');
    expect(html).not.toContain('Melde dich im Shop');
  });

  it('still offers account login to a guest whose free rides are exhausted', () => {
    const html = render(false);
    expect(html).toContain('MIT PFUSCH-KONTO ANMELDEN');
    expect(html).toContain('Melde dich im Shop');
  });
});
