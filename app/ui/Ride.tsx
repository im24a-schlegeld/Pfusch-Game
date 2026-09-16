import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Volume2, VolumeX } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import type { Player, Product, RunStats } from '../domain/types';
import { BIKES } from '../domain/config';
import { Engine } from '../game/engine';
import { GameAudio } from '../game/audio';
import { Preview, fmt, gameText } from './shared';
import { RideGestures } from './rideGestures';
import { SIGN_IDS } from '../game/signCollectibles';
interface Props {
  player: Player;
  products: Product[];
  audio: GameAudio;
  onFinish: (r: RunStats) => void;
  onResultsReady: (runId: string) => void;
  onMute: () => void;
}
export default function Ride({
  player,
  products,
  audio,
  onFinish,
  onResultsReady,
  onMute,
}: Props) {
  const engine = useMemo(
    () =>
      new Engine(
        BIKES.find((b) => b.id === player.bike)!,
        Math.floor(Math.random() * 0xffffffff),
      ),
    [player.bike],
  );
  const [tick, setTick] = useState(0);
  const [ready, setReady] = useState(false);
  const [countdown, setCountdown] = useState(3);
  const settled = useRef<RunStats | null>(null);
  const revealed = useRef(false);
  const lastEvent = useRef(0);
  const eventTime = useRef(0);
  const suppressClicksUntil = useRef(0);
  const gestures = useMemo(
    () =>
      new RideGestures({
        weight: (value) => engine.weight(value),
        move: (direction) => engine.move(direction),
        togglePause: () => {
          if (engine.phase === 'playing') engine.pause();
          else if (engine.phase === 'paused') engine.resume();
          else return;
          suppressClicksUntil.current = performance.now() + 400;
          audio.update(0, false, false);
          setTick((n) => n + 1);
        },
      }),
    [engine, audio],
  );
  const finish = useRef(onFinish);
  finish.current = onFinish;
  const resultsReady = useRef(onResultsReady);
  resultsReady.current = onResultsReady;
  useEffect(() => {
    if (!ready) return;
    const timer = window.setInterval(() => {
      setCountdown((n) => {
        if (n <= 1) {
          clearInterval(timer);
          engine.start();
          return 0;
        }
        return n - 1;
      });
    }, 650);
    return () => clearInterval(timer);
  }, [engine, ready]);
  useEffect(() => {
    const down = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const surface = target?.closest('.gesture-zone');
      const pausedDialog =
        engine.phase === 'paused' && target?.closest('[role="dialog"]');
      if (
        (!surface && !pausedDialog) ||
        (event.pointerType === 'mouse' && event.button !== 0)
      )
        return;
      if (surface) {
        event.preventDefault();
        surface.setPointerCapture(event.pointerId);
      }
      gestures.down(
        event.pointerId,
        event.clientX,
        event.clientY,
        event.timeStamp,
      );
    };
    const move = (event: PointerEvent) =>
      gestures.move(event.pointerId, event.clientX, event.clientY);
    const up = (event: PointerEvent) =>
      gestures.up(event.pointerId, event.timeStamp);
    const cancel = (event: PointerEvent) => gestures.cancel(event.pointerId);
    const click = (event: MouseEvent) => {
      if (performance.now() < suppressClicksUntil.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener('pointerdown', down, {
      capture: true,
      passive: false,
    });
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', cancel, true);
    window.addEventListener('lostpointercapture', cancel, true);
    window.addEventListener('click', click, true);
    return () => {
      gestures.cancel();
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', cancel, true);
      window.removeEventListener('lostpointercapture', cancel, true);
      window.removeEventListener('click', click, true);
    };
  }, [engine, gestures]);
  useEffect(() => {
    if (engine.phase !== 'playing') gestures.cancel();
  }, [engine.phase, gestures]);
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if (
        [
          'ArrowLeft',
          'ArrowRight',
          'ArrowUp',
          'ArrowDown',
          ' ',
          'a',
          'd',
          'w',
          's',
          'A',
          'D',
          'W',
          'S',
          'Escape',
          'p',
          'P',
        ].includes(e.key)
      )
        e.preventDefault();
      if (e.repeat) return;
      if (e.key === 'Escape' || e.key.toLowerCase() === 'p') {
        gestures.cancel();
        if (engine.phase === 'playing') engine.pause();
        else engine.resume();
        setTick((n) => n + 1);
        return;
      }
      if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'a') engine.move(-1);
      if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'd') engine.move(1);
      if (e.key === 'ArrowUp' || e.key.toLowerCase() === 'w')
        engine.forward(true);
      if (e.key === 'ArrowDown' || e.key.toLowerCase() === 's')
        engine.hold(true);
    };
    const keyup = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp' || e.key.toLowerCase() === 'w')
        engine.forward(false);
      if (e.key === 'ArrowDown' || e.key.toLowerCase() === 's')
        engine.hold(false);
    };
    const blur = () => {
      gestures.cancel();
      engine.pause();
      engine.clearInput();
      audio.update(0, false, false);
      setTick((n) => n + 1);
    };
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', blur);
    return () => {
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', blur);
      audio.update(0, false, false);
    };
  }, [engine, audio, gestures]);
  function settle(e: Engine) {
    if (e.phase !== 'crashed' || settled.current) return;
    const run = e.stats();
    settled.current = run;
    finish.current(run);
  }
  function revealResults() {
    settle(engine);
    if (!settled.current || revealed.current) return;
    revealed.current = true;
    resultsReady.current(settled.current.id);
  }
  function frame(e: Engine) {
    audio.update(
      e.speed,
      e.throttleInput > 0,
      e.phase === 'playing',
      e.bike.id,
      e.world.tunnelExposure(e.distance),
      e.forwardInput > 0,
    );
    if (e.event.serial !== lastEvent.current) {
      lastEvent.current = e.event.serial;
      eventTime.current = performance.now();
      audio.cue(e.phase === 'crashed');
    }
    setTick((n) => n + 1);
    if (e.phase === 'crashed') {
      settle(e);
      if (settled.current?.cause === 'Ride ended') revealResults();
    }
  }
  const eventVisible =
    engine.event.text && performance.now() - eventTime.current < 1600;
  return (
    <main
      className="ride-screen"
      data-testid="ride-screen"
      data-phase={engine.phase}
      data-lane={engine.lane}
      data-height={engine.height.toFixed(2)}
      data-forward={engine.forwardInput > 0}
      data-throttle-input={engine.throttleInput.toFixed(3)}
      data-forward-input={engine.forwardInput.toFixed(3)}
      data-angle={engine.wheelieAngle.toFixed(3)}
      data-angular-velocity={engine.wheelieAngularVelocity.toFixed(3)}
      data-balance={engine.balanceQuality.toFixed(3)}
      data-distance={engine.distance.toFixed(2)}
      data-environment={engine.environment.kind}
      data-lighting={engine.environment.lighting}
      data-tunnel={engine.world.tunnelExposure(engine.distance).toFixed(3)}
      data-wheelie={engine.wheelie}
      data-sign-mask={engine.collectedSigns}
      data-sign-sets={engine.signSetCount}
      data-frame={tick}
    >
      <Preview
        player={player}
        products={products}
        mode="ride"
        engine={engine}
        onFrame={frame}
        onReady={() => setReady(true)}
        onCrashComplete={revealResults}
      />
      <div
        className="gesture-zone"
        aria-label="Steuerung: seitlich wischen, nach unten ziehen zum Anheben, nach oben zum Korrigieren; zwei Finger zum Pausieren"
        onContextMenu={(e) => e.preventDefault()}
      />
      <div className="ride-top">
        <div className="score-display">
          <span className="eyebrow">PUNKTE</span>
          <strong>{fmt(engine.score).padStart(6, '0')}</strong>
          <small>BESTE {fmt(player.highScore)}</small>
        </div>
        <div
          className="sign-progress"
          aria-label={`PFUSCH-Zeichen: ${SIGN_IDS.filter((_, i) => engine.collectedSigns & (1 << i)).join(', ') || 'keine'}; ${engine.signSetCount} Sets komplett`}
        >
          <span className="eyebrow">SAMMLE DAS SET</span>
          <div>
            {SIGN_IDS.map((id, index) => (
              <b
                key={id}
                className={
                  engine.collectedSigns & (1 << index) ? 'collected' : ''
                }
              >
                {id}
              </b>
            ))}
          </div>
          {engine.signSetCount > 0 && <small>SÄTZE {engine.signSetCount}</small>}
        </div>
      </div>
      <div className="ride-metrics">
        <span>
          {fmt(engine.distance)} <small>M</small>
        </span>
        <span>
          <b>{Math.round(engine.speed * 3.6)}</b> <small>KM/H</small>
        </span>
      </div>
      <div className={`combo-display ${engine.combo > 1 ? 'is-active' : ''}`}>
        <b>×{engine.combo.toFixed(1)}</b>
        <span>KOMBO</span>
        <div
          style={{
            transform: `scaleX(${Math.max(0, engine.comboTime / 3.8)})`,
          }}
        />
      </div>
      {eventVisible && (
        <div
          key={engine.event.serial}
          className={`skill-event ${engine.event.kind}`}
        >
          {gameText(engine.event.text)}
        </div>
      )}
      {countdown > 0 && (
        <div className="countdown">
          <p className="eyebrow">FAHR DEINE LINIE</p>
          <strong>{ready ? countdown : '…'}</strong>
          <p>Verkehr ausweichen. Vorderrad balancieren.</p>
        </div>
      )}
      {engine.elapsed < 9 && countdown === 0 && engine.phase !== 'crashed' && (
        <div className="ride-tip">
          <span className="desktop-control-tip">
            S / ↓ ANHEBEN · W / ↑ KORRIGIEREN
          </span>
          <span className="touch-control-tip">
            NACH UNTEN = ANHEBEN · ↑ KORRIGIEREN · ZWEI FINGER = PAUSE
          </span>
          {' · WISCHEN = AUSWEICHEN'}
        </div>
      )}
      {engine.phase === 'playing' && (
        <div className="ride-balance" aria-label="Wheelie-Winkel">
          <small>GLEICHGEWICHT</small>
          <div className="balance-meter">
            <b
              style={{
                left: `${(engine.balanceProfile.balancePoint / engine.balanceProfile.crashAngle) * 100}%`,
              }}
            />
            <i
              style={{
                width: `${Math.min(100, (engine.wheelieAngle / engine.balanceProfile.crashAngle) * 100)}%`,
              }}
            />
          </div>
        </div>
      )}
      <Dialog
        open={engine.phase === 'paused'}
        disablePointerDismissal
        onOpenChange={(open) => {
          if (!open) {
            engine.resume();
            setTick((n) => n + 1);
          }
        }}
      >
        <DialogContent className="game-dialog" showCloseButton={false}>
          <p className="eyebrow">PAUSE</p>
          <DialogTitle>FAHRT PAUSIERT.</DialogTitle>
          <DialogDescription>
            Mit zwei Fingern fortsetzen. Deine Fahrt bleibt an dieser Stelle.
          </DialogDescription>
          <div className="control-guide">
            <span>
              ← → / A D <b>Ausweichen</b>
            </span>
            <span>
              ↑ / W <b>Gewicht vor / korrigieren</b>
            </span>
            <span>
              ↓ / S <b>Gas / Gewicht zurück</b>
            </span>
            <span>
              ESC / P <b>Pause</b>
            </span>
          </div>
          <p className="muted">
            Touch: nach unten ziehen zum Anheben, nach oben zum Korrigieren und seitlich zum Ausweichen. Loslassen = neutral. Zwei Finger pausieren. Wheelies, knappe Manöver und Stunts bringen die meisten Punkte. Sammle P F U S C H für einen Set-Bonus.
          </p>
          <button className="button" onClick={onMute}>
            {player.settings.muted ? <VolumeX /> : <Volume2 />}
            {player.settings.muted ? 'TON AN' : 'TON AUS'}
          </button>
          <button
            className="button primary"
            onClick={() => {
              engine.resume();
              audio.unlock();
              setTick((n) => n + 1);
            }}
          >
            WEITERFAHREN <ArrowRight />
          </button>
          <button
            className="button"
            onClick={() => {
              engine.resume();
              engine.crash('Ride ended');
            }}
          >
            FAHRT BEENDEN
          </button>
        </DialogContent>
      </Dialog>
    </main>
  );
}
