/** Shared distance layout keeps roadworks/spawns consistent with the rendered world. */
export const ROAD_LOOP = 576;
export const TUNNEL_START = 288;
export const TUNNEL_END = 384;
export type RoadSection = 'urban' | 'industrial' | 'tunnel' | 'open';
export const roadProgress = (distance: number) =>
  ((distance % ROAD_LOOP) + ROAD_LOOP) % ROAD_LOOP;
export function roadSection(distance: number): RoadSection {
  const p = roadProgress(distance);
  return p < 144
    ? 'urban'
    : p < TUNNEL_START
      ? 'industrial'
      : p < TUNNEL_END
        ? 'tunnel'
        : 'open';
}
export function tunnelShade(distance: number) {
  const p = roadProgress(distance);
  return Math.max(
    0,
    Math.min(1, (p - TUNNEL_START + 3) / 12, (TUNNEL_END + 3 - p) / 12),
  );
}
