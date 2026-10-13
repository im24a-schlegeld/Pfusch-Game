import { useSyncExternalStore } from 'react';
import { Download, WifiOff } from 'lucide-react';
import { getOfflineAppState, installOfflineApp, prepareOfflineApp, subscribeOfflineApp } from '../services/offlineApp';

export default function OfflineSettings() {
  const offline = useSyncExternalStore(subscribeOfflineApp, getOfflineAppState, getOfflineAppState);
  return <section className="settings-section" aria-labelledby="offline-title">
    <h2 id="offline-title">SPIELEN OHNE INTERNET</h2>
    <p role="status" data-testid="offline-ready" data-state={offline.state}>
      {offline.state === 'ready' ? 'Spiel ist offline bereit.'
        : offline.state === 'preparing' ? 'Spiel wird einmalig auf diesem Gerät gespeichert …'
        : offline.state === 'unsupported' ? 'Öffne game.pfusch-clothing.ch direkt in deinem Browser, um das Spiel offline zu speichern.'
        : 'Noch nicht vollständig gespeichert. Verbinde dich kurz mit dem Internet und versuche es erneut.'}
    </p>
    <p>Deine Fahrten werden auf diesem Gerät gespeichert und später mit deinem Konto synchronisiert. Shop-Rabatte und neue Käufe benötigen Internet. Öffne deine gewünschte Kleidung einmal online, damit auch ihre Bilder gespeichert sind.</p>
    {offline.state === 'unavailable' && <button type="button" className="button" onClick={() => { void prepareOfflineApp(); }}><WifiOff size={18} aria-hidden="true" />OFFLINE SPEICHERN</button>}
    {offline.installable && <button type="button" className="button" onClick={() => { void installOfflineApp(); }}><Download size={18} aria-hidden="true" />ALS APP INSTALLIEREN</button>}
    {!offline.installed && !offline.installable && <p>Im Browsermenü „App installieren“ oder „Zum Startbildschirm hinzufügen“ wählen. Einmal online öffnen und auf „Spiel ist offline bereit“ warten.</p>}
  </section>;
}
