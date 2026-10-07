import { describe, expect, it } from 'vitest';
import { BIKES } from '../app/domain/config';
import { Engine } from '../app/game/engine';
import { RideHeldInput } from '../app/ui/rideHeldInput';
import { RideGestures } from '../app/ui/rideGestures';
import { tutorialGestureIntent } from '../app/ui/tutorialGesture';

function fixture() {
  const engine = new Engine(BIKES[0], 42);
  engine.start();
  const input = new RideHeldInput((action, held) => action === 'wheelie' ? engine.hold(held) : engine.forward(held));
  return { engine, input };
}

describe('held touch ride controls', () => {
  it('holds both controls independently and releases only the lifted finger', () => {
    const { engine, input } = fixture();
    input.press(1, 'wheelie'); input.press(2, 'brake');
    expect([engine.throttleInput, engine.forwardInput]).toEqual([1, 1]);
    input.release(1);
    expect([engine.throttleInput, engine.forwardInput]).toEqual([0, 1]);
    input.release(2);
    expect([engine.throttleInput, engine.forwardInput]).toEqual([0, 0]);
  });
  it('handles duplicate, unrelated and repeated pointer releases without stealing another hold', () => {
    const { engine, input } = fixture();
    input.press(1, 'wheelie'); input.press(1, 'brake'); input.press(2, 'wheelie');
    input.release(99); input.release(1); input.release(1);
    expect(engine.throttleInput).toBe(1);
    expect(engine.forwardInput).toBe(0);
    input.release(2);
    expect(engine.throttleInput).toBe(0);
  });
  it('transfers to the keyboard and preserves another keyboard key on release', () => {
    const { engine, input } = fixture();
    input.press(1, 'wheelie'); input.key('s', 'wheelie', true); input.key('arrowdown', 'wheelie', true);
    input.clearPointers(); input.key('s', 'wheelie', false);
    expect(engine.throttleInput).toBe(1);
    input.key('arrowdown', 'wheelie', false);
    expect(engine.throttleInput).toBe(0);
  });
  it('clears all owners on pause, blur and cancellation so nothing returns after resuming', () => {
    const { engine, input } = fixture();
    input.press(1, 'wheelie'); input.press(2, 'brake'); input.key('s', 'wheelie', true);
    input.clear(); engine.pause(); engine.resumeTutorial(); input.release(1);
    expect(input.hasPointers()).toBe(false);
    expect([engine.throttleInput, engine.forwardInput]).toEqual([0, 0]);
    input.press(3, 'brake');
    expect([engine.throttleInput, engine.forwardInput]).toEqual([0, 1]);
  });
  it('continues lateral swipe steering while buttons exclusively own vertical input', () => {
    const { engine, input } = fixture();
    const gestures = new RideGestures({ weight: () => engine.weight(0), move: direction => engine.move(direction), togglePause: () => engine.pause() });
    input.press(1, 'wheelie');
    gestures.down(2, 100, 200, 0); gestures.move(2, 100, 120);
    expect([engine.throttleInput, engine.forwardInput]).toEqual([1, 0]);
    gestures.move(2, 200, 120);
    expect(engine.lane).toBe(1);
    gestures.up(2, 500);
    expect(engine.throttleInput).toBe(1);
    input.release(1);
    expect(engine.throttleInput).toBe(0);
  });
  it('requires horizontal tutorial intent when vertical swipes are disabled', () => {
    expect(tutorialGestureIntent(0, 80, false)).toBe(false);
    expect(tutorialGestureIntent(60, 0, false)).toBe(true);
    expect(tutorialGestureIntent(0, 80)).toBe(true);
  });
});
