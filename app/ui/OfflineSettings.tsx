import { useSyncExternalStore } from 'react';
import { Download, WifiOff } from 'lucide-react';
import { getOfflineAppState, installOfflineApp, prepareOfflineApp, subscribeOfflineApp } from '../services/offlineApp';

export default function OfflineSettings() {
  const offline = useSyncExternalStore(subscribeOfflineApp, getOfflineAppState, getOfflineAppState);
  return <section className="settings-section settings-offline" aria-labelledby="offline-title">
    <h2 id="offline-title">App &amp; Offline</h2>
    <p className="settings-save-status" role="status" data-testid="offline-ready" data-state={offline.state}>
      {offline.state === 'ready' ? 'Spiel ist offline bereit.'
        : offline.state === 'preparing' ? 'Spiel wird einmalig auf diesem Gerät gespeichert …'
        : offline.state === 'unsupported' ? 'Öffne game.pfusch-clothing.ch direkt in deinem Browser, um das Spiel offline zu speichern.'
        : 'Noch nicht vollständig gespeichert. Verbinde dich kurz mit dem Internet und versuche es erneut.'}
    </p>
    <p>Fahrten werden auf diesem Gerät gespeichert und später mit deinem Konto synchronisiert. Shop-Rabatte und neue Käufe benötigen Internet.</p>
    <div className="settings-actions">
    {offline.state === 'unavailable' && <button type="button" className="button" onClick={() => { void prepareOfflineApp(); }}><WifiOff size={18} aria-hidden="true" />OFFLINE SPEICHERN</button>}
    {offline.installable && <button type="button" className="button" onClick={() => { void installOfflineApp(); }}><Download size={18} aria-hidden="true" />ALS APP INSTALLIEREN</button>}
    </div>
    <details className="settings-help">
      <summary>App installieren &amp; offline vorbereiten</summary>
      <p>Öffne das Spiel einmal online und warte auf „Spiel ist offline bereit“. Öffne auch deine gewünschte Kleidung, damit ihre Bilder gespeichert sind.</p>
      {!offline.installed && !offline.installable && <p>Wähle im Browsermenü „App installieren“ oder „Zum Startbildschirm hinzufügen“.</p>}
    </details>
  </section>;
}
