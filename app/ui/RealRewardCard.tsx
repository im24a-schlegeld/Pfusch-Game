import { useEffect, useState } from 'react';
import { Gift } from 'lucide-react';
import { VerifiedRewardsError, type RealRewardStatus, type VerifiedRewardsService } from '../services/verifiedRewards';
import { fmt } from './shared';
import './real-reward.css';

function rewardErrorMessage(error: unknown) {
  if (error instanceof VerifiedRewardsError) {
    if (error.status === 401) return 'Bitte melde dich im Spiel an, um deinen Rabattfortschritt zu sehen.';
    if (error.code === 'not_configured') return 'Shop-Rabatte sind auf dem Spielserver noch nicht eingerichtet. Bitte versuche es später erneut.';
    if (error.code === 'request_timeout') return 'Der Rabattdienst antwortet gerade zu langsam. Bitte versuche es erneut.';
    if (error.code === 'network_error') return 'Die Verbindung zum Rabattdienst ist unterbrochen. Prüfe deine Verbindung und versuche es erneut.';
    if (error.code === 'invalid_reward_response') return 'Der Rabattdienst hat eine ungültige Antwort gesendet. Bitte versuche es später erneut.';
    if (error.status === 429) return 'Zu viele Anfragen an den Rabattdienst. Bitte warte kurz und versuche es erneut.';
    if (error.status === 403) return 'Die Anfrage konnte nicht bestätigt werden. Bitte versuche es erneut.';
  }
  return 'Der Rabattdienst ist vorübergehend nicht erreichbar. Bitte versuche es später erneut.';
}

export default function RealRewardCard({ service, onSignIn }: { service?: VerifiedRewardsService; onSignIn?: () => void }) {
  const [status, setStatus] = useState<RealRewardStatus | null>(null);
  const [loading, setLoading] = useState(!!service);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [loginRequired, setLoginRequired] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!service) return;
    let active = true;
    setLoading(true);
    setMessage(''); setLoginRequired(false);
    void service.status().then(value => {
      if (active) { setStatus(value); setMessage(''); }
    }).catch((error: unknown) => {
      if (active) {
        setMessage(rewardErrorMessage(error));
        setLoginRequired(error instanceof VerifiedRewardsError && error.status === 401);
      }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [service, revision]);
  const reward = status?.reward;
  const expired = reward ? Date.parse(reward.expiresAt) <= Date.now() : false;
  async function claim() {
    if (!service || busy || !status?.available || !(status.eligible || status.pending)) return;
    setBusy(true); setMessage(''); setLoginRequired(false);
    try { setStatus(await service.claim()); }
    catch (error: unknown) {
      setMessage(`Der Code wurde noch nicht bestätigt. ${rewardErrorMessage(error)}`);
      setLoginRequired(error instanceof VerifiedRewardsError && error.status === 401);
    }
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
    </> : status || !service ? <p>{status?.reason === 'rewards_disabled' ? 'Shop-Rabatte sind derzeit deaktiviert.' : 'Shop-Belohnungen sind noch nicht verfügbar.'} Spielbelohnungen kannst du weiterhin abholen.</p> : null}
    {message && <output>{message}</output>}
    {loginRequired && onSignIn && <button className="button small" onClick={onSignIn}>IM SPIEL ANMELDEN</button>}
    {!loading && service && !status && <button className="button small" onClick={() => setRevision(value => value + 1)}>ERNEUT PRÜFEN</button>}
  </section>;
}
