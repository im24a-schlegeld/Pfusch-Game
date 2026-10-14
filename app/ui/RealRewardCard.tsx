import { useEffect, useRef, useState } from 'react';
import { Gift } from 'lucide-react';
import { VerifiedRewardsError, type RealRewardStatus, type VerifiedRewardsService } from '../services/verifiedRewards';
import { fmt } from './shared';
import './real-reward.css';

function rewardErrorMessage(error: unknown) {
  if (error instanceof VerifiedRewardsError) {
    if (error.status === 401) return 'Bitte melde dich im Spiel an, um deinen Rabattfortschritt zu sehen.';
    if (error.code === 'not_configured') return 'Shop-Rabatte sind noch nicht eingerichtet. Bitte versuche es später erneut.';
    if (error.code === 'request_timeout') return 'Der Rabattdienst antwortet gerade zu langsam. Bitte versuche es erneut.';
    if (error.code === 'network_error') return 'Die Verbindung zum Rabattdienst ist unterbrochen. Prüfe deine Verbindung und versuche es erneut.';
    if (error.code === 'invalid_reward_response') return 'Der Rabattdienst hat eine ungültige Antwort gesendet. Bitte versuche es später erneut.';
    if (error.status === 429) return 'Zu viele Anfragen an den Rabattdienst. Bitte warte kurz und versuche es erneut.';
    if (error.status === 403) return 'Die Anfrage konnte nicht bestätigt werden. Bitte versuche es erneut.';
  }
  return 'Der Rabattdienst ist vorübergehend nicht erreichbar. Bitte versuche es später erneut.';
}

export default function RealRewardCard({ service, onSignIn, loginHref }: { service?: VerifiedRewardsService; onSignIn?: () => void; loginHref?: string }) {
  const [status, setStatus] = useState<RealRewardStatus | null>(null);
  const [loading, setLoading] = useState(!!service);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [loginRequired, setLoginRequired] = useState(false);
  const requestEpoch = useRef(0);
  const claiming = useRef(false);
  useEffect(() => {
    if (!service) return;
    const rewardService = service;
    let active = true;
    let checking = false, lastCheck = 0;
    function check() {
      if (!active || checking || claiming.current || Date.now() - lastCheck < 1000) return;
      checking = true; lastCheck = Date.now();
      const epoch = ++requestEpoch.current;
      setLoading(true);
      setMessage(''); setLoginRequired(false);
      void rewardService.status().then(value => {
        if (active && epoch === requestEpoch.current) { setStatus(value); setMessage(''); }
      }).catch((error: unknown) => {
        if (active && epoch === requestEpoch.current) {
          setStatus(null);
          setMessage(rewardErrorMessage(error));
          setLoginRequired(error instanceof VerifiedRewardsError && error.status === 401);
        }
      }).finally(() => { checking = false; if (active) setLoading(false); });
    }
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    check();
    window.addEventListener('focus', onVisible);
    window.addEventListener('pageshow', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('pageshow', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [service]);
  const reward = status?.reward;
  const expired = reward ? Date.parse(reward.expiresAt) <= Date.now() : false;
  const pointsLeft = status ? Math.max(0, status.pointsRequired - status.verifiedPoints) : 0;
  const runsLeft = status ? Math.max(0, status.runsRequired - status.verifiedRuns) : 0;
  async function claim() {
    if (!service || busy || !status?.available || !(status.eligible || status.pending)) return;
    claiming.current = true; requestEpoch.current++;
    setBusy(true); setMessage(''); setLoginRequired(false);
    try { setStatus(await service.claim()); }
    catch (error: unknown) {
      setMessage(`Der Code wurde noch nicht bestätigt. ${rewardErrorMessage(error)}`);
      setLoginRequired(error instanceof VerifiedRewardsError && error.status === 401);
      if (error instanceof VerifiedRewardsError && error.status === 401) setStatus(null);
    }
    finally { claiming.current = false; setBusy(false); }
  }
  async function copyCode() {
    if (!reward) return;
    try { await navigator.clipboard.writeText(reward.code); setMessage('Code kopiert.'); }
    catch { setMessage('Bitte markiere und kopiere den angezeigten Code.'); }
  }
  return <section className="real-reward" aria-labelledby="real-reward-title">
    <div className="real-reward-heading"><Gift aria-hidden="true" size={23} /><div><span className="eyebrow">PFUSCH-SHOP</span>
      <h2 id="real-reward-title">{status?.available || reward ? 'CHF 5 Rabatt' : 'Shop-Belohnung'}</h2></div></div>
    {loading ? <output>Dein Rabattfortschritt wird geladen …</output> : status?.available || reward ? <>
      <p>CHF 5 Rabatt ab CHF 50 Bestellwert. Einmal pro Konto; nach Ausstellung 30 Tage gültig.</p>
      {reward ? <div className="real-reward-code"><span>{expired ? 'Dein Code ist abgelaufen.' : `Gültig bis ${new Date(reward.expiresAt).toLocaleDateString('de-CH')}`}</span>
        <code>{reward.code}</code><button className="button small" disabled={expired} onClick={() => { void copyCode(); }}>CODE KOPIEREN</button></div> : <>
        <p><strong>Deine Aufgabe:</strong> Sammle online und angemeldet {fmt(status!.pointsRequired)} Punkte in mindestens {status!.runsRequired} Fahrten.</p>
        <label className="real-reward-progress">Punkte für deinen Rabatt <strong>{fmt(status!.verifiedPoints)} / {fmt(status!.pointsRequired)}</strong>
          <progress max={status!.pointsRequired} value={Math.min(status!.verifiedPoints, status!.pointsRequired)} /></label>
        <p>{status!.verifiedRuns} / {status!.runsRequired} bestätigte Fahrten · Heute {fmt(status!.dailyPoints)} / {fmt(status!.dailyCap)} Punkte</p>
        <details className="real-reward-help"><summary>Welche Fahrten zählen?</summary>
          <p>Eine Fahrt zählt ab 20 Sekunden und 100 Punkten. Pro Tag zählen höchstens {fmt(status!.dailyCap)} Punkte. Coins und XP zählen nicht.</p>
        </details>
        {status!.pending ? <p>Dein Code ist reserviert. Tippe auf «Code bestätigen», um ihn zu erhalten.</p>
          : status!.eligible ? <p><strong>Aufgabe geschafft!</strong> Du kannst deinen Rabattcode jetzt abholen.</p>
            : <p>{pointsLeft > 0 || runsLeft > 0
              ? `Noch ${[pointsLeft > 0 ? `${fmt(pointsLeft)} Punkte` : '', runsLeft > 0 ? `${runsLeft} ${runsLeft === 1 ? 'Fahrt' : 'Fahrten'}` : ''].filter(Boolean).join(' und ')}. Sobald beide Ziele erreicht sind, kannst du hier deinen Rabattcode abholen.`
              : 'Deine Ziele sind erreicht. Sobald dein Fortschritt bestätigt ist, kannst du hier deinen Rabattcode abholen.'}</p>}
        <button className="button" disabled={busy || !(status!.eligible || status!.pending)} onClick={() => { void claim(); }}>{busy ? 'CODE WIRD BESTÄTIGT …' : status!.pending ? 'CODE BESTÄTIGEN' : status!.eligible ? 'CODE ABHOLEN' : 'NOCH NICHT FREIGESCHALTET'}</button>
      </>}
    </> : status || !service ? <p>{status?.reason === 'rewards_disabled' ? 'Shop-Rabatte sind derzeit deaktiviert.' : 'Shop-Belohnungen sind noch nicht verfügbar.'} Spielbelohnungen kannst du weiterhin abholen.</p> : null}
    {message && <output>{message}</output>}
    {loginRequired && (loginHref ? <a className="button small" href={loginHref} target="_top" rel="noopener">IM SPIEL ANMELDEN</a>
      : onSignIn && <button className="button small" onClick={onSignIn}>IM SPIEL ANMELDEN</button>)}
  </section>;
}
