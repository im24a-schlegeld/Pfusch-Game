import type { BufferGeometry } from 'three';

/** Only the continuous roof/wall bodies are open-ended. Their concrete portal
 * supplies the real mouth face; caps on every recycled body span would compete
 * with that face and introduce artificial layers between adjoining spans. */
export function makeOpenTunnelBodyGeometry(source: BufferGeometry) {
  const geometry = source.clone();
  const positions = source.getAttribute('position'), sourceIndex = source.index;
  let near = Infinity, far = -Infinity;
  for (let i = 0; i < positions.count; i++) {
    near = Math.min(near, positions.getZ(i));
    far = Math.max(far, positions.getZ(i));
  }
  const sides: number[] = [];
  for (let i = 0; i < (sourceIndex?.count ?? positions.count); i += 3) {
    const indices = [0, 1, 2].map(j => sourceIndex ? sourceIndex.getX(i + j) : i + j);
    if ([near, far].some(end => indices.every(index => Math.abs(positions.getZ(index) - end) < 0.000001))) continue;
    sides.push(...indices);
  }
  geometry.setIndex(sides);
  geometry.clearGroups();
  geometry.name = 'open-tunnel-body';
  return geometry;
}
