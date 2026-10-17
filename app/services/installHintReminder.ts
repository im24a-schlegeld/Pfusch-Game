import type { StorageDriver } from './index';

const key = 'pfusch:install-hint:v1:last-shown';
const week = 7 * 24 * 60 * 60 * 1000;

/** A device reminder, separate from the player's cloud-synced save. */
export class InstallHintReminder {
  private visible: boolean | undefined;
  constructor(private storage: StorageDriver, private now = () => Date.now()) {}

  shouldShow(): boolean {
    if (this.visible !== undefined) return this.visible;
    const now = this.now();
    let lastShown = NaN;
    try {
      const saved = this.storage.getItem(key);
      if (saved !== null && saved.trim()) lastShown = Number(saved);
    } catch { /* A blocked store must not interrupt the game. */ }
    this.visible = !(Number.isSafeInteger(lastShown) && lastShown >= 0 && lastShown <= now && now - lastShown < week);
    if (this.visible) this.remember(now);
    return this.visible;
  }

  dismiss(): void {
    this.visible = false;
    this.remember(this.now());
  }

  private remember(time: number): void {
    try { this.storage.setItem(key, String(time)); }
    catch { /* The current visit still respects dismissal without storage. */ }
  }
}
