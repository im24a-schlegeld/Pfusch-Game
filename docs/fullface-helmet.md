# Plain racing helmet asset

The full-face helmet is derived from the supplied `Motorcycle_helmet_-_racing_helmet.usdz`. The original shell, chin and rear neck opening are retained. Only the bottom front edge is tucked inward by up to 1.1 mm, and the visor's upper edge is raised about 4.3 mm with the adjoining brow blended into the unchanged crown. Graphic textures, the separate logo strip, raised forehead intake, integrated rear spoiler/outlet, side fasteners, lower rear seal, straps, buckle and hidden lining are removed. The complete helmet is fitted 12 mm forward locally, without changing the rider's head target, skeleton or helmet dimensions.

Rebuild locally with:

```powershell
node scripts/build-fullface-helmet.mjs 'C:/Users/dario/Downloads/Motorcycle_helmet_-_racing_helmet.usdz'
```

The small shell perforations below the removed forehead intake are closed along their original borders. The exporter simplifies the source's 134,942 triangles to 4,478 triangles / 2,369 vertices and packs 55,296 bytes of geometry into the generated TypeScript asset. It transforms normals with the deformation's inverse-transpose Jacobian. No source textures or external runtime model requests are needed.

Material slots remain shell paint (0), selectable visor (1), and dark trim (2). The `full-face-helmet` surface name remains compatible with projected stickers. Every bike receives the same adult-size mesh and existing uniform 1.065 helmet scale; motocross geometry is unchanged.
