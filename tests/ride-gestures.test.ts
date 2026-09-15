import { describe, expect, it } from 'vitest';
import { RideGestures } from '../app/ui/rideGestures';
import { Engine } from '../app/game/engine';
import { BIKES } from '../app/domain/config';
function fixture() {
  const engine = new Engine(BIKES[0]);
  engine.start();
  let pauses = 0;
  const gesture = new RideGestures({
    weight: (value) => engine.weight(value),
    move: (direction) => engine.move(direction),
    togglePause: () => {
      pauses++;
      if (engine.phase === 'playing') engine.pause();
      else engine.resume();
    },
  });
  return { engine, gesture, pauses: () => pauses };
}
describe('gesture-only ride input', () => {
  it('starts neutral, meters both weights and steers with the same captured finger', () => {
    const { engine, gesture } = fixture();
    gesture.down(1, 100, 200, 0);
    expect(engine.touchWeight).toBe(0);
    gesture.move(1, 100, 207);
    expect(engine.touchWeight).toBe(0);
    gesture.move(1, 100, 244);
    expect(engine.touchWeight).toBe(0.5);
    gesture.move(1, 145, 244);
    expect([engine.lane, engine.touchWeight]).toEqual([1, 0.5]);
    gesture.move(1, 100, 244);
    expect([engine.lane, engine.touchWeight]).toEqual([0, 0.5]);
    gesture.move(1, 100, 120);
    expect(engine.touchWeight).toBe(-1);
    gesture.up(1, 500);
    expect(engine.touchWeight).toBe(0);
  });
  it('never releases keyboard ownership when a pointer is cancelled', () => {
    const { engine, gesture } = fixture();
    engine.hold(true);
    gesture.down(1, 100, 200, 0);
    gesture.move(1, 100, 120);
    gesture.cancel(99);
    expect(engine.forwardInput).toBe(1);
    gesture.cancel(1);
    expect([engine.throttleInput, engine.forwardInput]).toEqual([1, 0]);
    gesture.move(1, 100, 300);
    expect(engine.touchWeight).toBe(0);
  });
  it('keeps the first finger as owner and ignores cancellation of an unrelated second finger', () => {
    const { engine, gesture } = fixture();
    gesture.down(1, 100, 200, 0);
    gesture.move(1, 100, 280);
    gesture.down(2, 200, 200, 400);
    gesture.move(2, 200, 120);
    gesture.cancel(2);
    expect(engine.touchWeight).toBe(1);
    gesture.up(1, 700);
    expect(engine.touchWeight).toBe(0);
  });
  it('accepts a fresh stationary two-finger tap only after both fingers release', () => {
    const { engine, gesture, pauses } = fixture();
    gesture.down(1, 100, 200, 0);
    gesture.down(2, 145, 200, 40);
    gesture.up(1, 100);
    expect(pauses()).toBe(0);
    gesture.up(2, 140);
    expect(pauses()).toBe(1);
    expect(engine.phase).toBe('paused');
    gesture.down(3, 100, 200, 500);
    gesture.down(4, 145, 200, 520);
    gesture.up(4, 550);
    gesture.up(3, 580);
    expect(pauses()).toBe(2);
    expect(engine.phase).toBe('playing');
  });
  it('does not confuse a long hold, moving pair or cancellation with pause', () => {
    for (const mode of ['long', 'move', 'cancel']) {
      const { gesture, pauses } = fixture();
      gesture.down(1, 100, 200, 0);
      gesture.down(2, 145, 200, 40);
      if (mode === 'move') gesture.move(2, 180, 200);
      if (mode === 'cancel') gesture.cancel(1);
      gesture.up(1, mode === 'long' ? 600 : 150);
      gesture.up(2, mode === 'long' ? 620 : 170);
      expect(pauses()).toBe(0);
    }
  });
  it('leaves the one airborne lane correction owned by the engine', () => {
    const { engine, gesture } = fixture();
    engine.height = 1;
    gesture.down(1, 100, 200, 0);
    gesture.move(1, 145, 200);
    gesture.move(1, 100, 200);
    expect(engine.lane).toBe(1);
    expect(engine.airLaneChangeUsed).toBe(true);
  });
});
