import { recomputeWeldedNormals } from './motorcycle-tire-normals.mjs';

/** Normals for the supplied circular hoop, without changing any topology. */
export function recomputeHoopNormals(positions, indices, axle) {
  const expanded = new Float32Array(indices.length * 3);
  for (let i = 0; i < indices.length; i++) expanded.set(positions.subarray(indices[i] * 3, indices[i] * 3 + 3), i * 3);
  const smooth = recomputeWeldedNormals(expanded), normals = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i++) normals.set(smooth.subarray(i * 3, i * 3 + 3), indices[i] * 3);
  // A revolved hoop has one axial/radial normal per circular profile ring.
  // Average triangle-weighting differences around that ring, then rotate its
  // radial component with each vertex. This retains natural light response.
  const profiles = new Map();
  for (let i = 0; i < positions.length; i += 3) {
    const key = Math.round(positions[i] * 100000);
    const y = positions[i + 1] - axle[1], z = positions[i + 2] - axle[2], radius = Math.hypot(y, z);
    if (!profiles.has(key)) profiles.set(key, { axial: 0, radial: 0, min: Infinity, max: 0 });
    const profile = profiles.get(key);
    profile.axial += normals[i];
    profile.radial += (normals[i + 1] * y + normals[i + 2] * z) / radius;
    profile.min = Math.min(profile.min, radius); profile.max = Math.max(profile.max, radius);
  }
  for (const profile of profiles.values()) {
    if (profile.max - profile.min > .0002) throw new Error('Expected a circular source hoop profile.');
    const length = Math.hypot(profile.axial, profile.radial);
    if (length < 1e-8) throw new Error('Degenerate source hoop normal profile.');
    profile.axial /= length; profile.radial /= length;
  }
  for (let i = 0; i < positions.length; i += 3) {
    const profile = profiles.get(Math.round(positions[i] * 100000));
    const y = positions[i + 1] - axle[1], z = positions[i + 2] - axle[2], radius = Math.hypot(y, z);
    normals.set([profile.axial, profile.radial * y / radius, profile.radial * z / radius], i);
  }
  return normals;
}
