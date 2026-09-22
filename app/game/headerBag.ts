import * as THREE from 'three';
export function headerBagMaterial(path: string) {
  const mat = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    roughness: 0.94,
    metalness: 0,
    transparent: true,
    alphaTest: 0.08,
    side: THREE.DoubleSide,
  });
  if (typeof document === 'undefined') return mat;
  // The decal plane is 118 × 58 mm. Matching pixel and physical aspect keeps
  // the supplied logo unchanged instead of stretching a portrait UV canvas.
  const canvas = document.createElement('canvas');
  canvas.width = 944;
  canvas.height = 464;
  const c = canvas.getContext('2d');
  if (!c) return mat;
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  mat.map = map;
  let disposed = false;
  mat.addEventListener('dispose', () => {
    disposed = true;
    map.dispose();
  });
  if (typeof Image !== 'undefined') {
    const im = new Image();
    im.onload = () => {
      if (disposed) return;
      const scratch = document.createElement('canvas');
      scratch.width = im.naturalWidth;
      scratch.height = im.naturalHeight;
      const ctx = scratch.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(im, 0, 0);
      const data = ctx.getImageData(0, 0, scratch.width, scratch.height).data;
      let l = scratch.width,
        r = 0,
        t = scratch.height,
        b = 0;
      for (let y = 0; y < scratch.height; y++)
        for (let x = 0; x < scratch.width; x++)
          if (data[(y * scratch.width + x) * 4 + 3] > 32) {
            l = Math.min(l, x);
            r = Math.max(r, x);
            t = Math.min(t, y);
            b = Math.max(b, y);
          }
      if (r <= l || b <= t) return;
      const k = Math.min(904 / (r - l + 1), 424 / (b - t + 1)),
        w = (r - l + 1) * k,
        h = (b - t + 1) * k;
      c.clearRect(0, 0, canvas.width, canvas.height);
      c.drawImage(
        im,
        l,
        t,
        r - l + 1,
        b - t + 1,
        (canvas.width - w) / 2,
        (canvas.height - h) / 2,
        w,
        h,
      );
      map.needsUpdate = true;
    };
    im.src = path;
  }
  return mat;
}
export function flatPouchGeometry() {
  const s = new THREE.Shape();
  s.moveTo(-0.074, -0.102);
  s.quadraticCurveTo(-0.094, -0.094, -0.096, -0.07);
  s.lineTo(-0.094, 0.058);
  s.quadraticCurveTo(-0.093, 0.086, -0.07, 0.096);
  s.lineTo(0.064, 0.094);
  s.quadraticCurveTo(0.089, 0.09, 0.094, 0.065);
  s.lineTo(0.098, -0.066);
  s.quadraticCurveTo(0.098, -0.09, 0.076, -0.098);
  s.lineTo(-0.045, -0.104);
  s.quadraticCurveTo(-0.06, -0.105, -0.074, -0.102);
  const g = new THREE.ExtrudeGeometry(s, {
    depth: 0.04,
    bevelEnabled: true,
    bevelThickness: 0.0032,
    bevelSize: 0.004,
    bevelSegments: 3,
    steps: 1,
    curveSegments: 14,
  });
  g.translate(0, 0, -0.024);
  const p = g.getAttribute('position'),
    uv = g.getAttribute('uv');
  for (let i = 0; i < p.count; i++)
    uv.setXY(i, 0.5 + p.getX(i) / 0.205, (p.getY(i) + 0.115) / 0.23);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i),
      z = p.getZ(i),
      bulge = (1 - Math.min(1, Math.abs(y) / 0.115)) * 0.008;
    p.setZ(i, z + (z > 0 ? bulge : -bulge * 0.35));
  }
  g.computeVertexNormals();
  return g;
}
