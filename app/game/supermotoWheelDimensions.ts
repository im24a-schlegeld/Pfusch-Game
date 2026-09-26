/** Metres in the unscaled 450 model; wheel axis X, front of the bike -Z.
 * These are chosen construction sizes, not measurements taken from a photo.
 * A nominal 17-inch bead seat is distinct from the outer visible alloy lip.
 * Keep this data module independent of Three.js for physics/domain imports. */
export const SUPERMOTO_WHEELS = Object.freeze({
  front: Object.freeze({
    outerRadius: 0.2999,
    tireWidth: 0.12,
    beadRadius: 0.2159,
    rimEdgeRadius: 0.2239,
    rimWidth: 0.0889,
    hubHalfWidth: 0.058,
    hubRadius: 0.032,
    spokeHubX: 0.043,
    spokeHubRadius: 0.047,
    spokeBedRadius: 0.2039,
    brakeMountX: -0.085,
  }),
  rear: Object.freeze({
    outerRadius: 0.3059,
    tireWidth: 0.15,
    beadRadius: 0.2159,
    rimEdgeRadius: 0.2239,
    rimWidth: 0.10795,
    hubHalfWidth: 0.065,
    hubRadius: 0.035,
    spokeHubX: 0.05,
    spokeHubRadius: 0.047,
    spokeBedRadius: 0.2039,
    brakeMountX: 0.105,
  }),
});
