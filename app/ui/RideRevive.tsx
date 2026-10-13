import { ArrowRight, Share2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import './ride-revive.css';

export default function RideRevive({ open, score, busy, message, share, finish }: {
  open: boolean; score: number; busy: boolean; message: string;
  share: () => void; finish: () => void;
}) {
  return <Dialog open={open} disablePointerDismissal onOpenChange={next => { if (!next) finish(); }}>
    <DialogContent className="game-dialog ride-revive" showCloseButton={false}>
      <span className="eyebrow">EINMAL PRO FAHRT</span>
      <DialogTitle>Noch eine Chance?</DialogTitle>
      <p className="ride-revive-score">{Math.floor(score).toLocaleString('de-CH')} <span>Punkte bleiben.</span></p>
      <DialogDescription>Teile Wheelie Escape mit deinen Freunden und fahre an dieser Stelle weiter.</DialogDescription>
      <p className="ride-revive-detail">Wähle WhatsApp, Instagram, Snapchat oder eine andere verfügbare App im Teilen-Menü.</p>
      <button type="button" className="button primary" disabled={busy} onClick={share}>
        <Share2 size={18} aria-hidden="true" />{busy ? 'TEILEN GEÖFFNET …' : 'TEILEN & WEITERFAHREN'}
      </button>
      <button type="button" className="button" onClick={finish}>FAHRT BEENDEN <ArrowRight size={18} aria-hidden="true" /></button>
      <output aria-live="polite">{message}</output>
    </DialogContent>
  </Dialog>;
}
