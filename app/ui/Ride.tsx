import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Pause,
  Volume2,
  VolumeX,
} from 'lucide-react';
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
interface Props {
  player: Player;
  products: Product[];
  audio: GameAudio;
  onFinish: (r: RunStats) => void;
  onMute: () => void;
}
export default function Ride({
  player,
  products,
  audio,
  onFinish,
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
  const done = useRef(false);
  const lastEvent = useRef(0);
  const eventTime = useRef(0);
  const gesture = useRef<{ x: number; y: number } | null>(null);
  const finish = useRef(onFinish);
  finish.current = onFinish;
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
          ' ',
          'a',
          'd',
          'w',
          'A',
          'D',
          'W',
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
      if (e.key === 'ArrowUp' || e.key.toLowerCase() === 'w') engine.jump();
      if (e.code === 'Space') engine.hold(true);
    };
    const keyup = (e: KeyboardEvent) => {
      if (e.code === 'Space') engine.hold(false);
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
  function frame(e: Engine) {
    audio.update(e.speed, e.wheelie, e.phase === 'playing');
    if (e.event.serial !== lastEvent.current) {
      lastEvent.current = e.event.serial;
      eventTime.current = performance.now();
      audio.cue(e.phase === 'crashed');
    }
    setTick((n) => n + 1);
    if (e.phase === 'crashed' && !done.current) {
      done.current = true;
      finish.current(e.stats());
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
      />
      <div
        className="gesture-zone"
        aria-label="Swipe left or right to dodge, swipe up to jump"
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
          else if (dy < 0) engine.jump();
        }}
        onPointerCancel={() => {
          gesture.current = null;
          engine.clearInput();
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
            onClick={pause}
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
          <p>Dodge traffic. Jump low barriers.</p>
        </div>
      )}
      {engine.elapsed < 9 && countdown === 0 && (
        <div className="ride-tip">SWIPE TO DODGE · ↑ JUMP · HOLD WHEELIE</div>
      )}
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
        <div className="action-controls">
          <button
            className="jump-control"
            aria-label="Jump"
            onPointerDown={(e) => {
              e.preventDefault();
              engine.jump();
            }}
          >
            <ArrowUp />
            <span>JUMP</span>
          </button>
          <button
            className={`wheelie-control ${engine.wheelie ? 'held' : ''}`}
            aria-label="Hold wheelie"
            onPointerDown={(e) => {
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              engine.hold(true);
            }}
            onPointerUp={() => engine.hold(false)}
            onPointerCancel={() => engine.hold(false)}
            onLostPointerCapture={() => engine.hold(false)}
          >
            <span>WHEELIE</span>
            <div className="heat">
              <i
                style={{
                  width: `${engine.wheelieHeat * 100}%`,
                  background: engine.wheelieHeat > 0.75 ? '#ec8b59' : undefined,
                }}
              />
            </div>
            <small>
              {engine.wheelieHeat > 0.75 ? 'RELEASE TO COOL' : 'HOLD'}
            </small>
          </button>
        </div>
      </div>
      <Dialog
        open={engine.phase === 'paused'}
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
              ↑ / W <b>Jump</b>
            </span>
            <span>
              SPACE <b>Hold wheelie</b>
            </span>
            <span>
              ESC / P <b>Pause</b>
            </span>
          </div>
          <p className="muted">
            Release wheelie before the balance bar fills. Jump the low striped
            barriers; dodge cars and vans.
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
