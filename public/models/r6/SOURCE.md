# Sport sprocket geometry

Source: user-supplied `Yamaha_YZF-R6_3rd_Gen.usdz`. Rebuild with `node scripts/build-r6-asset.mjs <source.usdz>` and then the imported-bike dimension sync script.

The source rear sprocket, `Object_2`, contains two solid 34-triangle faces. Its `mat_gear624_baseColor.png` carries the native alpha mask for six broad outer slots, six inner hub openings and the outer tooth gaps. The offline `motorcycle-sprocket.mjs` converter traces that exact alpha within the original UV footprint and extrudes the metal to the original disc thickness. Contour simplification stays within one source-image pixel. The 12 enclosed openings are real empty space, with modeled walls; the center remains the supplied solid mounting face.

The original silver finish is retained in a separate `r6_sprocket_metal` material. The chain, rim/spokes, all other parts and their existing simplification allocations are preserved. Bike proportions, rider contacts and existing body restyling are unchanged. The new sprocket has 2,188 triangles.

Source ownership and licensing remain with the user-supplied asset; no additional licence is inferred here.
