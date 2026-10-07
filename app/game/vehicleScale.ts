export type BikeModelId = '125' | 'scooter' | 'moped' | '450' | '701';

/** Motorcycle size relative to the shared, immutable adult rider. */
export const BIKE_MODEL_SCALES: Readonly<Record<BikeModelId, number>> =
  Object.freeze({
    '125': 1,
    scooter: 1.24,
    moped: 1.25,
    '450': 1.14,
    '701': 1.18,
  });
