import { BufferGeometry, Float32BufferAttribute, MathUtils } from 'three';

/** A formed, open-rear protector around the local +Y slider axis. The outer
 * crown and recessed sides are moulded geometry, not a painted full tube.
 * Local coordinates and UV orientation match the previous guard so existing
 * saved decals still refer to the same moving assembly. */
export function supermotoForkGuardGeometry(length: number, side: number) {
  const rows = 28, columns = 30, stride = columns + 1;
  const skin = (rows + 1) * stride;
  const positions: number[] = [], uv: number[] = [], indices: number[] = [];
  for (const inset of [0, 0.0025]) for (let r = 0; r <= rows; r++) {
    const t = r / rows;
    const shoulder = MathUtils.smoothstep(t, 0.08, 0.78);
    const depth = MathUtils.lerp(0.035, 0.045, shoulder) - inset;
    for (let c = 0; c <= columns; c++) {
      const u = c / columns, angle = Math.PI * (0.40 + 1.2 * u);
      const s = Math.sin(angle), co = Math.cos(angle);
      // The inboard wing is narrower above the tyre shoulder; the outboard
      // face can flare without occupying the unchanged rotating wheel.
      const width = MathUtils.lerp(0.033, s * side < 0 ? 0.034 : 0.043, shoulder) - inset;
      const crest = 0.004 * Math.exp(-(((angle - Math.PI) / 0.36) ** 2))
        * Math.sin(Math.PI * t);
      // Side corners descend from the rounded centre crown; the small lower
      // paddle wraps the fasteners while leaving the rear of the slider open.
      const topTrim = (0.019 * s * s + 0.006 * Math.max(0, co)) * t ** 10;
      const bottomTrim = 0.009 * s * s * (1 - t) ** 10;
      // The left guard has a swept lower inboard cutout above the brake
      // rotor. The front paddle and outboard fastener support stay full length.
      const brakeRelief = side < 0 ? 0.130 * MathUtils.smoothstep(s, 0.08, 0.34) * (1 - t) : 0;
      positions.push(s * width, (t - 0.5) * length - topTrim + bottomTrim + brakeRelief,
        co * depth - crest - 0.003 * (1 - t) ** 4);
      uv.push(u, t);
    }
  }
  for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) {
    const a = r * stride + c, b = a + stride;
    indices.push(a, a + 1, b, a + 1, b + 1, b,
      a + skin, b + skin, a + 1 + skin, a + 1 + skin, b + skin, b + 1 + skin);
  }
  const rim: number[] = [];
  for (let c = 0; c < columns; c++) rim.push(c);
  for (let r = 0; r < rows; r++) rim.push(r * stride + columns);
  for (let c = columns; c > 0; c--) rim.push(rows * stride + c);
  for (let r = rows; r > 0; r--) rim.push(r * stride);
  for (let i = 0; i < rim.length; i++) {
    const a = rim[i], b = rim[(i + 1) % rim.length];
    indices.push(a, b, a + skin, b, b + skin, a + skin);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
