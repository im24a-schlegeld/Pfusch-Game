import type { Player } from '../../app/domain/types.js';
import { ApiError } from './auth.js';
import { isRecord } from './playerValidation.js';

export const FREE_RUNS = 5;
const marketingStates = ['INVALID', 'NOT_SUBSCRIBED', 'PENDING', 'REDACTED', 'SUBSCRIBED', 'UNSUBSCRIBED'] as const;
export type MarketingState = typeof marketingStates[number];
export interface StorageAccess {
  allowed: boolean;
  reason: 'subscribed' | 'trial' | 'newsletter_required' | 'unsubscribed';
  completedRuns: number;
  freeRuns: typeof FREE_RUNS;
}

/** Consent comes only from the authenticated Admin API response. Missing or
 * unrecognized authority must never silently become an available trial. */
export function readMarketingState(consent: unknown): MarketingState {
  if (!isRecord(consent) || !marketingStates.includes(consent.marketingState as MarketingState))
    throw new ApiError(503, 'consent_unavailable');
  return consent.marketingState as MarketingState;
}

export function storageAccess(state: MarketingState, completedRuns: number): StorageAccess {
  const reason = state === 'SUBSCRIBED' ? 'subscribed' : state === 'UNSUBSCRIBED' ? 'unsubscribed'
    : completedRuns < FREE_RUNS ? 'trial' : 'newsletter_required';
  return { allowed: reason === 'subscribed' || reason === 'trial', reason, completedRuns, freeRuns: FREE_RUNS };
}

/** Preserve the durable count even if a client restores an older local save.
 * New settled run IDs cannot evade counting by lowering runsPlayed. This is
 * not server simulation: offline runs omitted by a modified client cannot be
 * discovered here, and this snapshot never authorizes valuable rewards. */
export function retainRunCount(incoming: Player, saved: Player | null): Player {
  const previousIds = new Set(saved?.processedRuns ?? []);
  const addedRuns = incoming.processedRuns.filter(id => !previousIds.has(id)).length;
  return { ...incoming, runsPlayed: Math.min(1e12, Math.max(incoming.runsPlayed,
    (saved?.runsPlayed ?? 0) + addedRuns)) };
}

/** A fifth trial run can settle once, then both play and saving are locked.
 * A prior unsubscribe has no remaining trial, even before five runs. */
export function canSave(state: MarketingState, savedRuns: number, incomingRuns: number): boolean {
  return state === 'SUBSCRIBED' || (state !== 'UNSUBSCRIBED' && savedRuns < FREE_RUNS && incomingRuns <= FREE_RUNS);
}
