import { ArrowRight } from 'lucide-react';
import { useRef } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import './ride-guidance.css';

interface Props {
  open: boolean;
  onOpenChange(open: boolean): void;
  onStart(): void;
  reducedMotion?: boolean;
}

function ControlPicture({ direction }: { direction: 'down' | 'up' | 'side' | 'pause' }) {
  return <svg viewBox="0 0 80 52" aria-hidden="true" className="first-ride-picture">
    {direction === 'pause' ? <>
      <circle cx="29" cy="28" r="10" /><circle cx="53" cy="28" r="10" />
      <path d="M27 13V5M55 13V5M38 45h6" />
    </> : direction === 'side' ? <>
      <circle cx="40" cy="26" r="7" /><path d="M8 26h22m20 0h22M16 18l-8 8 8 8m48-16 8 8-8 8" />
    </> : <g transform={direction === 'up' ? 'rotate(180 40 26)' : undefined}>
      <circle cx="40" cy="9" r="5" className="first-ride-origin" />
      <path d="M40 16v27m-8-8 8 8 8-8" /><path d="M53 19v20" className="first-ride-strength" />
    </g>}
  </svg>;
}

/** Opening or dismissing this guide never marks it seen; only onStart may save. */
export default function FirstRideTutorial({ open, onOpenChange, onStart, reducedMotion = false }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="game-dialog first-ride-dialog" showCloseButton={false} data-reduced-motion={reducedMotion} initialFocus={heading}>
      <div className="first-ride-intro">
        <p className="eyebrow">DEINE ERSTE RUNDE</p>
        <DialogTitle ref={heading} tabIndex={-1}>SO FÄHRST DU.</DialogTitle>
        <DialogDescription>Dein Bike gibt automatisch Gas. Weiche dem Verkehr aus und halte so lange wie möglich durch.</DialogDescription>
      </div>
      <div className="first-ride-controls" aria-label="Steuerung auf dem Handy">
        <div><ControlPicture direction="down" /><b>Wheelie anheben</b><p>Nach unten ziehen. Je weiter, desto stärker.</p></div>
        <div><ControlPicture direction="up" /><b>Wheelie senken</b><p>Nach oben ziehen. Loslassen ist neutral.</p></div>
        <div><ControlPicture direction="side" /><b>Verkehr ausweichen</b><p>Kurz nach links oder rechts wischen.</p></div>
        <div><ControlPicture direction="pause" /><b>Pause machen</b><p>Mit zwei Fingern kurz tippen.</p></div>
      </div>
      <div className="first-ride-goal">
        <b>FAHREN. SAMMELN. AUFRÜSTEN.</b>
        <p>Wheelies und knappe Manöver geben Punkte. Sammle <strong>P F U S C H</strong> für den Bonus. Nach der Runde bekommst du Coins für neue Bikes und deinen Look in der Garage.</p>
      </div>
      <p className="first-ride-keyboard"><b>Tastatur:</b> A/D oder ←/→ ausweichen · S/↓ anheben · W/↑ senken · Esc/P Pause.</p>
      <div className="first-ride-actions">
        <button className="button primary" data-testid="first-ride-start" onClick={onStart}>VERSTANDEN. LOSFAHREN <ArrowRight size={18} /></button>
        <button className="first-ride-later" onClick={() => onOpenChange(false)}>Noch nicht starten</button>
      </div>
    </DialogContent>
  </Dialog>;
}
