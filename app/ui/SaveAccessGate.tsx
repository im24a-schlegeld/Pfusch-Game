import { ArrowRight, ExternalLink, LockKeyhole, RefreshCw, UserRound } from 'lucide-react';
import { useRef } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import type { PlayerAccess } from '../services';
import './save-access.css';

interface Props {
  open: boolean;
  access: PlayerAccess;
  checking: boolean;
  message?: string;
  onLogin?: () => void;
  loginHref?: string;
  authenticated?: boolean;
  onRetry?: () => void;
  onStart(): void;
  back(): void;
}

/** A verified Shopify account has unlimited rides; guests retain five free runs. */
export default function SaveAccessGate({ open, access, checking, message, onLogin, loginHref, authenticated = false, onRetry, onStart, back }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  const unavailable = access.reason === 'unavailable';
  return <Dialog open={open} onOpenChange={(next) => { if (!next) back(); }}>
    <DialogContent className="game-dialog save-access-dialog save-access-panel" data-testid="save-access-gate" showCloseButton={false} initialFocus={heading}>
      <div className="save-access-symbol" aria-hidden="true">{access.allowed ? <ArrowRight /> : unavailable ? <RefreshCw /> : <UserRound />}</div>
      {!authenticated && <span className="save-access-counter">{Math.min(access.completedRuns, access.freeRuns)} / {access.freeRuns} FREIE FAHRTEN</span>}
      <DialogTitle ref={heading} tabIndex={-1}>{access.allowed ? 'DEIN ZUGANG IST BESTÄTIGT.' : unavailable ? 'KONTOSTATUS NOCH NICHT BESTÄTIGT.' : 'MIT PFUSCH-KONTO WEITERFAHREN.'}</DialogTitle>
      <DialogDescription>{access.allowed
        ? 'Du kannst fahren und deinen Spielstand im Kundenkonto speichern.'
        : unavailable ? 'Die Spielsitzung konnte gerade nicht sicher bestätigt werden. Prüfe die Verbindung oder melde dich erneut an.'
        : 'Deine fünf freien Gastfahrten sind aufgebraucht. Mit einem PFUSCH-Konto kannst du unbegrenzt weiterspielen und speichern. Ein Newsletter-Abo ist nicht nötig.'}</DialogDescription>
      {message && <output className="save-access-message">{message}</output>}
      <div className="save-access-actions">
        {!access.allowed && loginHref && <a className="button" href={loginHref} target="_top" rel="noopener">MIT PFUSCH-KONTO ANMELDEN <ExternalLink size={18} aria-hidden="true" /></a>}
        {!access.allowed && !loginHref && onLogin && <button className="button" onClick={onLogin}>MIT PFUSCH-KONTO ANMELDEN <ExternalLink size={18} aria-hidden="true" /></button>}
        {access.allowed ? <button className="button primary" onClick={onStart} disabled={checking}>FAHRT STARTEN <ArrowRight size={18} aria-hidden="true" /></button>
          : authenticated && onRetry ? <button className="button" onClick={onRetry} disabled={checking}>{checking ? 'PRÜFE KONTO …' : 'KONTO ERNEUT PRÜFEN'} <RefreshCw size={18} aria-hidden="true" /></button> : null}
        {!access.allowed && unavailable && !onRetry && <button className="button" onClick={() => window.location.reload()}>NEU LADEN</button>}
      </div>
      {!access.allowed && <p className="save-access-footnote"><LockKeyhole size={15} aria-hidden="true" />Nur eine bestätigte Shopify-Anmeldung schaltet Kundenfahrten und Cloud-Speicherung frei.</p>}
      <button className="save-access-back" onClick={back}>ZURÜCK ZUM SPIEL</button>
    </DialogContent>
  </Dialog>;
}
