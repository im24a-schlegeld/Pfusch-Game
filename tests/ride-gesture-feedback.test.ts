import { describe, expect, it, vi } from 'vitest';
import { RideGestures, RIDE_GESTURE } from '../app/ui/rideGestures';
import { gestureIndicatorView, updateGestureIndicator } from '../app/ui/rideGestureIndicator';

const bounds = { left: 12, top: 20, width: 390, height: 844 };
function fixture() {
  let input = 0;
  const actions = { weight: (value: number) => { input = value; }, move: vi.fn(), togglePause: vi.fn() };
  return { gestures: new RideGestures(actions), actions, input: () => input };
}
function indicator() {
  const nodes = new Map<string, { attributes: Record<string, string>; textContent: string; setAttribute(key: string, value: string): void }>();
  const root = { dataset: {} as Record<string, string>, querySelector(selector: string) {
    if (!nodes.has(selector)) nodes.set(selector, { attributes: {}, textContent: '', setAttribute(key, value) { this.attributes[key] = value; } });
    return nodes.get(selector)!;
  } };
  return { root: root as unknown as SVGSVGElement, nodes, dataset: root.dataset };
}

describe('touch drag feedback follows the real gesture owner', () => {
  it('draws from the real touch origin to the finger and shows the exact applied proportion', () => {
    const { gestures, input } = fixture();
    gestures.down(1, 100, 200, 0);
    for (const displacement of [0, 7, 10, 48, 86, 200, -48, -500]) {
      gestures.move(1, 115, 200 + displacement);
      const feedback = gestures.feedback()!;
      const view = gestureIndicatorView(feedback, bounds);
      expect(feedback.weight).toBe(input());
      expect(view).toMatchObject({ startX: 88, startY: 180, x: 103, y: 180 + displacement });
      expect(view.strength).toBe(Math.abs(input()));
      expect(view.strength).toBeGreaterThanOrEqual(0);
      expect(view.strength).toBeLessThanOrEqual(1);
      expect(view.range).toBe(RIDE_GESTURE.weightDeadZone + RIDE_GESTURE.weightPixels);
    }
    gestures.move(1, 100, 248);
    expect(gestureIndicatorView(gestures.feedback()!, bounds).label).toBe('ANHEBEN · 50 %');
    gestures.move(1, 100, 152);
    expect(gestureIndicatorView(gestures.feedback()!, bounds).label).toBe('SENKEN · 50 %');
  });
  it.each(['release', 'cancel', 'blur/pause'] as const)('hides immediately on %s with no stale strength', mode => {
    const { gestures, input } = fixture(), view = indicator();
    gestures.down(1, 100, 200, 0); gestures.move(1, 100, 248);
    updateGestureIndicator(view.root, gestures.feedback(), bounds);
    expect(view.dataset.active).toBe('true');
    expect(view.dataset.strength).toBe('0.500');
    expect(view.nodes.get('[data-part="vector"]')!.attributes).toEqual({ x1: '88', y1: '180', x2: '88', y2: '228' });
    if (mode === 'release') gestures.up(1, 400);
    else if (mode === 'cancel') gestures.cancel(1);
    else gestures.cancel();
    updateGestureIndicator(view.root, gestures.feedback(), bounds);
    expect(view.dataset.active).toBe('false');
    expect(input()).toBe(0);
    expect(gestures.feedback()).toBeNull();
  });
  it('hides for a two-finger pause and does not transfer the line to the remaining finger', () => {
    const { gestures, input, actions } = fixture();
    gestures.down(1, 100, 200, 0);
    gestures.down(2, 160, 200, 40);
    expect(gestures.feedback()).toBeNull();
    expect(input()).toBe(0);
    gestures.up(1, 100);
    expect(gestures.feedback()).toBeNull();
    gestures.up(2, 140);
    expect(actions.togglePause).toHaveBeenCalledOnce();
    expect(gestures.feedback()).toBeNull();
  });
  it('ignores an unrelated late finger and retains the input owner on its cancellation', () => {
    const { gestures, input } = fixture();
    gestures.down(1, 100, 200, 0); gestures.move(1, 100, 248);
    gestures.down(2, 260, 300, 400); gestures.move(2, 300, 100);
    gestures.cancel(2);
    expect(gestures.feedback()).toMatchObject({ x: 100, y: 248, weight: .5 });
    expect(input()).toBe(.5);
  });
  it('preserves one lane change per swipe while the vector follows the finger', () => {
    const { gestures, actions } = fixture();
    gestures.down(1, 100, 200, 0);
    gestures.move(1, 150, 200); gestures.move(1, 200, 200);
    expect(actions.move).toHaveBeenCalledExactlyOnceWith(1);
    expect(gestures.feedback()).toMatchObject({ x: 200, y: 200, swiped: true, weight: 0 });
    expect(gestureIndicatorView(gestures.feedback()!, bounds).label).toBe('AUSWEICHEN');
  });
  it('keeps the label within narrow screen edges without moving the touch vector', () => {
    const { gestures } = fixture();
    gestures.down(1, 2, 2, 0); gestures.move(1, 2, 3);
    const view = gestureIndicatorView(gestures.feedback()!, { left: 0, top: 0, width: 320, height: 568 });
    expect(view.x).toBe(2);
    expect(view.labelX).toBe(76);
    expect(view.labelY).toBe(30);
  });
});
