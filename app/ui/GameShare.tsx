import { useState } from 'react';
import { ArrowRight, Share2, UserPlus } from 'lucide-react';
import { sharePeriodLabel, type GameShare } from '../domain/gameShare';
import { openShareDraft, shareGame, type ShareTarget } from '../services/gameShare';
import { fmt } from './shared';
import './game-share.css';

export function ShareAction({ share, label, disabled = false }: { share: GameShare; label: string; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState('');
  const [choices, setChoices] = useState(false);
  async function openShare(target: ShareTarget) {
    if (busy || disabled) return;
    setBusy(true);
    setOutcome('');
    try {
      const result = await shareGame(share, target, { open: url => openShareDraft(url) });
      if (result === 'failed' || result === 'unavailable') {
        setOutcome('Nachrichtenentwurf konnte nicht geöffnet werden. Erlaube Pop-ups oder wähle eine andere App.');
      } else { setOutcome('Nachrichtenentwurf geöffnet. Sende die Einladung in der gewählten App.'); setChoices(false); }
    } finally { setBusy(false); }
  }
  return <div className="game-share-action">
    <button type="button" className="button small" disabled={busy || disabled} aria-expanded={choices} onClick={() => setChoices(value => !value)}>
      {share.kind === 'invite' ? <UserPlus size={17} aria-hidden="true" /> : <Share2 size={17} aria-hidden="true" />}{label}
    </button>
    {choices && <div className="game-share-choices" aria-label="App zum Teilen wählen">
      {(['whatsapp', 'telegram', 'email'] as const).map(target => <button type="button" className="button small" key={target}
        disabled={busy || disabled} onClick={() => { void openShare(target); }}>{target === 'whatsapp' ? 'WhatsApp' : target === 'telegram' ? 'Telegram' : 'E-Mail'}</button>)}
    </div>}
    <output aria-live="polite">{outcome}</output>
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
