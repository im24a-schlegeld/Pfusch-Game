import { ArrowRight, UserPlus } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import './ride-revive.css';
import GuardianBell from './GuardianBell';
import type { ShareTarget } from '../services/gameShare';

export default function RideRevive({ open, score, busy, message, share, finish, bellBalance = 0, canShare = true, useBell }: {
  open: boolean; score: number; busy: boolean; message: string;
  share: (target: Exclude<ShareTarget, 'email'>) => void; finish: () => void;
  bellBalance?: number; canShare?: boolean; useBell?: () => void;
}) {
  return <Dialog open={open} disablePointerDismissal onOpenChange={next => { if (!next) finish(); }}>
    <DialogContent className="game-dialog ride-revive" showCloseButton={false}>
      <span className="eyebrow">EINMAL PRO FAHRT</span>
      <DialogTitle>Noch eine Chance?</DialogTitle>
      <p className="ride-revive-score">{Math.floor(score).toLocaleString('de-CH')} <span>Punkte bleiben.</span></p>
      <DialogDescription>Löse eine Guardian Bell ein{canShare ? ' oder lade einen Freund ein' : ''} und fahre an dieser Stelle weiter.</DialogDescription>
      <p className="ride-revive-bells"><GuardianBell size={28} /><strong>{bellBalance}</strong><span>Guardian Bells</span></p>
      <button type="button" className={`button${bellBalance > 0 ? ' primary' : ''}`} disabled={busy || bellBalance < 1 || !useBell} onClick={useBell}>
        <GuardianBell size={22} />1 BELL EINLÖSEN
      </button>
      {canShare && (['whatsapp', 'telegram'] as const).map(target => <button key={target} type="button" className={`button${bellBalance < 1 ? ' primary' : ''}`}
        disabled={busy} onClick={() => share(target)}><UserPlus size={18} aria-hidden="true" />{busy ? 'ENTWURF WIRD GEÖFFNET …' : `${target === 'whatsapp' ? 'WHATSAPP' : 'TELEGRAM'} · EINLADEN & WEITER`}</button>)}
      <p className="ride-revive-detail">Jede erfolgreiche Einladung bringt dir eine Guardian Bell.{canShare ? ' Sende die Einladung in WhatsApp oder Telegram und komm zum Spiel zurück.' : ''}</p>
      <button type="button" className="button" onClick={finish}>FAHRT BEENDEN <ArrowRight size={18} aria-hidden="true" /></button>
      <output aria-live="polite">{message}</output>
    </DialogContent>
  </Dialog>;
}
