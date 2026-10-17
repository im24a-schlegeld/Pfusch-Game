/** Crops of the original published cap embroidery; blank sides stay blank. */
export interface CapPrint { source: string; crop: number[]; x: number; y: number; width: number; height: number; brightOnly: boolean }
export const CAP_PRINTS: Readonly<Record<string, readonly CapPrint[]>> = {
  'p-zero-cap': [{ source: '/images/preview/p-zero-cap-schwarz-back.png', crop: [302, 272, 45, 82], x: 252, y: 490, width: 24, height: 180, brightOnly: true }],
  'logo-cap-1': [{ source: '/images/preview/logo-cap-1-schwarz-back.png', crop: [302, 272, 45, 82], x: 252, y: 490, width: 24, height: 180, brightOnly: true }],
  'pfusch-logo-cap': [{ source: '/images/preview/pfusch-logo-cap-original-right.jpg', crop: [620, 1158, 325, 210], x: 0, y: 820, width: 95, height: 190, brightOnly: false }],
};
