# Plain racing helmet asset

The full-face helmet is derived from the supplied `Motorcycle_helmet_-_racing_helmet.usdz`. The outer shell, visor, pivots, front vents and lower seal remain recognizable; all graphic textures, the separate logo strip, straps, buckle, hidden lining and raised rear outlet are removed. A smooth rear skirt and restrained chin shaping give it a generic racing profile. The underside has a thin dark closure instead of a hidden padded interior.

Rebuild locally with:

```powershell
node scripts/build-fullface-helmet.mjs 'C:/Users/dario/Downloads/Motorcycle_helmet_-_racing_helmet.usdz'
```

The exporter simplifies the source's 134,942 triangles to 5,463 triangles / 2,940 vertices and packs 68,058 bytes of geometry into the generated TypeScript asset. It transforms normals with the deformation's inverse-transpose Jacobian. No source textures or external runtime model requests are needed.

Material slots remain shell paint (0), selectable visor (1), and dark trim (2). The `full-face-helmet` surface name remains compatible with projected stickers. Every bike receives the same adult-size mesh and existing uniform 1.065 helmet scale; motocross geometry is unchanged.
