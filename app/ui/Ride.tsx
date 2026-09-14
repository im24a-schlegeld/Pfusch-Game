import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Pause, Volume2, VolumeX } from 'lucide-react';
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
import { Preview, fmt } from './shared';
import { WeightControl } from './WeightControl';
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
  const gesture = useRef<{ x: number; y: number } | null>(null);
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
  const pause = () => {
    engine.pause();
    setTick((n) => n + 1);
    audio.update(0, false, false);
  };
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
  }, [engine, audio]);
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
        aria-label="Swipe left or right to dodge"
        onPointerDown={(e) => {
          gesture.current = { x: e.clientX, y: e.clientY };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerUp={(e) => {
          const start = gesture.current;
          gesture.current = null;
          if (!start) return;
          const dx = e.clientX - start.x,
            dy = e.clientY - start.y;
          if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
          if (Math.abs(dx) > Math.abs(dy)) engine.move(dx < 0 ? -1 : 1);
        }}
        onPointerCancel={() => {
          gesture.current = null;
        }}
      />
      <div className="ride-top">
        <div className="score-display">
          <span className="eyebrow">SCORE</span>
          <strong>{fmt(engine.score).padStart(6, '0')}</strong>
          <small>BEST {fmt(player.highScore)}</small>
        </div>
        <div className="ride-actions">
          <button
            className="icon-button"
            aria-label={player.settings.muted ? 'Unmute' : 'Mute'}
            onClick={onMute}
          >
            {player.settings.muted ? <VolumeX /> : <Volume2 />}
          </button>
          <button
            className="icon-button"
            aria-label="Pause ride"
            disabled={engine.phase === 'crashed'}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              pause();
            }}
            onClick={(e) => {
              if (e.detail === 0) pause();
            }}
          >
            <Pause />
          </button>
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
        <span>COMBO</span>
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
          {engine.event.text}
        </div>
      )}
      {countdown > 0 && (
        <div className="countdown">
          <p className="eyebrow">MAKE IT YOUR LINE</p>
          <strong>{ready ? countdown : '…'}</strong>
          <p>Dodge traffic. Balance the front wheel.</p>
        </div>
      )}
      {engine.elapsed < 9 && countdown === 0 && engine.phase !== 'crashed' && (
        <div className="ride-tip">
          <span className="desktop-control-tip">
            S / ↓ RAISE · W / ↑ CORRECT
          </span>
          <span className="touch-control-tip">
            HOLD WHEELIE · SLIDE UP TO CORRECT
          </span>
          {' · SWIPE TO DODGE'}
        </div>
      )}
      {engine.phase !== 'crashed' && (
        <div className="ride-controls">
          <div className="steer-controls">
            <button
              aria-label="Dodge left"
              onPointerDown={(e) => {
                e.preventDefault();
                engine.move(-1);
              }}
            >
              <ArrowLeft />
            </button>
            <button
              aria-label="Dodge right"
              onPointerDown={(e) => {
                e.preventDefault();
                engine.move(1);
              }}
            >
              <ArrowRight />
            </button>
          </div>
          <WeightControl engine={engine} />
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
          <p className="eyebrow">TAKE A BREATHER</p>
          <DialogTitle>RIDE PAUSED.</DialogTitle>
          <DialogDescription>Your line will be right here.</DialogDescription>
          <div className="control-guide">
            <span>
              ← → / A D <b>Dodge</b>
            </span>
            <span>
              ↑ / W <b>Weight forward / correct</b>
            </span>
            <span>
              ↓ / S <b>Throttle / weight back</b>
            </span>
            <span>
              ESC / P <b>Pause</b>
            </span>
          </div>
          <p className="muted">
            On touch, hold WHEELIE and slide that thumb up to reduce throttle or
            shift forward. Slide down to raise again; release for neutral. Use
            short throttle inputs to raise the front. Release below the balance
            marker; hold forward weight to catch an overrotation. Steady balance
            earns more than holding throttle. A controlled higher angle earns
            more points. Dodge traffic, potholes and raised road edges, or lift
            the front before the edge. Lower the front on wet asphalt and
            gravel; hold forward over rough patches for a smoother line. A clear
            lane always remains available.
          </p>
          <button
            className="button primary"
            onClick={() => {
              engine.resume();
              audio.unlock();
              setTick((n) => n + 1);
            }}
          >
            BACK TO THE STREETS <ArrowRight />
          </button>
          <button
            className="button"
            onClick={() => {
              engine.resume();
              engine.crash('Ride ended');
            }}
          >
            END RIDE & COLLECT
          </button>
        </DialogContent>
      </Dialog>
    </main>
  );
}
