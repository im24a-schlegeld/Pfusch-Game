/** Small, synchronous authored datums shared with deterministic wheelie physics.
 * Source values are exported from each public model manifest, independently of
 * asynchronous geometry/texture loading. Front points toward negative Z. */
export const IMPORTED_BIKE_WHEELBASE = Object.freeze({ '450': 1.472, '701': 1.37, scooter: 1.28 });
const source = {
  '450': { wheelbase: 1.4236062, frontZ: -0.7118031, frontRadius: 0.27893153578042984, rearZ: 0.7118031, rearRadius: 0.3128700330853462, tail: [0, 0.9832977, 0.9828611] },
  '701': { wheelbase: 1.3766828, frontZ: -0.6883414, frontRadius: 0.29468526454729727, rearZ: 0.6883414, rearRadius: 0.32222216576337814, tail: [0, 1.0247752, 0.945291] },
  scooter: { wheelbase: 1.3294108, frontZ: -0.6647054, frontRadius: 0.2445964828133583, rearZ: 0.6647054, rearRadius: 0.24459646699484439, tail: [0, 0.8872801, 0.8215597] },
} as const;
function datum(id: keyof typeof source) {
  const value = source[id], size = IMPORTED_BIKE_WHEELBASE[id] / value.wheelbase;
  return Object.freeze({
    tail: value.tail.map((coordinate) => coordinate * size) as [number, number, number],
    rearAxle: value.rearZ * size,
    rearRadius: value.rearRadius * size,
    frontAxle: value.frontZ * size,
    frontRadius: value.frontRadius * size,
  });
}
export const IMPORTED_BIKE_TAIL = Object.freeze({ '450': datum('450'), '701': datum('701'), scooter: datum('scooter') });
