import { useRef, useState } from 'react';
import { Check, Save, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import type { Player, Product } from '../domain/types';
import type { Services } from '../services';
import { accessMessage } from '../services/playerAccess';
import { BIKES } from '../domain/config';
import { HELMETS } from '../domain/helmet';
import { applySetup, deleteSetup, MAX_SAVED_SETUPS, saveSetup, SETUP_NAME_MAX_LENGTH } from '../domain/setups';
import './saved-setups.css';

interface Props {
  player: Player;
  products: Product[];
  previewing: boolean;
  services: Services;
  update(player: Player): void;
  onEquip(): void;
  notify(message: string): void;
}

export default function SavedSetups({ player, products, previewing, services, update, onEquip, notify }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const pending = useRef(false);
  const setups = player.savedSetups;

  async function persist(next: Player, action: string, beforeUpdate?: () => void) {
    if (pending.current) return false;
    pending.current = true;
    setBusy(true);
    setMessage('Speicherzugang wird geprüft …');
    try {
      let access = services.players.getAccess?.();
      // A temporary shop failure must not leave an authenticated customer
      // permanently blocked by the cached access flag. Recheck before editing.
      if (access?.allowed === false) access = await services.players.refreshAccess?.() ?? access;
      if (access?.allowed === false) {
        setMessage(services.players.warning || accessMessage(access));
        return false;
      }
      setMessage('Wird gespeichert …');
      beforeUpdate?.();
      update(next);
      await services.players.flush?.();
      const state = services.players.syncStatus?.state;
      const saved = !state || state === 'local' || state === 'guest' || state === 'synced';
      const feedback = saved && !services.players.warning
        ? `${action} ${state === 'synced' ? 'Im Konto gespeichert.' : 'Auf diesem Gerät gespeichert.'}`
        : `Speicherung noch nicht bestätigt. ${services.players.warning || services.players.syncStatus?.message || 'Bitte erneut versuchen.'}`;
      setMessage(feedback);
      notify(feedback);
      return saved && !services.players.warning;
    } catch {
      setMessage('Speicherung nicht bestätigt. Bitte Verbindung prüfen und erneut speichern.');
      return false;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function saveCurrent() {
    if (previewing || pending.current) return;
    const next = saveSetup(player, name, crypto.randomUUID());
    if (!next) { setMessage(`Setup konnte nicht angelegt werden. Prüfe den Namen und deine ausgerüsteten Artikel; maximal ${MAX_SAVED_SETUPS} Setups.`); return; }
    if (await persist(next, 'Setup gespeichert.')) setName('');
  }

  return <>
    <button className="button setup-launch" aria-label="Setups speichern und verwalten" onClick={() => { setOpen(true); setMessage(''); setDeleting(null); }}>
      <Save size={17} aria-hidden="true" /> SETUP SPEICHERN
      <span>{setups.length} / {MAX_SAVED_SETUPS}</span>
    </button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="game-dialog saved-setups-dialog" initialFocus={heading}>
        <DialogTitle ref={heading} tabIndex={-1}>DEINE SETUPS</DialogTitle>
        <DialogDescription>Motorrad, Farben, Helm, Kleidung und Sticker als komplette Zusammenstellung speichern.</DialogDescription>
        <form className="setup-save-form" onSubmit={event => { event.preventDefault(); void saveCurrent(); }}>
          <label htmlFor="setup-name">AKTUELLES SETUP SPEICHERN</label>
          <div>
            <input id="setup-name" value={name} onChange={event => setName(event.target.value)} maxLength={SETUP_NAME_MAX_LENGTH}
              placeholder="z. B. Mein Street-Setup" autoComplete="off" disabled={busy} />
            <button className="button primary" type="submit" disabled={busy || previewing || !name.trim() || setups.length >= MAX_SAVED_SETUPS}>
              <Save size={16} aria-hidden="true" /> SPEICHERN
            </button>
          </div>
          <p>{previewing ? 'Vorschau aktiv: Rüste deine Auswahl zuerst aus oder kehre zum aktuellen Setup zurück.'
            : setups.length >= MAX_SAVED_SETUPS ? 'Alle Plätze belegt. Lösche ein Setup, um ein neues zu speichern.'
              : 'Speichert deine aktuell ausgerüstete Auswahl.'}</p>
        </form>
        <div className="saved-setup-list" aria-label="Gespeicherte Setups">
          {setups.length === 0 && <p className="setup-empty">Noch kein Setup gespeichert. Stelle deinen Look zusammen und gib ihm einen Namen.</p>}
          {setups.map(setup => {
            const appearance = setup.appearance;
            const bike = BIKES.find(value => value.id === appearance.bike)?.name ?? appearance.bike;
            const helmet = HELMETS.find(value => value.id === appearance.helmet)?.name ?? 'Helm';
            const clothing = products.find(value => value.id === appearance.equipped.upper)?.title ?? 'Standard-Outfit';
            return <article className="saved-setup-row" key={setup.id} aria-label={setup.name}>
              <div className="saved-setup-description">
                <strong>{setup.name}</strong>
                <p>{bike} · {helmet}</p><p>{clothing}</p>
                <span className="setup-colors" aria-label="Gespeicherte Farben">
                  <i style={{ backgroundColor: appearance.paint }} title="Motorradfarbe" />
                  <i style={{ backgroundColor: appearance.rims }} title="Felgenfarbe" />
                  <i style={{ backgroundColor: appearance.helmetColor }} title="Helmfarbe" />
                </span>
              </div>
              <div className="saved-setup-actions">
                <button className="button small" disabled={busy} aria-label={`${setup.name} ausrüsten`} onClick={() => {
                  const next = applySetup(player, setup.id, products);
                  if (!next) { setMessage('Dieses Setup enthält einen nicht verfügbaren Artikel.'); return; }
                  void persist(next, `${setup.name} ausgerüstet.`, onEquip);
                }}><Check size={15} aria-hidden="true" /> AUSRÜSTEN</button>
                {deleting === setup.id ? <div className="setup-delete-confirm">
                  <button disabled={busy} onClick={() => { setDeleting(null); void persist(deleteSetup(player, setup.id), 'Setup gelöscht.'); }}>LÖSCHEN BESTÄTIGEN</button>
                  <button disabled={busy} onClick={() => setDeleting(null)}>ABBRECHEN</button>
                </div> : <button className="setup-delete" disabled={busy} aria-label={`${setup.name} löschen`} onClick={() => setDeleting(setup.id)}><Trash2 size={15} aria-hidden="true" /> LÖSCHEN</button>}
              </div>
            </article>;
          })}
        </div>
        <output className="setup-message" aria-live="polite">{message}</output>
      </DialogContent>
    </Dialog>
  </>;
}
