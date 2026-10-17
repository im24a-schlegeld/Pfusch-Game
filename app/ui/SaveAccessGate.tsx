import { ArrowRight, ExternalLink, LockKeyhole, Mail, RefreshCw } from 'lucide-react';
import { useRef } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import type { PlayerAccess } from '../services';
import './save-access.css';

interface Props {
  open: boolean;
  access: PlayerAccess;
  checking: boolean;
  message?: string;
  onNewsletter?: () => void;
  onLogin?: () => void;
  loginHref?: string;
  authenticated?: boolean;
  onStart(): void;
  back(): void;
}

/** Visiting the shop never grants access; only the repository's fresh check can. */
export default function SaveAccessGate({ open, access, checking, message, onNewsletter, onLogin, loginHref, authenticated = false, onStart, back }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  const unavailable = access.reason === 'unavailable';
  const unsubscribed = access.reason === 'unsubscribed';
  return <Dialog open={open} onOpenChange={(next) => { if (!next) back(); }}>
    <DialogContent className="game-dialog save-access-dialog save-access-panel" data-testid="save-access-gate" showCloseButton={false} initialFocus={heading}>
      <div className="save-access-symbol" aria-hidden="true">{access.allowed ? <ArrowRight /> : unavailable ? <RefreshCw /> : <Mail />}</div>
      <span className="save-access-counter">{Math.min(access.completedRuns, access.freeRuns)} / {access.freeRuns} FREIE FAHRTEN</span>
      <DialogTitle ref={heading} tabIndex={-1}>{access.allowed ? 'DEIN ZUGANG IST BESTÄTIGT.' : unavailable ? 'KONTOSTATUS NOCH NICHT BESTÄTIGT.' : unsubscribed ? 'DEIN ABO IST NICHT MEHR AKTIV.' : 'NEWSLETTER ABONNIEREN & WEITERFAHREN.'}</DialogTitle>
      <DialogDescription>{access.allowed
        ? 'Du kannst wieder fahren. Der Speicherstatus zeigt dir, ob dein Fortschritt gesichert ist.'
        : unavailable
          ? 'Der Zugang konnte gerade nicht sicher geprüft werden. Weitere Fahrten bleiben bis zur Bestätigung gesperrt.'
          : unsubscribed
            ? 'Nach der Newsletter-Abmeldung sind weitere Fahrten und neue Spielstände pausiert. Dein bisher gespeicherter Fortschritt bleibt erhalten.'
            : 'Deine fünf freien Fahrten sind aufgebraucht. Weitere Fahrten und neue Spielstände benötigen ein aktives PFUSCH-Newsletter-Abo.'}</DialogDescription>
      {!access.allowed && !unavailable && <ol className="save-access-steps">
        <li><span>01</span><p>Abonniere den PFUSCH-Newsletter im Shop bewusst mit deiner E-Mail-Adresse. Falls du eine Bestätigungs-E-Mail erhältst, bestätige das Abo dort.</p></li>
        {authenticated ? <li><span>02</span><p>Du bist bereits angemeldet. Kehre nach der Newsletter-Bestätigung zum Spiel zurück; der Zugang wird automatisch neu geprüft.</p></li>
          : <li><span>02</span><p>Melde dich im Shop mit derselben E-Mail-Adresse an. Kehre danach zum Spiel zurück; der Zugang wird automatisch geprüft.</p></li>}
      </ol>}
      {!access.allowed && !unavailable && !onNewsletter && <p>Die Newsletter-Verbindung ist nur im Spiel innerhalb des PFUSCH-Shops verfügbar. In diesem Fenster kann kein Abo bestätigt werden.</p>}
      {message && <output className="save-access-message">{message}</output>}
      <div className="save-access-actions">
        {!access.allowed && !authenticated && loginHref && <a className="button" href={loginHref} target="_top" rel="noopener">MIT PFUSCH-KONTO ANMELDEN <ExternalLink size={18} aria-hidden="true" /></a>}
        {!access.allowed && !authenticated && !loginHref && onLogin && <button className="button" onClick={onLogin}>MIT PFUSCH-KONTO ANMELDEN <ExternalLink size={18} aria-hidden="true" /></button>}
        {access.allowed ? <button className="button primary" onClick={onStart} disabled={checking}>FAHRT STARTEN <ArrowRight size={18} aria-hidden="true" /></button>
          : !unavailable && onNewsletter ? <button className="button primary" onClick={onNewsletter}>ZUM NEWSLETTER <ExternalLink size={18} aria-hidden="true" /></button> : null}
        {unavailable && <button className="button" onClick={() => window.location.reload()}>NEU LADEN</button>}
      </div>
      {!access.allowed && <p className="save-access-footnote"><LockKeyhole size={15} aria-hidden="true" />{authenticated ? 'Ein bestätigtes Kundenkonto ersetzt kein Newsletter-Abo. Bei einer späteren Newsletter-Abmeldung stoppen neue Fahrten und das Speichern wieder.' : 'Das Öffnen des Formulars meldet dich nicht an und schaltet nichts frei. Bei einer späteren Newsletter-Abmeldung stoppen neue Fahrten und das Speichern wieder.'}</p>}
      <button className="save-access-back" onClick={back}>ZURÜCK ZUM SPIEL</button>
    </DialogContent>
  </Dialog>;
}
