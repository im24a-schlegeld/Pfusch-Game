/** The six supplied road signs spell the existing Signs hoodie artwork. */
export const SIGN_IDS = ['P', 'F', 'U', 'S', 'C', 'H'] as const;
export type SignId = (typeof SIGN_IDS)[number];

export interface SignCollectibleDefinition {
  id: SignId;
  asset: string;
  /** Counterclockwise rotation when looking at the sign face. */
  rotation: number;
  shape: 'square' | 'rounded-square' | 'circle' | 'triangle';
  /** Crop UV coordinates in the unmodified supplied bitmap. */
  crop: readonly [number, number, number, number];
  sourceSize: readonly [number, number];
}

export const SIGN_COLLECTIBLES: readonly SignCollectibleDefinition[] = [
  {
    id: 'P',
    asset: '/assets/signs/p-parking.png',
    rotation: Math.PI / 15,
    shape: 'rounded-square',
    crop: [0, 0, 1, 1],
    sourceSize: [450, 450],
  },
  {
    id: 'F',
    asset: '/assets/signs/f-fire.png',
    rotation: -Math.PI / 60,
    shape: 'square',
    crop: [0, 0, 1, 1],
    sourceSize: [600, 600],
  },
  {
    id: 'U',
    asset: '/assets/signs/u-turn.png',
    rotation: Math.PI / 15,
    shape: 'circle',
    crop: [132 / 900, 0, 768 / 900, 1],
    sourceSize: [900, 640],
  },
  {
    id: 'S',
    asset: '/assets/signs/s-bends.png',
    rotation: Math.PI / 2,
    shape: 'triangle',
    crop: [20 / 920, 0, 899 / 920, 1],
    sourceSize: [920, 768],
  },
  {
    id: 'C',
    asset: '/assets/signs/c-turn.png',
    rotation: (7 * Math.PI) / 30,
    shape: 'circle',
    crop: [0, 0, 1, 1],
    sourceSize: [510, 510],
  },
  {
    id: 'H',
    asset: '/assets/signs/h-hospital.png',
    rotation: 0,
    shape: 'square',
    crop: [0, 0, 1, 1],
    sourceSize: [3840, 3840],
  },
];
