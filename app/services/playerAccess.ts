export interface PlayerAccess {
  allowed: boolean;
  reason: 'subscribed' | 'trial' | 'newsletter_required' | 'unsubscribed' | 'unavailable';
  completedRuns: number;
  freeRuns: 5;
}

export const trialAccess = (completedRuns: number): PlayerAccess => ({
  allowed: completedRuns < 5,
  reason: completedRuns < 5 ? 'trial' : 'newsletter_required',
  completedRuns,
  freeRuns: 5,
});

export const unavailableAccess = (completedRuns = 0): PlayerAccess => ({
  allowed: false, reason: 'unavailable', completedRuns, freeRuns: 5,
});

/** Accept only the server's explicit live-consent decision, never a client flag. */
export function serverAccess(value: unknown): PlayerAccess {
  if (!value || typeof value !== 'object') throw new Error('Ungültige Freigabe');
  const access = value as Record<string, unknown>;
  if (typeof access.allowed !== 'boolean' || access.freeRuns !== 5 || typeof access.completedRuns !== 'number'
    || !Number.isSafeInteger(access.completedRuns) || access.completedRuns < 0) throw new Error('Ungültige Freigabe');
  const valid = access.reason === 'subscribed' ? access.allowed
    : access.reason === 'unsubscribed' ? !access.allowed
      : access.reason === 'trial' ? access.allowed && access.completedRuns < 5
        : access.reason === 'newsletter_required' ? !access.allowed && access.completedRuns >= 5 : false;
  if (!valid) throw new Error('Ungültige Freigabe');
  return { allowed: access.allowed, reason: access.reason as PlayerAccess['reason'], completedRuns: access.completedRuns, freeRuns: 5 };
}

export const accessMessage = (access: PlayerAccess) => access.reason === 'unsubscribed'
  ? 'Newsletter abgemeldet. Weitere Fahrten und Speichern sind gesperrt.'
  : access.reason === 'newsletter_required'
    ? 'Fünf Gratisfahrten abgeschlossen. Für weitere Fahrten und Speichern den Newsletter im Shop abonnieren.'
    : 'Freigabe nicht bestätigt. Shop-Verbindung prüfen und den Status erneut prüfen.';
