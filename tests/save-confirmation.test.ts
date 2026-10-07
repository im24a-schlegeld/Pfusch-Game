import { describe, expect, it } from 'vitest';
import { confirmPlayerSave } from '../app/services/saveConfirmation';
import type { PlayerSyncStatus } from '../app/services';

describe('repository save confirmation', () => {
  it('does not call a resolved cloud flush a success when the adapter reports a failure', async () => {
    for (const state of ['offline', 'conflict', 'unavailable', 'saving', 'loading'] as const) {
      const result = await confirmPlayerSave({ flush: async () => {}, warning: '', syncStatus: { state, message: 'Noch nicht gespeichert.' } });
      expect(result).toEqual({ confirmed: false, detail: 'Noch nicht gespeichert.' });
    }
  });
  it('waits for the exact flush and reads its final status before confirming', async () => {
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const repository: { warning: string; syncStatus: PlayerSyncStatus; flush: () => Promise<void> } = {
      warning: '', syncStatus: { state: 'saving', message: 'Wird gespeichert' }, flush: () => pending,
    };
    let finished = false;
    const result = confirmPlayerSave(repository).then(value => { finished = true; return value; });
    await Promise.resolve();
    expect(finished).toBe(false);
    repository.syncStatus = { state: 'synced', message: 'Im Konto gespeichert' };
    release();
    expect(await result).toEqual({ confirmed: true, detail: '' });
  });
  it('handles synchronous local saves, persistent adapter warnings and rejected flushes', async () => {
    expect(await confirmPlayerSave({ warning: '' })).toEqual({ confirmed: true, detail: '' });
    expect(await confirmPlayerSave({ warning: 'Speicher nicht verfügbar' })).toEqual({ confirmed: false, detail: 'Speicher nicht verfügbar' });
    expect((await confirmPlayerSave({ warning: '', flush: async () => { throw new Error('offline'); } })).confirmed).toBe(false);
  });
});
