import type { GuardianBells, Player } from './types';

export const MAX_GUARDIAN_BELLS = 1_000_000;
export const MAX_BELL_RUN_IDS = 100;
const validRunId = (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= 160 &&
  ![...id].some(character => character.charCodeAt(0) < 32);

/** Explicit additive schema-1 migration. Corrupt ledgers enter save recovery. */
export function readGuardianBells(value: unknown): GuardianBells {
  if (value === undefined) return { earned: 0, spent: 0, spentRunIds: [] };
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Ungültiger Guardian-Bell-Spielstand.');
  const data = value as Record<string, unknown>;
  if (Object.keys(data).length !== 3 || !Number.isSafeInteger(data.earned) || !Number.isSafeInteger(data.spent) ||
      typeof data.earned !== 'number' || typeof data.spent !== 'number' || data.earned < 0 || data.earned > MAX_GUARDIAN_BELLS ||
      data.spent < 0 || data.spent > data.earned || !Array.isArray(data.spentRunIds) ||
      data.spentRunIds.length !== Math.min(data.spent, MAX_BELL_RUN_IDS) || !data.spentRunIds.every(validRunId) ||
      new Set(data.spentRunIds).size !== data.spentRunIds.length) throw new Error('Ungültiger Guardian-Bell-Spielstand.');
  return { earned: data.earned, spent: data.spent, spentRunIds: [...data.spentRunIds] as string[] };
}

export function guardianBellBalance(player: Player): number {
  return player.id.startsWith('shopify:') ? player.guardianBells.earned - player.guardianBells.spent : 0;
}

/** The caller also holds the existing one-revive-per-run gameplay gate. */
export function spendGuardianBell(player: Player, runId: string): Player | null {
  if (!validRunId(runId) || guardianBellBalance(player) < 1 || player.guardianBells.spentRunIds.includes(runId)) return null;
  return { ...player, guardianBells: { ...player.guardianBells, spent: player.guardianBells.spent + 1,
    spentRunIds: [...player.guardianBells.spentRunIds, runId].slice(-MAX_BELL_RUN_IDS) } };
}
