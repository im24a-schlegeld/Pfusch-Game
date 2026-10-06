import { RIDE_GESTURE, type RideGestureFeedback } from './rideGestures';

export interface GestureBounds { left: number; top: number; width: number; height: number }
export function gestureIndicatorView(feedback: RideGestureFeedback, bounds: GestureBounds) {
  const startX = feedback.startX - bounds.left, startY = feedback.startY - bounds.top;
  const x = feedback.x - bounds.left, y = feedback.y - bounds.top;
  const strength = Math.min(1, Math.abs(feedback.weight));
  const direction = feedback.weight > 0 ? 'ANHEBEN' : feedback.weight < 0 ? 'SENKEN' : feedback.swiped ? 'AUSWEICHEN' : 'ZIEHEN';
  return { startX, startY, x, y, strength,
    label: strength > 0 ? `${direction} · ${Math.round(strength * 100)} %` : direction,
    labelX: Math.max(76, Math.min(bounds.width - 76, x)),
    labelY: Math.max(30, Math.min(bounds.height - 20, y - 38)),
    range: RIDE_GESTURE.weightDeadZone + RIDE_GESTURE.weightPixels };
}

/** Pointer events update seven small SVG nodes directly, with no render loop or
 * React state update. The vector remains at the actual finger; strength clamps. */
export function updateGestureIndicator(root: SVGSVGElement | null, feedback: RideGestureFeedback | null, bounds?: GestureBounds) {
  if (!root) return;
  root.dataset.active = feedback && bounds ? 'true' : 'false';
  if (!feedback || !bounds) return;
  const view = gestureIndicatorView(feedback, bounds);
  const update = (name: string, attributes: Record<string, number | string>) => {
    const node = root.querySelector(`[data-part="${name}"]`);
    if (node) for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  };
  update('range', { x1: view.startX, x2: view.startX, y1: view.startY - view.range, y2: view.startY + view.range });
  update('vector-shadow', { x1: view.startX, y1: view.startY, x2: view.x, y2: view.y });
  update('vector', { x1: view.startX, y1: view.startY, x2: view.x, y2: view.y });
  update('origin', { cx: view.startX, cy: view.startY });
  update('finger', { transform: `translate(${view.x} ${view.y})` });
  update('strength', { 'stroke-dashoffset': 100 * (1 - view.strength) });
  update('label', { transform: `translate(${view.labelX} ${view.labelY})` });
  const text = root.querySelector('[data-part="label-text"]');
  if (text) text.textContent = view.label;
  root.dataset.strength = view.strength.toFixed(3);
}
