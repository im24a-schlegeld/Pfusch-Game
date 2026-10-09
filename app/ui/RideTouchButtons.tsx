import type { PointerEvent } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import type { RideHoldAction } from './rideHeldInput';
import './ride-touch-controls.css';

interface Props {
  onPress(action: RideHoldAction, event: PointerEvent<HTMLButtonElement>): void;
  wheelieHeld?: boolean;
  brakeHeld?: boolean;
  tutorial?: boolean;
}

export default function RideTouchButtons({ onPress, wheelieHeld = false, brakeHeld = false, tutorial = false }: Props) {
  return <fieldset className={`ride-touch-buttons${tutorial ? ' is-tutorial' : ''}`} aria-label="Touch-Steuerung" data-testid="ride-touch-buttons">
    <button type="button" className="ride-touch-button brake" aria-label="Bremse halten" aria-pressed={brakeHeld}
      data-hold-action="brake" onPointerDown={event => onPress('brake', event)} onContextMenu={event => event.preventDefault()}>
      <ArrowUp aria-hidden="true" /><strong>BREMSE</strong><small>Vorderrad senken</small>
    </button>
    <button type="button" className="ride-touch-button wheelie" aria-label="Wheelie halten" aria-pressed={wheelieHeld}
      data-hold-action="wheelie" onPointerDown={event => onPress('wheelie', event)} onContextMenu={event => event.preventDefault()}>
      <ArrowDown aria-hidden="true" /><strong>WHEELIE</strong><small>Vorderrad anheben</small>
    </button>
  </fieldset>;
}
