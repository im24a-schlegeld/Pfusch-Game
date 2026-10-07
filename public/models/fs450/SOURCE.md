# Supermoto wheel geometry

Source: user-supplied `2022_Husqavarna_FS_450.usdz`. Rebuild with `node scripts/build-fs450-asset.mjs <source.usdz> <KTM_450_EXC_Final.usdz>` and then the imported-bike dimension sync script.

The source rear sprocket, `Object_10`, consists of two solid 34-triangle faces. Its `mat_gear277_COLOR_0_baseColor.jpg` paints the intended openings light gray and has no opacity data. The offline `motorcycle-sprocket.mjs` converter traces that supplied mask within the original UV footprint and extrudes the metal to the original disc thickness. It preserves the source center bore, six broad slots, twelve bolt openings, and outer tooth gaps as actual empty space. Contour simplification stays within one source-image pixel; no opaque texture remains across the openings.

Only the sprocket faces are replaced. The separate rim/spoke meshes, hub, chain, brake rotors, axle anchors and rider contacts are retained. The sprocket uses a fixed dark steel material independent of rim customization. The imported headlight-mask source and existing bike restyling remain part of the build.

For uniform selectable rim brightness, the separate 1,024-triangle hoop component in each of `Object_4` and `Object_5` is exported as `fs450_rim_hoop` (`rim: true`). All source hoop faces remain intact, without a baked texture. The runtime applies an unlit material only to those hoops; hub, spokes and valve hardware use a fixed silver lit finish (`mat_rim277_001`, `rim: false`, `#c6cbd0`). Their source geometry and reduction ratio are preserved after separating the hoops. No original wheel color atlas is required.

Source ownership and licensing remain with the user-supplied assets; no additional licence is inferred here.
