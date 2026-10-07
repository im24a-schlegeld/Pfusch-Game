import type { PlayerRepository } from './index';

export interface SaveConfirmation { confirmed: boolean; detail: string }

/** Cloud adapters may resolve failed flushes and communicate failure through status instead. */
export async function confirmPlayerSave(repository: Pick<PlayerRepository, 'flush' | 'warning' | 'syncStatus'>): Promise<SaveConfirmation> {
  try {
    await repository.flush?.();
    const state = repository.syncStatus?.state;
    const confirmed = !repository.warning && (!state || state === 'local' || state === 'guest' || state === 'synced');
    return { confirmed, detail: confirmed ? '' : repository.warning || repository.syncStatus?.message || 'Bitte erneut speichern.' };
  } catch {
    return { confirmed: false, detail: 'Bitte Verbindung prüfen und erneut speichern.' };
  }
}
