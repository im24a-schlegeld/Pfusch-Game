import { useState } from 'react';
import { ArrowRight, Share2, UserPlus } from 'lucide-react';
import { gameShareUrl, sharePeriodLabel, type GameShare } from '../domain/gameShare';
import { shareGame } from '../services/gameShare';
import { fmt } from './shared';
import './game-share.css';

export function ShareAction({ share, label, disabled = false }: { share: GameShare; label: string; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState('');
  const [manualUrl, setManualUrl] = useState('');
  async function openShare() {
    if (busy || disabled) return;
    setBusy(true);
    setOutcome('');
    setManualUrl('');
    try {
      const result = await shareGame(share, navigator);
      if (result === 'copied') setOutcome('Link kopiert. Füge ihn in deiner App oder Nachricht ein.');
      if (result === 'manual') setManualUrl(gameShareUrl(share));
    } finally { setBusy(false); }
  }
  return <div className="game-share-action">
    <button type="button" className="button small" disabled={busy || disabled} onClick={() => { void openShare(); }}>
      {share.kind === 'invite' ? <UserPlus size={17} aria-hidden="true" /> : <Share2 size={17} aria-hidden="true" />}{label}
    </button>
    <output aria-live="polite">{outcome}</output>
    {manualUrl && <label className="game-share-copy">Link markieren und kopieren
      <input type="text" readOnly value={manualUrl} aria-label="Link zum Teilen" onFocus={(event) => event.currentTarget.select()} />
    </label>}
  </div>;
}

export function SharedGame({ share, start, garage }: { share: GameShare; start: () => void; garage: () => void }) {
  return <main className="standard-page narrow shared-game-page">
    <p className="eyebrow">PFUSCH · WHEELIE ESCAPE</p>
    <h1>{share.kind === 'invite' ? 'FAHR MIT.' : 'SCHAFFST DU MEHR?'}</h1>
    <p>{share.name ? `${share.name} fordert dich heraus.` : 'Deine nächste Fahrt wartet.'}</p>
    {share.kind !== 'invite' && <section className="shared-game-score" aria-label="Geteiltes Ergebnis">
      {share.kind === 'rank' && <p>Platz <b>{share.rank}</b> · {sharePeriodLabel(share.period, share.date)}</p>}
      <strong>{fmt(share.score)}</strong><span>PUNKTE</span>
      <small>Geteilte {share.kind === 'rank' ? 'Platzierung' : 'Bestleistung'} vom {share.date.split('-').reverse().join('.')}.{share.kind === 'rank' ? ' Der Rang kann sich ändern.' : ''}</small>
    </section>}
    <p>Wheelies, Verkehr und knappe Manöver. Fahr los und setz deinen eigenen Bestwert.</p>
    <div className="game-share-actions">
      <button type="button" className="button primary" onClick={start}>FAHRT STARTEN <ArrowRight size={18} aria-hidden="true" /></button>
      <button type="button" className="button" onClick={garage}>ZUR GARAGE</button>
    </div>
  </main>;
}
