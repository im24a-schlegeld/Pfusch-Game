import type { Player, Product } from '../domain/types';
import { newPlayer } from '../domain/progression';
import { guestInventory } from '../domain/guestInventory';
import catalog from '../../public/catalog/products.json';
import { REWARDS } from '../domain/config';
import type { AuthService, PlayerRepository, PlayerSyncStatus, StorageDriver } from './index';
import type { CloudResponse, CloudTransport } from './shopifyBridge';
import { accessMessage, serverAccess, trialAccess, unavailableAccess, type PlayerAccess } from './playerAccess';
import { NO_GIFTS, readPlayerGifts, type PlayerGift } from './playerGifts';

interface Snapshot {
  customer: { id: string };
  player: Player | null;
  compareDigest: string | null;
  csrfToken: string;
  gifts: PlayerGift[];
  storage: PlayerAccess;
  purchases: { items: string[]; available: boolean; reason?: 'orders_scope_missing' | 'orders_unavailable'; history: 'all' | 'recent' };
}
interface Backup { player: Player; compareDigest: string | null; dirty: boolean; attempted?: Player }
type Decoder = (raw: string) => Player;
const guestKey = 'pfusch:player:v1';
const importedGuestKey = 'pfusch:player:v1:guest-imported';
const offlineAccountKey = 'pfusch:player:v1:offline-account';
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const digest = (value: unknown): value is string | null => value === null || (typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value));
const transientStatus = (status: number) => status >= 500 || status === 408 || status === 429;
const sameDigitalProgress = (left: Player, right: Player) => {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : record(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  return JSON.stringify(canonical({ ...left, irlItems: [], tickets: 0 })) === JSON.stringify(canonical({ ...right, irlItems: [], tickets: 0 }));
};
interface ServerCredit { coins: number; bells: number }
const serverCredit = (before: Player, after: Player): ServerCredit | null => {
  const coins = after.coins - before.coins, bells = after.guardianBells.earned - before.guardianBells.earned;
  if (!Number.isSafeInteger(coins) || coins < 0 || !Number.isSafeInteger(bells) || bells < 0 || !(coins || bells)) return null;
  // Only server credit may differ from the acknowledged base. A concurrent
  // debit/receipt or other device edit still requires the existing CAS recovery.
  return sameDigitalProgress(before, { ...after, coins: before.coins,
    guardianBells: { ...after.guardianBells, earned: before.guardianBells.earned } }) ? { coins, bells } : null;
};
const addServerCredit = (player: Player, credit: ServerCredit): Player => ({ ...player, coins: player.coins + credit.coins,
  guardianBells: { ...player.guardianBells, earned: player.guardianBells.earned + credit.bells } });

/** Cloud saves grant digital progress only, never purchase/reward authority. */
export function digitalPlayer(player: Player, customerId: string): Player {
  return { ...player, id: `shopify:${customerId}`, irlItems: [], tickets: 0,
    redeemedRewards: player.redeemedRewards.filter(id => REWARDS.some(reward => reward.id === id && reward.kind !== 'future')) };
}
function snapshot(data: unknown, decode: Decoder): Snapshot {
  if (!record(data) || !record(data.customer) || typeof data.customer.id !== 'string' || !/^[1-9]\d{0,30}$/.test(data.customer.id)
    || !digest(data.compareDigest) || typeof data.csrfToken !== 'string' || data.csrfToken.length < 16 || data.csrfToken.length > 4096
    || (data.player === null) !== (data.compareDigest === null)) throw new Error('Ungültige Kontodaten');
  const input = data.purchases;
  const purchases: Snapshot['purchases'] = { items: [], available: false, reason: 'orders_unavailable', history: 'recent' };
  if (record(input) && typeof input.available === 'boolean' && ['all', 'recent'].includes(String(input.history)) &&
      Array.isArray(input.items) && input.items.length <= 500 && input.items.every(id => typeof id === 'string' && id.length <= 160)) {
    purchases.available = input.available; purchases.history = input.history as 'all' | 'recent';
    purchases.reason = input.reason === 'orders_scope_missing' ? input.reason : input.available ? undefined : 'orders_unavailable';
    purchases.items = input.available ? input.items as string[] : [];
  }
  const player = data.player === null ? null : { ...digitalPlayer(decode(JSON.stringify({ ...(record(data.player) ? data.player : {}), irlItems: purchases.items })), data.customer.id), irlItems: purchases.items };
  return { customer: { id: data.customer.id }, player, purchases,
    compareDigest: data.compareDigest, csrfToken: data.csrfToken, storage: serverAccess(data.storage), gifts: readPlayerGifts(data.gifts) };
}

/** One shared bootstrap; every later ride explicitly refreshes live consent. */
export class ShopifyCloudRepository implements PlayerRepository, AuthService {
  warning = '';
  syncStatus: PlayerSyncStatus = { state: 'loading', message: 'Konto-Spielstand wird geladen …' };
  private listeners = new Set<() => void>();
  private initial: Promise<Player> | null = null;
  private refreshing: Promise<PlayerAccess> | null = null;
  private session: Snapshot | null = null;
  private authenticated = false;
  private authRevision = 0;
  private guestMode = false;
  private guestPlayer: Player | null = null;
  private access = unavailableAccess();
  private localCompletedRuns = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: Player | null = null;
  private outbox: Backup | null = null;
  private lastUnsaved: Player | null = null;
  private inFlight: Promise<void> | null = null;
  private blocked = false;
  private backupWritable = true;
  private recoveryPlayer: Player | null = null;
  private offline = false;
  private lastAttempt: Player | null = null;
  private guestLoading: Promise<Player> | null = null;
  private acknowledgedGifts = new Map<string, Set<string>>();

  constructor(private transport: CloudTransport, private storage: StorageDriver,
    private guest: PlayerRepository, private decode: Decoder, private debounceMs = 900,
    private isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false) {}

  get purchaseStatus() { return this.authenticated ? this.session?.purchases : undefined; }
  get gifts(): readonly PlayerGift[] { return this.authenticated ? this.session?.gifts ?? NO_GIFTS : NO_GIFTS; }

  private receiveGifts(next: Snapshot) {
    if (!this.session || next.customer.id !== this.session.customer.id) return;
    const acknowledged = this.acknowledgedGifts.get(next.customer.id);
    this.session.gifts = next.gifts.filter(gift => !acknowledged?.has(gift.id));
  }

  async acknowledgeGifts(ids: string[]): Promise<void> {
    const session = this.session, revision = this.authRevision;
    if (!session || !this.authenticated) throw new Error('Keine aktive Kontositzung');
    const pending = [...new Set(ids)].filter(id => session.gifts.some(gift => gift.id === id)).slice(0, 20);
    if (!pending.length) return;
    const response = await this.transport.request('POST', { acknowledgedGiftIds: pending, csrfToken: session.csrfToken });
    if (revision !== this.authRevision || session !== this.session) return;
    if (response.status === 401) this.invalidateSession();
    const confirmed = record(response.data) ? response.data.acknowledgedGiftIds : null;
    if (response.status !== 200 || !record(response.data) || !Array.isArray(confirmed)
      || !pending.every(id => confirmed.includes(id)))
      throw new Error('Geschenkbestätigung nicht gespeichert');
    const acknowledged = this.acknowledgedGifts.get(session.customer.id) ?? new Set<string>();
    pending.forEach(id => acknowledged.add(id));
    this.acknowledgedGifts.set(session.customer.id, acknowledged);
    session.gifts = readPlayerGifts(response.data.gifts).filter(gift => !acknowledged.has(gift.id));
    for (const listener of this.listeners) listener();
  }

  getAccess = (): PlayerAccess => this.access;
  subscribeSync = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private setAccess(value: PlayerAccess) {
    const count = Math.max(value.completedRuns, this.localCompletedRuns);
    const next = value.reason === 'trial' ? trialAccess(count) : { ...value, completedRuns: count };
    if (next.allowed === this.access.allowed && next.reason === this.access.reason && next.completedRuns === this.access.completedRuns) return;
    this.access = next;
    for (const listener of this.listeners) listener();
  }
  private status(state: PlayerSyncStatus['state'], message: string) {
    if (this.guestMode && this.guest.warning) { state = 'offline'; message = this.guest.warning; }
    this.syncStatus = { state, message };
    this.warning = ['offline', 'conflict', 'unavailable'].includes(state) ? message : this.guest.warning;
    for (const listener of this.listeners) listener();
  }
  private cancelPending() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = null;
  }
  private deny(access: PlayerAccess, message = accessMessage(access)) {
    this.cancelPending();
    // A refusal stops uploads, but never erases unsent runs or recovery data.
    if ((access.reason === 'unsubscribed' || this.blocked) && this.read(offlineAccountKey)) this.store(offlineAccountKey, '');
    this.setAccess(access);
    this.status(this.blocked ? 'conflict' : 'unavailable', message);
  }
  /** A retained save snapshot is not proof that the server session is still valid. */
  invalidateSession(): void {
    this.authenticated = false;
    this.authRevision++;
    this.guestMode = true;
    this.cancelPending();
    this.store(offlineAccountKey, '');
    this.setAccess(unavailableAccess(this.localCompletedRuns));
    this.status('unavailable', 'Deine Spielsitzung ist abgelaufen. Bitte erneut anmelden. Dein Kontospielstand bleibt gesichert.');
    // Account recovery stays in its own slot. Never show or save that equipment
    // as a guest, even when a protected request rejects identity mid-session.
    void this.useLocalGuest();
  }
  /** Keep the five-ride guest trial usable while Oxygen is being configured.
   * No account save is claimed here; a later successful login/bootstrap can
   * switch this repository to the server-backed session. */
  private async useLocalGuest(): Promise<Player> {
    const revision = this.authRevision;
    const local = this.guestPlayer ?? guestInventory(await (this.guestLoading ??= this.guest.load()), catalog as Product[]);
    if (revision !== this.authRevision || this.authenticated) return local;
    this.guestPlayer = local;
    this.guestMode = true;
    this.localCompletedRuns = local.runsPlayed;
    const access = this.guest.getAccess?.() ?? trialAccess(local.runsPlayed);
    this.setAccess(access);
    this.status(access.allowed ? 'guest' : 'unavailable', access.allowed
      ? 'Gastspielstand auf diesem Gerät. Fünf Gratisfahrten ohne Anmeldung.' : accessMessage(access));
    return local;
  }
  private store(key: string, value: string): boolean {
    try { this.storage.setItem(key, value); return true; }
    catch { this.backupWritable = false; return false; }
  }
  private read(key: string): string | null {
    try { return this.storage.getItem(key); }
    catch { this.backupWritable = false; return null; }
  }
  private accountKey() { return `pfusch:player:v1:shopify:${this.session!.customer.id}`; }
  private rememberOfflineAccount() {
    if (this.session && this.authenticated && this.session.storage.allowed)
      this.store(offlineAccountKey, JSON.stringify({ customerId: this.session.customer.id, storage: this.session.storage,
        // Display cache only. digitalPlayer strips these keys from every upload.
        items: this.session.purchases.items, history: this.session.purchases.history }));
  }
  private offlineStatus() {
    this.offline = true;
    this.cancelPending();
    if (!this.session || !this.authenticated || this.blocked) return;
    this.setAccess(this.session.storage);
    if (!this.access.allowed) { this.status('unavailable', accessMessage(this.access)); return; }
    this.status('offline', this.backupWritable
      ? 'Offline: Spielstand auf diesem Gerät gespeichert. Punkte und Coins werden bei Verbindung ins Konto übertragen.'
      : 'Offline: Änderungen bleiben nur in dieser Sitzung. Bitte Spielstand exportieren, bevor du das Spiel schliesst.');
  }
  /** This local identity is only an offline play context. Reconnection must
   * authenticate the same customer and check the server digest before uploading. */
  private restoreOfflineAccount(): Player | null {
    const raw = this.read(offlineAccountKey);
    if (!raw) return null;
    try {
      const saved: unknown = JSON.parse(raw);
      if (!record(saved) || typeof saved.customerId !== 'string' || !/^[1-9]\d{0,30}$/.test(saved.customerId)) return null;
      const access = serverAccess(saved.storage);
      if (!access.allowed) return null;
      const items = Array.isArray(saved.items) && saved.items.length <= 500 && saved.items.every(id => typeof id === 'string' && id.length <= 160)
        ? saved.items as string[] : [];
      this.session = { customer: { id: saved.customerId }, player: null, compareDigest: null, csrfToken: '', storage: access,
        gifts: [],
        purchases: { items, available: false, reason: 'orders_unavailable', history: saved.history === 'all' ? 'all' : 'recent' } };
      const accepted = this.readBackup(), pending = this.readBackup(`${this.accountKey()}:pending`);
      const backup = pending?.dirty ? pending : accepted;
      if (!backup) { this.session = null; return null; }
      this.session.player = backup.dirty && accepted && accepted.compareDigest === backup.compareDigest ? accepted.player : backup.player;
      this.session.compareDigest = backup.compareDigest;
      this.authenticated = true;
      this.guestMode = false;
      this.localCompletedRuns = Math.max(access.completedRuns, backup.player.runsPlayed);
      if (backup.dirty) {
        this.outbox = backup; this.lastUnsaved = backup.player; this.lastAttempt = backup.attempted ?? null;
      }
      this.offlineStatus();
      return backup.player;
    } catch { this.session = null; return null; }
  }
  private backup(player: Player) {
    this.store(this.accountKey(), JSON.stringify({ player, compareDigest: this.session!.compareDigest, dirty: false } satisfies Backup));
    this.rememberOfflineAccount();
  }
  private storeOutbox(player: Player) {
    this.outbox = { player, compareDigest: this.session!.compareDigest, dirty: true, ...(this.lastAttempt ? { attempted: this.lastAttempt } : {}) };
    this.store(`${this.accountKey()}:pending`, JSON.stringify(this.outbox));
  }
  private clearOutbox() {
    if (!this.outbox) return;
    // StorageDriver deliberately needs no remove capability; empty means absent.
    this.store(`${this.accountKey()}:pending`, '');
    this.outbox = null;
  }
  private recoveryMessage() {
    return this.outbox && this.backupWritable
      ? 'Änderungen lokal zur Wiederherstellung behalten; noch nicht im Konto gespeichert.'
      : 'Änderungen bleiben nur in dieser Sitzung; Status prüfen oder Spielstand exportieren.';
  }
  private readBackup(key = this.accountKey()): Backup | null {
    const raw = this.read(key);
    if (!raw) return null;
    try {
      const value: unknown = JSON.parse(raw);
      if (!record(value) || !digest(value.compareDigest) || typeof value.dirty !== 'boolean') throw new Error('Backup');
      const stored = record(value.player) ? value.player : {};
      const decodeBackup = (value: Record<string, unknown>) => digitalPlayer(this.decode(JSON.stringify({ ...value, irlItems: this.session!.purchases.items })), this.session!.customer.id);
      return { player: decodeBackup(stored), compareDigest: value.compareDigest, dirty: value.dirty,
        ...(record(value.attempted) ? { attempted: decodeBackup(value.attempted) } : {}) };
    } catch { this.store(`${key}:recovery`, raw); return null; }
  }

  async load(): Promise<Player> {
    const initial = await (this.initial ??= this.bootstrap());
    // Bootstrap is shared by auth and startup only. Focus/ride rechecks must
    // retain edits made since then, including changes still awaiting the server.
    if (this.guestMode) return this.guestPlayer ?? this.useLocalGuest();
    return this.session && this.authenticated
      ? { ...(this.lastUnsaved ?? this.session.player ?? initial), irlItems: this.session.purchases.items }
      : this.guestPlayer ?? initial;
  }
  async getUser() {
    await this.load();
    return this.session && this.authenticated ? { id: this.session.customer.id, kind: 'customer' as const } : { id: 'guest-local', kind: 'guest' as const };
  }
  /** Adopt a server-authenticated customer after this page initially loaded as a guest. */
  private async adoptSession(next: Snapshot): Promise<Player> {
    this.session = next;
    this.receiveGifts(next);
    this.authenticated = true;
    this.offline = false;
    this.guestMode = false;
    this.localCompletedRuns = next.storage.completedRuns;
    this.setAccess(next.storage);
    if (!next.storage.allowed && this.read(offlineAccountKey)) this.store(offlineAccountKey, '');
    this.rememberOfflineAccount();
    if (!this.access.allowed) {
      this.deny(this.access);
      return next.player ?? digitalPlayer(newPlayer(), next.customer.id);
    }
    const accepted = this.readBackup();
    // Recovery is considered only after fresh consent and within this account.
    // An outbox never grants ownership, permission, or authority over newer CAS.
    const pending = this.readBackup(`${this.accountKey()}:pending`);
    const backup = pending?.dirty ? pending : accepted;
    if (pending?.dirty && accepted && !accepted.dirty && pending.compareDigest === accepted.compareDigest && next.player
      && !sameDigitalProgress(next.player, pending.player) && !(pending.attempted && sameDigitalProgress(next.player, pending.attempted))) {
      const credit = serverCredit(accepted.player, next.player);
      if (credit && next.compareDigest !== pending.compareDigest) {
        this.backup(next.player);
        const recovered = addServerCredit(pending.player, credit);
        this.lastAttempt = null; this.save(recovered);
        return recovered;
      }
    }
    if (backup?.dirty && next.player && sameDigitalProgress(next.player, backup.player)) {
      this.outbox = backup; this.clearOutbox(); this.lastUnsaved = null; this.lastAttempt = null;
      this.backup(next.player); this.status('synced', 'Offline-Spielstand ist bereits im Konto gespeichert.');
      return next.player;
    }
    if (backup?.dirty && (backup.compareDigest === next.compareDigest ||
        next.player && backup.attempted && sameDigitalProgress(next.player, backup.attempted))) {
      this.lastAttempt = null;
      this.save(backup.player);
      return backup.player;
    }
    if (backup?.dirty) {
      const archived = this.store(`${this.accountKey()}:conflict`, JSON.stringify(backup));
      // Preserve the candidate before retiring it from automatic recovery.
      // Otherwise every reload would rediscover the same CAS conflict forever.
      if (archived && pending?.dirty) this.store(`${this.accountKey()}:pending`, '');
      this.recoveryPlayer = backup.player;
      this.blocked = true;
      this.store(offlineAccountKey, '');
      this.setAccess(unavailableAccess(this.localCompletedRuns));
      this.status('conflict', 'Konto und lokale Sicherung unterscheiden sich. Kontostand geladen; lokale Sicherung behalten. Bitte Spielstand exportieren und neu laden.');
      return next.player ?? backup.player;
    }
    if (next.player) {
      this.backup(next.player);
      this.status('synced', this.backupWritable ? 'Im Kundenkonto gespeichert.' : 'Im Kundenkonto gespeichert; lokale Sicherung nicht verfügbar.');
      return next.player;
    }
    // Import the local guest snapshot once, exactly as during a normal account bootstrap.
    let player = newPlayer();
    if (!this.read(importedGuestKey) && this.backupWritable) {
      const guestRaw = this.read(guestKey);
      if (guestRaw) {
        try {
          const candidate = this.decode(guestRaw);
          if (this.store(`${guestKey}:before-account`, guestRaw) && this.store(importedGuestKey, this.session.customer.id)) player = candidate;
        } catch { /* Preserve the existing guest save. */ }
      }
    }
    // Guest progress cannot bring referral authority into a new account.
    player = digitalPlayer({ ...player, guardianBells: { earned: 0, spent: 0, spentRunIds: [] } }, this.session.customer.id);
    this.save(player);
    return player;
  }
  private async bootstrap(): Promise<Player> {
    let response: CloudResponse;
    if (!this.isOnline()) return this.restoreOfflineAccount() ?? this.useLocalGuest();
    try { response = await this.transport.request('GET'); }
    catch { return this.restoreOfflineAccount() ?? this.useLocalGuest(); }
    if (response.status !== 200) {
      if (response.status === 401) {
        this.store(offlineAccountKey, '');
        return this.useLocalGuest();
      }
      return transientStatus(response.status) ? this.restoreOfflineAccount() ?? this.useLocalGuest() : this.useLocalGuest();
    }
    let next: Snapshot;
    try { next = snapshot(response.data, this.decode); }
    catch {
      const local = await this.guest.load();
      this.deny(unavailableAccess(local.runsPlayed), 'Konto-Freigabe konnte nicht sicher geladen werden. Status erneut prüfen.');
      return local;
    }
    return this.adoptSession(next);
  }

  save(player: Player): void {
    if (this.guestMode || !this.session) {
      if (!this.guestMode || !this.access.allowed || player.id !== 'guest-local') return;
      this.guest.save(player);
      this.guestPlayer = player;
      this.setAccess(this.guest.getAccess?.() ?? trialAccess(player.runsPlayed));
      if (this.guest.warning) this.status('offline', this.guest.warning);
      else if (!this.access.allowed) this.status('unavailable', accessMessage(this.access));
      return;
    }
    if (!this.authenticated) return;
    const copy = digitalPlayer(this.decode(JSON.stringify(player)), this.session.customer.id);
    this.lastUnsaved = copy;
    const mayQueue = this.access.allowed && !this.blocked
      && (this.session.storage.reason === 'subscribed' || copy.runsPlayed <= 5);
    this.localCompletedRuns = Math.max(this.localCompletedRuns, Math.floor(copy.runsPlayed));
    if (this.access.allowed || this.access.reason === 'newsletter_required' && this.session.storage.reason === 'trial')
      this.setAccess(this.session.storage);
    if (!mayQueue) {
      if (!this.blocked) this.status('unavailable', accessMessage(this.access));
      return;
    }
    this.queue(copy);
  }
  private queue(player: Player) {
    this.pending = player;
    this.storeOutbox(player);
    if (this.timer) clearTimeout(this.timer);
    if (this.offline || !this.isOnline()) { this.offlineStatus(); return; }
    this.status('saving', 'Spielstand und Newsletter-Freigabe werden im Shop geprüft …');
    this.timer = setTimeout(() => { void this.flush(); }, this.debounceMs);
  }

  /** Flush the fifth completed trial before checking permission for another ride. */
  async flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    if (this.session && (this.offline || !this.isOnline())) { this.offlineStatus(); return; }
    if (this.inFlight) { await this.inFlight; return this.flush(); }
    while (this.session && this.pending && !this.blocked) {
      const player = this.pending;
      this.pending = null;
      this.inFlight = this.write(player);
      await this.inFlight;
      this.inFlight = null;
    }
  }
  private newsletterDenial(response: CloudResponse): boolean {
    if (response.status !== 403 || !record(response.data)
      || !['newsletter_required', 'newsletter_unsubscribed'].includes(String(response.data.error))) return false;
    const access = serverAccess(response.data.storage);
    if (access.allowed) throw new Error('Ungültige Newsletter-Sperre');
    if (this.session) this.session.storage = access;
    this.deny(access);
    return true;
  }
  private adoptServerCredit(next: Snapshot): boolean {
    if (this.blocked || !this.session || !next.player || !this.session.player || next.customer.id !== this.session.customer.id
      || next.compareDigest === this.session.compareDigest || !next.storage.allowed) return false;
    if (this.lastAttempt && sameDigitalProgress(next.player, this.lastAttempt)) return false;
    const credit = serverCredit(this.session.player, next.player);
    if (!credit) return false;
    this.session.compareDigest = next.compareDigest;
    this.session.player = next.player;
    this.session.storage = next.storage;
    this.session.csrfToken = next.csrfToken;
    this.session.purchases = next.purchases;
    this.receiveGifts(next);
    if (this.lastUnsaved) this.lastUnsaved = addServerCredit(this.lastUnsaved, credit);
    if (this.pending) this.pending = this.lastUnsaved ?? addServerCredit(this.pending, credit);
    this.lastAttempt = null;
    if (this.outbox) this.storeOutbox(this.lastUnsaved ?? addServerCredit(this.outbox.player, credit));
    this.backup(next.player);
    return true;
  }
  private async write(player: Player, creditRetried = false): Promise<void> {
    const session = this.session!;
    const authRevision = this.authRevision;
    this.lastAttempt = player;
    if (this.outbox) this.storeOutbox(this.outbox.player);
    let networkFailure = true;
    try {
      let response = await this.transport.request('POST', { player, compareDigest: session.compareDigest, csrfToken: session.csrfToken });
      if (authRevision !== this.authRevision || session !== this.session) return;
      if (transientStatus(response.status)) throw new Error('Shop nicht erreichbar');
      networkFailure = false;
      if (this.newsletterDenial(response)) return;
      if (response.status === 403 && record(response.data) && response.data.error === 'csrf') {
        networkFailure = true;
        const refresh = await this.transport.request('GET');
        if (authRevision !== this.authRevision || session !== this.session) return;
        if (refresh.status !== 200) {
          if (refresh.status === 401) this.invalidateSession();
          else if (transientStatus(refresh.status)) this.offlineStatus();
          else this.deny(unavailableAccess(this.localCompletedRuns), `Shop-Anmeldung prüfen. ${this.recoveryMessage()}`);
          return;
        }
        networkFailure = false;
        if (authRevision !== this.authRevision) return;
        const next = snapshot(refresh.data, this.decode);
        if (next.customer.id !== session.customer.id || next.compareDigest !== session.compareDigest) {
          if (next.customer.id !== session.customer.id) { this.invalidateSession(); await this.useLocalGuest(); return; }
          if (!creditRetried && this.adoptServerCredit(next)) {
            const rebased = this.lastUnsaved!;
            this.pending = null;
            await this.write(rebased, true);
            return;
          }
          this.blocked = true;
          this.setAccess(unavailableAccess(this.localCompletedRuns));
          this.status('conflict', 'Konto oder Kontostand geändert. Vorhandene Sicherung behalten; bitte neu laden.');
          return;
        }
        session.csrfToken = next.csrfToken;
        session.storage = next.storage;
        this.receiveGifts(next);
        if (!next.storage.allowed) { this.deny(next.storage); return; }
        networkFailure = true;
        response = await this.transport.request('POST', { player, compareDigest: session.compareDigest, csrfToken: session.csrfToken });
        if (authRevision !== this.authRevision || session !== this.session) return;
        if (transientStatus(response.status)) throw new Error('Shop nicht erreichbar');
        networkFailure = false;
        if (this.newsletterDenial(response)) return;
      }
      if (response.status === 409) {
        if (!creditRetried) {
          networkFailure = true;
          const refresh = await this.transport.request('GET');
          if (authRevision !== this.authRevision || session !== this.session) return;
          if (transientStatus(refresh.status)) throw new Error('Shop nicht erreichbar');
          networkFailure = false;
          if (refresh.status === 401) { this.invalidateSession(); return; }
          if (authRevision !== this.authRevision) return;
          if (refresh.status === 200 && this.adoptServerCredit(snapshot(refresh.data, this.decode))) {
            const rebased = this.lastUnsaved!;
            this.pending = null;
            await this.write(rebased, true);
            return;
          }
        }
        this.blocked = true;
        this.store(offlineAccountKey, '');
        this.setAccess(unavailableAccess(this.localCompletedRuns));
        this.status('conflict', `Auf einem anderen Gerät wurde gespeichert. ${this.recoveryMessage()} Bitte exportieren und neu laden.`);
        return;
      }
      if (response.status === 401) { this.invalidateSession(); return; }
      if (response.status === 403) {
        this.deny(unavailableAccess(this.localCompletedRuns), 'Shop-Anmeldung hat sich geändert. Bitte neu laden.');
        return;
      }
      if (response.status !== 200) throw new Error('Speichern fehlgeschlagen');
      const result = snapshot(response.data, this.decode);
      if (result.customer.id !== session.customer.id || !result.player) throw new Error('Konto hat sich geändert');
      session.compareDigest = result.compareDigest;
      session.csrfToken = result.csrfToken;
      session.player = result.player;
      session.storage = result.storage;
      session.purchases = result.purchases;
      this.receiveGifts(result);
      this.lastAttempt = null;
      // Persist only the exact snapshot the server just accepted. This includes
      // the fifth trial result, never later queued edits or a denied POST.
      this.backup(result.player);
      // An older acknowledgement must not delete a newer queued edit. Rebase
      // that edit onto the server's accepted digest for recovery after reload.
      if (this.outbox?.player === player) this.clearOutbox();
      else if (this.outbox) this.storeOutbox(this.outbox.player);
      if (this.lastUnsaved === player) this.lastUnsaved = null;
      // A concurrent protected request may already have rejected this session.
      // Keep an acknowledged save, but do not revive its stale login or access.
      if (authRevision !== this.authRevision) return;
      this.localCompletedRuns = Math.max(this.localCompletedRuns, result.storage.completedRuns);
      this.authenticated = true;
      this.offline = false;
      this.rememberOfflineAccount();
      this.setAccess(result.storage);
      if (!result.storage.allowed) { this.deny(result.storage); return; }
      if (!this.pending) this.status('synced', this.backupWritable ? 'Im Kundenkonto gespeichert.' : 'Im Kundenkonto gespeichert; lokale Sicherung nicht verfügbar.');
    } catch {
      if (authRevision !== this.authRevision || session !== this.session) return;
      if (networkFailure) this.offlineStatus();
      else this.deny(unavailableAccess(this.localCompletedRuns), `Kontodaten konnten nicht sicher bestätigt werden. ${this.recoveryMessage()}`);
    }
  }

  refreshAccess(): Promise<PlayerAccess> {
    return this.refreshing ??= this.checkAccess().finally(() => { this.refreshing = null; });
  }
  private async checkAccess(rechecks = 0): Promise<PlayerAccess> {
    await this.load();
    await this.flush();
    if (!this.isOnline()) { this.offlineStatus(); return this.access; }
    const authRevision = this.authRevision;
    let receivedResponse = false;
    try {
      const requestedDigest = this.session?.compareDigest;
      const response = await this.transport.request('GET');
      receivedResponse = true;
      if (authRevision !== this.authRevision) return this.access;
      if (response.status === 401 && !this.session) {
        await this.useLocalGuest();
        return this.access;
      }
      if (response.status !== 200) {
        if (!this.session) return this.useLocalGuest().then(() => this.access);
        if (response.status === 401) { this.invalidateSession(); await this.useLocalGuest(); }
        else if (transientStatus(response.status)) this.offlineStatus();
        else this.deny(unavailableAccess(this.localCompletedRuns), 'Shop-Freigabe nicht erreichbar. Status erneut prüfen.');
        return this.access;
      }
      if (authRevision !== this.authRevision) return this.access;
      const next = snapshot(response.data, this.decode);
      if (!this.session) {
        const player = await this.adoptSession(next);
        this.initial = Promise.resolve(player);
        return this.access;
      }
      if (next.customer.id !== this.session.customer.id) {
        this.invalidateSession();
        await this.useLocalGuest();
        return this.access;
      }
      if (!this.authenticated) this.localCompletedRuns = Math.max(next.storage.completedRuns, this.lastUnsaved?.runsPlayed ?? 0);
      this.authenticated = true;
      this.guestMode = false;
      this.offline = false;
      // A save can finish while this GET is in flight. Its old digest is no
      // evidence of another device changing progress; check the current base.
      if (requestedDigest !== this.session.compareDigest) return rechecks < 1 ? this.checkAccess(rechecks + 1) : this.access;
      this.adoptServerCredit(next);
      // With no local edits, a newer server snapshot (another device or a
      // referral payout) is safe to adopt. Dirty progress still requires CAS.
      if (!this.blocked && !this.lastUnsaved && !this.outbox && next.compareDigest !== this.session.compareDigest) {
        this.session.compareDigest = next.compareDigest;
        this.session.player = next.player;
        if (next.player) this.backup(next.player);
      }
      if (!this.blocked && next.compareDigest !== this.session.compareDigest && next.player &&
          ((this.lastUnsaved && sameDigitalProgress(next.player, this.lastUnsaved)) ||
           (this.lastAttempt && sameDigitalProgress(next.player, this.lastAttempt)))) {
        // The previous POST reached Shopify but its response was lost. Rebase
        // only when the server exactly acknowledges a snapshot we sent.
        this.session.compareDigest = next.compareDigest;
        this.session.player = next.player;
        this.lastAttempt = null;
        if (this.lastUnsaved && sameDigitalProgress(next.player, this.lastUnsaved)) {
          this.lastUnsaved = null; this.clearOutbox();
        } else if (this.outbox) this.storeOutbox(this.outbox.player);
        this.backup(next.player);
      }
      if (next.compareDigest !== this.session.compareDigest || this.blocked) {
        this.blocked = true;
        this.deny(unavailableAccess(this.localCompletedRuns), 'Kontostand hat sich geändert. Vor weiteren Fahrten bitte neu laden.');
        return this.access;
      }
      this.session.storage = next.storage;
      this.session.purchases = next.purchases;
      this.session.csrfToken = next.csrfToken;
      this.receiveGifts(next);
      this.rememberOfflineAccount();
      this.localCompletedRuns = Math.max(this.localCompletedRuns, next.storage.completedRuns);
      this.setAccess(next.storage);
      if (!next.storage.allowed) this.deny(next.storage);
      else if (this.lastUnsaved && (next.storage.reason === 'subscribed' || this.lastUnsaved.runsPlayed <= 5)) {
        this.queue(this.lastUnsaved);
        await this.flush();
      } else if (!this.access.allowed) this.deny(this.access);
      else this.status('synced', 'Newsletter-Freigabe im Shop bestätigt.');
      return this.access;
    } catch {
      if (authRevision !== this.authRevision) return this.access;
      if (!this.session) return this.useLocalGuest().then(() => this.access);
      if (receivedResponse) this.deny(unavailableAccess(this.localCompletedRuns), 'Kontodaten konnten nicht sicher bestätigt werden. Bitte erneut prüfen.');
      else this.offlineStatus();
      return this.access;
    }
  }
  export(player: Player): string { return JSON.stringify(this.guestMode ? player : this.recoveryPlayer ?? player, null, 2); }
}
