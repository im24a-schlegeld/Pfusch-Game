import { describe, expect, it } from 'vitest';
import { InstallHintReminder } from '../app/services/installHintReminder';
import type { StorageDriver } from '../app/services';

const week = 7 * 24 * 60 * 60 * 1000;
function memoryStorage(): StorageDriver & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
}

describe('weekly app installation reminder', () => {
  it('keeps the first hint visible in its visit and suppresses reloads for seven days', () => {
    const storage = memoryStorage();
    let now = Date.UTC(2026, 9, 17);
    const reminder = new InstallHintReminder(storage, () => now);
    expect(reminder.shouldShow()).toBe(true);
    expect(reminder.shouldShow()).toBe(true);
    expect(new InstallHintReminder(storage, () => now).shouldShow()).toBe(false);
    now += week - 1;
    expect(new InstallHintReminder(storage, () => now).shouldShow()).toBe(false);
    now += 1;
    expect(new InstallHintReminder(storage, () => now).shouldShow()).toBe(true);
  });

  it('dismissal also hides the current visit and postpones the next reminder for a week', () => {
    const storage = memoryStorage();
    let now = Date.UTC(2026, 9, 17);
    const reminder = new InstallHintReminder(storage, () => now);
    expect(reminder.shouldShow()).toBe(true);
    now += 60_000;
    reminder.dismiss();
    expect(reminder.shouldShow()).toBe(false);
    now += week - 1;
    expect(new InstallHintReminder(storage, () => now).shouldShow()).toBe(false);
    now += 1;
    expect(new InstallHintReminder(storage, () => now).shouldShow()).toBe(true);
  });

  it('does not let damaged timestamps or unavailable storage interrupt the game', () => {
    const storage = memoryStorage();
    const now = Date.UTC(2026, 9, 17);
    new InstallHintReminder(storage, () => now).shouldShow();
    for (const key of storage.values.keys()) storage.values.set(key, 'not-a-date');
    expect(new InstallHintReminder(storage, () => now).shouldShow()).toBe(true);
    const blocked = new InstallHintReminder({ getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); } }, () => now);
    expect(blocked.shouldShow()).toBe(true);
    expect(() => blocked.dismiss()).not.toThrow();
    expect(blocked.shouldShow()).toBe(false);
  });
});
