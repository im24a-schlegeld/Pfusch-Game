import { CanvasTexture, MeshStandardMaterial, RepeatWrapping } from 'three';

let tread: CanvasTexture | undefined;

/** One small shared bump map; the road tyre silhouette and contact radius stay exact. */
export function supermotoTireMaterial(base: MeshStandardMaterial) {
  if (typeof document === 'undefined') return base;
  if (!tread) {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) return base;
    context.fillStyle = '#ababab';
    context.fillRect(0, 0, 1024, 256);
    context.strokeStyle = '#303030';
    context.lineCap = 'round';
    context.lineWidth = 4;
    // Lathe U runs around the wheel, V across the carcass. Restrict the
    // staggered water channels to the tread; sidewalls remain smooth.
    for (let x = -64; x <= 1088; x += 64) {
      for (const side of [-1, 1]) {
        const offset = side > 0 ? 27 : 0;
        context.beginPath();
        context.moveTo(x + offset, 128 + side * 8);
        context.bezierCurveTo(x + offset + 9, 128 + side * 24,
          x + offset + 24, 128 + side * 42, x + offset + 29, 128 + side * 59);
        context.stroke();
      }
    }
    tread = new CanvasTexture(canvas);
    tread.wrapS = RepeatWrapping;
    tread.anisotropy = 4;
  }
  const finish = base.clone();
  finish.bumpMap = tread;
  finish.bumpScale = 0.0014;
  finish.roughness = 0.88;
  return finish;
}
