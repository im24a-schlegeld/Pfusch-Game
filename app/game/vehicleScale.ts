export type BikeModelId = '125' | 'scooter' | '450' | '701';

/** Motorcycle size relative to the shared, immutable adult rider. */
export const BIKE_MODEL_SCALES: Readonly<Record<BikeModelId, number>> =
  Object.freeze({
    '125': 1,
    scooter: 1,
    '450': 1.12,
    '701': 1.12,
  });
