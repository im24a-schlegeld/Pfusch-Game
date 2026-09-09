/** Shared by the Garage proof and its garment CanvasTexture. Never draw a fallback. */
let ready: Promise<void> | undefined;
export function loadNumberFont(): Promise<void> {
  return (ready ??= document.fonts
    .load('700 220px "Merriweather"', '0123456789')
    .then((faces) => {
      if (!faces.length || faces.some((face) => face.status !== 'loaded')) {
        throw new Error(
          'Merriweather could not load for the clothing back number.',
        );
      }
      const ctx = document.createElement('canvas').getContext('2d')!;
      ctx.font = '700 220px "Merriweather"';
      // This also detects an incomplete subset or a browser ignoring the face features.
      const two = ctx.measureText('2'),
        three = ctx.measureText('3');
      if (three.actualBoundingBoxDescent - two.actualBoundingBoxDescent < 20) {
        throw new Error(
          'Merriweather oldstyle numerals are unavailable for the clothing back number.',
        );
      }
    })
    .catch((error) => {
      ready = undefined;
      throw error;
    }));
}
