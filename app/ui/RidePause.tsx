import { ArrowRight, Volume2, VolumeX } from 'lucide-react';
import { DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
export default function RidePause({ muted, onMute, resume, end }: {
  muted: boolean; onMute: () => void; resume: () => void; end: () => void;
}) {
  return <DialogContent className="game-dialog ride-pause-v38" showCloseButton={false}>
    <div className="pause-head-v38">
      <DialogTitle>PAUSE.</DialogTitle>
      <button className="pause-sound-v38" onClick={onMute} aria-label={muted ? 'Ton einschalten' : 'Ton ausschalten'}>
        {muted ? <VolumeX size={20}/> : <Volume2 size={20}/>}
      </button>
    </div>
    <DialogDescription className="pause-description-v38">Deine Fahrt ist angehalten.</DialogDescription>
    <div className="pause-guide-v38" aria-label="Steuerung">
      <div><b>Ausweichen / Abspringen</b><span className="keyboard-v38">← → / A D</span><span className="touch-v38">Seitlich wischen</span></div>
      <div><b>Wheelie</b><span className="keyboard-v38">↓ / S</span><span className="touch-v38">Nach unten ziehen</span></div>
      <div><b>Korrigieren</b><span className="keyboard-v38">↑ / W</span><span className="touch-v38">Nach oben ziehen</span></div>
    </div>
    <button className="button primary pause-continue-v38" onClick={resume}>WEITERFAHREN <ArrowRight size={18}/></button>
    <button className="button pause-end-v38" onClick={end}>FAHRT BEENDEN</button>
  </DialogContent>;
}
