import { Download, X } from 'lucide-react';
import { installOfflineApp, type OfflineAppState } from '../services/offlineApp';
import './offline-install-hint.css';

export interface OfflineInstallHintProps {
  offline: OfflineAppState;
  dismiss: () => void;
  openSettings: () => void;
}

export default function OfflineInstallHint({ offline, dismiss, openSettings }: OfflineInstallHintProps) {
  if (offline.installed) return null;
  return <aside className="offline-install-hint" aria-labelledby="install-hint-title" data-testid="offline-install-hint">
    <div className="offline-install-copy">
      <h2 id="install-hint-title">Als App installieren</h2>
      <p>Spiel auch offline. Dein Fortschritt wird synchronisiert, sobald du wieder online bist.</p>
      {!offline.installable && <p className="offline-install-help">Browsermenü → „App installieren“. In Safari: Teilen → „Zum Home-Bildschirm“.</p>}
      <div className="offline-install-actions">
        {offline.installable && <button type="button" className="offline-install-button" onClick={() => { void installOfflineApp(); }}><Download size={16} aria-hidden="true" />INSTALLIEREN</button>}
        <button type="button" className="offline-install-status" onClick={openSettings}>
          {offline.state === 'ready' ? 'Spiel ist offline bereit · Details'
            : offline.state === 'preparing' ? 'Offline wird vorbereitet … · Status'
              : 'Offline-Status prüfen'}
        </button>
      </div>
    </div>
    <button type="button" className="offline-install-close" aria-label="Installationshinweis schließen" onClick={dismiss}><X size={18} aria-hidden="true" /></button>
  </aside>;
}
