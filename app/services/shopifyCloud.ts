import type { Player } from '../domain/types';
import { newPlayer } from '../domain/progression';
import { REWARDS } from '../domain/config';
import type { AuthService, PlayerRepository, PlayerSyncStatus, StorageDriver } from './index';
import type { CloudResponse, CloudTransport } from './shopifyBridge';
import { accessMessage, serverAccess, trialAccess, unavailableAccess, type PlayerAccess } from './playerAccess';

interface Snapshot {
  customer: { id: string };
  player: Player | null;
  compareDigest: string | null;
  csrfToken: string;
  storage: PlayerAccess;
}
interface Backup { player: Player; compareDigest: string | null; dirty: boolean }
type Decoder = (raw: string) => Player;
const guestKey = 'pfusch:player:v1';
const importedGuestKey = 'pfusch:player:v1:guest-imported';
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const digest = (value: unknown): value is string | null => value === null || (typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value));

/** Cloud saves grant digital progress only, never purchase/reward authority. */
export function digitalPlayer(player: Player, customerId: string): Player {
  return { ...player, id: `shopify:${customerId}`, irlItems: [], tickets: 0,
    redeemedRewards: player.redeemedRewards.filter(id => REWARDS.some(reward => reward.id === id && reward.kind !== 'future')) };
}
function snapshot(data: unknown, decode: Decoder): Snapshot {
  if (!record(data) || !record(data.customer) || typeof data.customer.id !== 'string' || !/^[1-9]\d{0,30}$/.test(data.customer.id)
    || !digest(data.compareDigest) || typeof data.csrfToken !== 'string' || data.csrfToken.length < 16 || data.csrfToken.length > 4096
    || (data.player === null) !== (data.compareDigest === null)) throw new Error('Ungültige Kontodaten');
  return { customer: { id: data.customer.id }, player: data.player === null ? null : digitalPlayer(decode(JSON.stringify(data.player)), data.customer.id),
    compareDigest: data.compareDigest, csrfToken: data.csrfToken, storage: serverAccess(data.storage) };
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

  constructor(private transport: CloudTransport, private storage: StorageDriver,
    private guest: PlayerRepository, private decode: Decoder, private debounceMs = 900) {}

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
    if (!this.session && this.guest.warning) { state = 'offline'; message = this.guest.warning; }
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
    if (access.reason === 'unsubscribed' || access.reason === 'newsletter_required') this.clearOutbox();
    this.setAccess(access);
    this.status('unavailable', message);
  }
  /** A retained save snapshot is not proof that the server session is still valid. */
  invalidateSession(): void {
    this.authenticated = false;
    this.authRevision++;
    if (this.session) this.deny(unavailableAccess(this.localCompletedRuns),
      `Deine Spielsitzung ist abgelaufen. Bitte erneut anmelden.${this.lastUnsaved ? ` ${this.recoveryMessage()}` : ''}`);
  }
  /** Keep the five-ride guest trial usable while Oxygen is being configured.
   * No account save is claimed here; a later successful login/bootstrap can
   * switch this repository to the server-backed session. */
  private async useLocalGuest(): Promise<Player> {
    const local = this.guestPlayer ?? await this.guest.load();
    this.guestMode = true;
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
  private backup(player: Player) {
    this.store(this.accountKey(), JSON.stringify({ player, compareDigest: this.session!.compareDigest, dirty: false } satisfies Backup));
  }
  private storeOutbox(player: Player) {
    this.outbox = { player, compareDigest: this.session!.compareDigest, dirty: true };
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
      return { player: digitalPlayer(this.decode(JSON.stringify(value.player)), this.session!.customer.id), compareDigest: value.compareDigest, dirty: value.dirty };
    } catch { this.store(`${key}:recovery`, raw); return null; }
  }

  async load(): Promise<Player> {
    const initial = await (this.initial ??= this.bootstrap());
    // Bootstrap is shared by auth and startup only. Focus/ride rechecks must
    // retain edits made since then, including changes still awaiting the server.
    return this.session
      ? this.lastUnsaved ?? this.session.player ?? initial
      : this.guestPlayer ?? initial;
  }
  async getUser() {
    await this.load();
    return this.session && this.authenticated ? { id: this.session.customer.id, kind: 'customer' as const } : { id: 'guest-local', kind: 'guest' as const };
  }
  /** Adopt a server-authenticated customer after this page initially loaded as a guest. */
  private async adoptSession(next: Snapshot): Promise<Player> {
    this.session = next;
    this.authenticated = true;
    this.guestMode = false;
    this.guestPlayer = null;
    this.localCompletedRuns = next.storage.completedRuns;
    this.setAccess(next.storage);
    if (!this.access.allowed) {
      this.deny(this.access);
      return next.player ?? digitalPlayer(newPlayer(), next.customer.id);
    }
    const accepted = this.readBackup();
    // Recovery is considered only after fresh consent and within this account.
    // An outbox never grants ownership, permission, or authority over newer CAS.
    const pending = this.readBackup(`${this.accountKey()}:pending`);
    const backup = pending?.dirty ? pending : accepted;
    if (backup?.dirty && backup.compareDigest === next.compareDigest) {
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
    player = digitalPlayer(player, this.session.customer.id);
    this.save(player);
    return player;
  }
  private async bootstrap(): Promise<Player> {
    let response: CloudResponse;
    try { response = await this.transport.request('GET'); }
    catch { return this.useLocalGuest(); }
    if (response.status !== 200) {
      if (response.status === 401) {
        const local = await this.guest.load();
        this.guestMode = true;
        this.setAccess(this.guest.getAccess?.() ?? trialAccess(local.runsPlayed));
        this.status(this.access.allowed ? 'guest' : 'unavailable', this.access.allowed
          ? 'Gastspielstand auf diesem Gerät. Fünf Gratisfahrten ohne Newsletter.' : accessMessage(this.access));
        return local;
      }
      return this.useLocalGuest();
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
    if (!this.session) {
      if (!this.guestMode || !this.access.allowed) return;
      this.guest.save(player);
      this.guestPlayer = player;
      this.setAccess(this.guest.getAccess?.() ?? trialAccess(player.runsPlayed));
      if (this.guest.warning) this.status('offline', this.guest.warning);
      else if (!this.access.allowed) this.status('unavailable', accessMessage(this.access));
      return;
    }
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
    this.status('saving', 'Spielstand und Newsletter-Freigabe werden im Shop geprüft …');
    this.timer = setTimeout(() => { void this.flush(); }, this.debounceMs);
  }

  /** Flush the fifth completed trial before checking permission for another ride. */
  async flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
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
  private async write(player: Player): Promise<void> {
    const session = this.session!;
    const authRevision = this.authRevision;
    try {
      let response = await this.transport.request('POST', { player, compareDigest: session.compareDigest, csrfToken: session.csrfToken });
      if (this.newsletterDenial(response)) return;
      if (response.status === 403 && record(response.data) && response.data.error === 'csrf') {
        const refresh = await this.transport.request('GET');
        if (refresh.status !== 200) {
          if (refresh.status === 401) this.invalidateSession();
          else this.deny(unavailableAccess(this.localCompletedRuns), `Shop-Anmeldung prüfen. ${this.recoveryMessage()}`);
          return;
        }
        if (authRevision !== this.authRevision) return;
        const next = snapshot(refresh.data, this.decode);
        if (next.customer.id !== session.customer.id || next.compareDigest !== session.compareDigest) {
          if (next.customer.id !== session.customer.id) this.authenticated = false;
          this.blocked = true;
          this.setAccess(unavailableAccess(this.localCompletedRuns));
          this.status('conflict', 'Konto oder Kontostand geändert. Vorhandene Sicherung behalten; bitte neu laden.');
          return;
        }
        session.csrfToken = next.csrfToken;
        session.storage = next.storage;
        if (!next.storage.allowed) { this.deny(next.storage); return; }
        response = await this.transport.request('POST', { player, compareDigest: session.compareDigest, csrfToken: session.csrfToken });
        if (this.newsletterDenial(response)) return;
      }
      if (response.status === 409) {
        this.blocked = true;
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
      this.localCompletedRuns = Math.max(this.localCompletedRuns, result.storage.completedRuns);
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
      this.authenticated = true;
      this.setAccess(result.storage);
      if (!result.storage.allowed) { this.deny(result.storage); return; }
      if (!this.pending) this.status('synced', this.backupWritable ? 'Im Kundenkonto gespeichert.' : 'Im Kundenkonto gespeichert; lokale Sicherung nicht verfügbar.');
    } catch {
      this.cancelPending();
      this.setAccess(unavailableAccess(this.localCompletedRuns));
      this.status('offline', `Shop-Freigabe nicht bestätigt. ${this.recoveryMessage()}`);
    }
  }

  refreshAccess(): Promise<PlayerAccess> {
    return this.refreshing ??= this.checkAccess().finally(() => { this.refreshing = null; });
  }
  private async checkAccess(): Promise<PlayerAccess> {
    await this.load();
    await this.flush();
    try {
      const authRevision = this.authRevision;
      const requestedDigest = this.session?.compareDigest;
      const response = await this.transport.request('GET');
      if (response.status === 401 && !this.session) {
        this.guestMode = true;
        this.setAccess(await this.guest.refreshAccess?.() ?? trialAccess((await this.guest.load()).runsPlayed));
        this.status(this.access.allowed ? 'guest' : 'unavailable', this.access.allowed
          ? 'Gastspielstand auf diesem Gerät. Fünf Gratisfahrten ohne Newsletter.' : accessMessage(this.access));
        return this.access;
      }
      if (response.status !== 200) {
        if (!this.session) return this.useLocalGuest().then(() => this.access);
        if (response.status === 401) this.invalidateSession();
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
        this.authenticated = false;
        this.deny(unavailableAccess(this.localCompletedRuns), 'Shop-Anmeldung geändert. Bitte neu laden.');
        return this.access;
      }
      this.authenticated = true;
      // A save can finish while this GET is in flight. Its old digest is no
      // evidence of another device changing progress; check the current base.
      if (requestedDigest !== this.session.compareDigest) return this.checkAccess();
      if (next.compareDigest !== this.session.compareDigest || this.blocked) {
        this.blocked = true;
        this.deny(unavailableAccess(this.localCompletedRuns), 'Kontostand hat sich geändert. Vor weiteren Fahrten bitte neu laden.');
        return this.access;
      }
      this.session.storage = next.storage;
      this.session.csrfToken = next.csrfToken;
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
      if (!this.session) return this.useLocalGuest().then(() => this.access);
      this.deny(unavailableAccess(this.localCompletedRuns), 'Shop-Freigabe nicht erreichbar. Status erneut prüfen.');
      return this.access;
    }
  }
  export(player: Player): string { return JSON.stringify(this.recoveryPlayer ?? player, null, 2); }
}
