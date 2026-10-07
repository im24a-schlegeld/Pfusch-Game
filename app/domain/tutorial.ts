import type { Player, TutorialHint } from './types';

export const TUTORIAL_HINTS = ['controls', 'ramp', 'police', 'radar', 'traffic', 'signs'] as const satisfies readonly TutorialHint[];

export function isTutorialHint(value: unknown): value is TutorialHint {
  return typeof value === 'string' && TUTORIAL_HINTS.some(hint => hint === value);
}

/** Explicit additive v1 migration: absent/malformed optional data never marks a new lesson as seen. */
export function normalizeTutorialHints(value: unknown): TutorialHint[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set(value.filter(isTutorialHint));
  return TUTORIAL_HINTS.filter(hint => seen.has(hint));
}

export function hasSeenTutorial(player: Player, hint: TutorialHint): boolean {
  return player.settings.tutorialHintsSeen.includes(hint);
}

/** Keep unrelated progress and cosmetics intact. Repeated acknowledgements are a no-op. */
export function markTutorialsSeen(player: Player, hints: readonly TutorialHint[]): Player {
  const tutorialHintsSeen = normalizeTutorialHints([...player.settings.tutorialHintsSeen, ...hints]);
  const tutorialSeen = player.settings.tutorialSeen || tutorialHintsSeen.includes('controls');
  if (tutorialSeen === player.settings.tutorialSeen && tutorialHintsSeen.length === player.settings.tutorialHintsSeen.length &&
    tutorialHintsSeen.every((hint, index) => player.settings.tutorialHintsSeen[index] === hint)) return player;
  return { ...player, settings: { ...player.settings, tutorialSeen, tutorialHintsSeen } };
}

export function markTutorialSeen(player: Player, hint: TutorialHint): Player {
  return markTutorialsSeen(player, [hint]);
}
