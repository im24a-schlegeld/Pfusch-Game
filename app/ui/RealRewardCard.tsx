import { useEffect, useState } from 'react';
import { Gift } from 'lucide-react';
import type { RealRewardStatus, VerifiedRewardsService } from '../services/verifiedRewards';
import { fmt } from './shared';
import './real-reward.css';

export default function RealRewardCard({ service }: { service?: VerifiedRewardsService }) {
  const [status, setStatus] = useState<RealRewardStatus | null>(null);
  const [loading, setLoading] = useState(!!service);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!service) return;
    let active = true;
    setLoading(true);
    void service.status().then(value => {
      if (active) { setStatus(value); setMessage(''); }
    }).catch(() => {
      if (active) setMessage('Melde dich über Konto an. Falls du schon angemeldet bist, prüfe die Verbindung und versuche es erneut.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [service, revision]);
  const reward = status?.reward;
  const expired = reward ? Date.parse(reward.expiresAt) <= Date.now() : false;
  async function claim() {
    if (!service || busy || !status?.available || !(status.eligible || status.pending)) return;
    setBusy(true); setMessage('');
    try { setStatus(await service.claim()); }
    catch { setMessage('Der Code konnte noch nicht bestätigt werden. Bitte erneut versuchen; dein Anspruch bleibt erhalten.'); }
    finally { setBusy(false); }
  }
  async function copyCode() {
    if (!reward) return;
    try { await navigator.clipboard.writeText(reward.code); setMessage('Code kopiert.'); }
    catch { setMessage('Bitte markiere und kopiere den angezeigten Code.'); }
  }
  return <section className="real-reward" aria-labelledby="real-reward-title">
    <div className="real-reward-heading"><Gift aria-hidden="true" size={23} /><div><span className="eyebrow">PFUSCH-SHOP</span>
      <h2 id="real-reward-title">{status?.available || reward ? 'CHF 5 Rabatt' : 'Shop-Belohnung'}</h2></div></div>
    {loading ? <output>Kontofortschritt wird geprüft …</output> : status?.available || reward ? <>
      <p>CHF 5 Rabatt ab CHF 50 Bestellwert. Einmal pro Konto; nach Ausstellung 30 Tage gültig.</p>
      {reward ? <div className="real-reward-code"><span>{expired ? 'Dein Code ist abgelaufen.' : `Gültig bis ${new Date(reward.expiresAt).toLocaleDateString('de-CH')}`}</span>
        <code>{reward.code}</code><button className="button small" disabled={expired} onClick={() => { void copyCode(); }}>CODE KOPIEREN</button></div> : <>
        <label className="real-reward-progress">Bestätigte Punkte <strong>{fmt(status!.verifiedPoints)} / {fmt(status!.pointsRequired)}</strong>
          <progress max={status!.pointsRequired} value={Math.min(status!.verifiedPoints, status!.pointsRequired)} /></label>
        <p>{status!.verifiedRuns} / {status!.runsRequired} bestätigte Fahrten · Heute {fmt(status!.dailyPoints)} / {fmt(status!.dailyCap)} Punkte</p>
        <p className="real-reward-help">Es zählen neue, vom Spielserver bestätigte Fahrten ab 20 Sekunden. Mindestens 10 Fahrten und 50’000 Punkte; höchstens 10’000 Punkte pro UTC-Tag. Lokale Coins und bisherige XP zählen hier nicht.</p>
        {status!.pending && <p>Dein Code ist reserviert. Die Bestätigung steht noch aus.</p>}
        <button className="button" disabled={busy || !(status!.eligible || status!.pending)} onClick={() => { void claim(); }}>{busy ? 'CODE WIRD BESTÄTIGT …' : status!.pending ? 'CODE BESTÄTIGEN' : status!.eligible ? 'CODE ABHOLEN' : 'NOCH NICHT FREIGESCHALTET'}</button>
      </>}
    </> : <p>Shop-Belohnungen sind noch nicht verfügbar. Spielbelohnungen kannst du weiterhin abholen.</p>}
    {message && <output>{message}</output>}
    {!loading && service && !status && <button className="button small" onClick={() => setRevision(value => value + 1)}>ERNEUT PRÜFEN</button>}
  </section>;
}
