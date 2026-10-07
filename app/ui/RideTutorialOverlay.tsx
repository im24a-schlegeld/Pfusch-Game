import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import type { TutorialHint } from '../domain/types';
import RideTouchButtons from './RideTouchButtons';
import type { RideHoldAction } from './rideHeldInput';
import './ride-context-tutorial.css';

interface Props {
  hint: TutorialHint | null;
  target?: { x: number; y: number };
  reducedMotion?: boolean;
  touchButtons?: boolean;
  onTouchPress(action: RideHoldAction, event: PointerEvent<HTMLButtonElement>): void;
  onContinue(): void;
  onSkip(): void;
}

const lessons: Record<TutorialHint, { title: string; copy: string; target: string }> = {
  controls: { title: 'So steuerst du', copy: 'Dein Bike gibt automatisch Gas. Wisch los, um weiterzufahren.', target: '' },
  traffic: { title: 'Weiche dem Verkehr aus', copy: 'Wechsle in eine freie Spur. Ein kurzer Wisch nach links oder rechts reicht.', target: 'VERKEHR' },
  ramp: { title: 'Von der Rampe springen', copy: 'Auf der Rampe geht es automatisch hoch. Wische oben seitlich weg, bevor du das Fahrerhaus erreichst.', target: 'RAMPE' },
  police: { title: 'Häng die Polizei ab', copy: 'Ein Wheelie vor der Polizei startet eine Verfolgung. Mit knappem Ausweichen oder einem Rampensprung hängst du sie ab.', target: 'POLIZEI' },
  radar: { title: 'Da steht ein Blitzer', copy: 'Wheelie oder Sprung am Blitzer? Dann folgt die Polizei. Nach oben ziehen senkt das Vorderrad.', target: 'BLITZER' },
  signs: { title: 'Sammle die PFUSCH-Zeichen', copy: 'Fahre durch die Zeichen. Sammle P F U S C H für 750 Bonuspunkte.', target: 'ZEICHEN' },
};

function SwipeArrow({ direction }: { direction: 'side' | 'up' | 'down' }) {
  return <svg className="ride-coach-arrow" viewBox="0 0 90 40" aria-hidden="true" fill="none">
    {direction === 'side' ? <><path d="M9 20h72M20 9 9 20l11 11M70 9l11 11-11 11" /><circle className="ride-coach-finger side" cx="45" cy="20" r="5" /></>
      : <g transform={direction === 'down' ? 'rotate(180 45 20)' : undefined}><path d="M45 33V7M33 19 45 7l12 12" /><circle className="ride-coach-finger vertical" cx="45" cy="33" r="4" /></g>}
  </svg>;
}

/** The ride owns gestures, so continuing a swipe never loses the finger's input. */
export default function RideTutorialOverlay({ hint, target, reducedMotion, touchButtons = false, onTouchPress, onContinue, onSkip }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (hint) heading.current?.focus({ preventScroll: true }); }, [hint]);
  if (!hint) return null;
  const lesson = lessons[hint];
  const copy = touchButtons && hint === 'controls'
    ? 'Dein Bike gibt automatisch Gas. Halte Wheelie zum Anheben oder Bremse zum Senken. Probier eine Taste aus, um loszufahren.'
    : touchButtons && hint === 'radar'
      ? 'Wheelie oder Sprung am Blitzer? Dann folgt die Polizei. Halte Bremse, um das Vorderrad zu senken.'
      : lesson.copy;
  const trapFocus = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== 'Tab') return;
    const buttons = dialog.current?.querySelectorAll<HTMLButtonElement>('button');
    if (!buttons?.length) return;
    const first = buttons[0], last = buttons[buttons.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === heading.current)) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === heading.current)) {
      event.preventDefault(); first.focus();
    }
  };
  return <dialog open className="ride-coach" data-testid="ride-tutorial-overlay" data-tutorial={hint}
    data-card-side={target && target.y > 0.56 ? 'top' : 'bottom'} data-reduced-motion={reducedMotion}
    aria-modal="true" aria-labelledby="ride-tutorial-title" aria-describedby="ride-tutorial-copy"
    ref={dialog} onKeyDown={trapFocus}>
    <span className="ride-coach-pause">Fahrt angehalten</span>
    {hint === 'controls' && <svg className="ride-coach-stage-gesture" data-buttons={touchButtons} viewBox="0 0 220 130" fill="none" aria-hidden="true">
      <path d={touchButtons ? 'M30 65h160M45 50 30 65l15 15M175 50l15 15-15 15' : 'M30 65h160M45 50 30 65l15 15M175 50l15 15-15 15M110 15v100M96 29l14-14 14 14M96 101l14 14 14-14'} />
      <circle className="ride-coach-stage-finger" cx="110" cy="65" r="13" /><circle className="ride-coach-stage-finger-inner" cx="110" cy="65" r="5" />
    </svg>}
    {target && <div className="ride-coach-target" aria-hidden="true" data-testid="tutorial-target"
      style={{ left: `${target.x * 100}%`, top: `${target.y * 100}%` }}>
      <span className="ride-coach-ring" /><span className="ride-coach-target-label">{lesson.target}</span>
    </div>}
    <section className="ride-coach-card">
      <h2 id="ride-tutorial-title" ref={heading} tabIndex={-1}>{lesson.title}</h2>
      <p id="ride-tutorial-copy">{copy}</p>
      {hint === 'controls' && touchButtons ? <>
        <div className="ride-coach-single"><SwipeArrow direction="side" /><span>Seitlich wischen · Spur wechseln</span></div>
        <RideTouchButtons tutorial onPress={onTouchPress} />
        <p className="ride-coach-hold-help">Gedrückt halten · Loslassen ist neutral</p>
      </> : hint === 'controls' ? <div className="ride-coach-controls" aria-label="Wischgesten">
        <div><SwipeArrow direction="side" /><span>Spur wechseln</span></div>
        <div><SwipeArrow direction="down" /><span>Wheelie anheben</span></div>
        <div><SwipeArrow direction="up" /><span>Vorderrad senken</span></div>
        <small>Ziehen und halten · Loslassen ist neutral</small>
      </div> : ['traffic', 'ramp', 'signs'].includes(hint) ? <div className="ride-coach-single"><SwipeArrow direction="side" /><span>Seitlich wischen</span></div>
        : hint === 'radar' && touchButtons ? <div className="ride-coach-single"><span>BREMSE halten · Vorderrad senken</span></div>
          : hint === 'radar' ? <div className="ride-coach-single"><SwipeArrow direction="up" /><span>Nach oben ziehen</span></div> : null}
      <p className="ride-coach-keyboard">{hint === 'controls' ? 'Tastatur: A/D ausweichen · S anheben · W senken' : 'Pfeiltasten oder A/D · Enter weiter'}</p>
      <div className="ride-coach-actions"><button type="button" onClick={onContinue} data-testid="tutorial-continue">Weiter</button><button type="button" onClick={onSkip}>Hinweise überspringen</button></div>
    </section>
  </dialog>;
}
