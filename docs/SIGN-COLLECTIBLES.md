# PFUSCH sign collectibles — 15 September 2026

The six signs come from the user's accepted images **1, 2, 3, 6, 7 and 8**, in
P F U S C H order. Images 4 and 5 were explicitly excluded. The PNG files in
`public/assets/signs/` are byte-for-byte copies; `manifest.json` records the
original filenames, dimensions and SHA-256 hashes.

The existing, source-derived `public/images/artwork/signs.png` and the back of
`public/images/preview/signs-hoodie-braun-back.png` establish the composition.
The first is the reference for the approximate in-plane rotations:

| Sign | Supplied image | Rotation seen from its front |
| --- | --- | --- |
| P / parking | 1 | 12° counterclockwise |
| F / fire point | 2 | 3° clockwise |
| U / U-turn | 3 | 12° counterclockwise |
| S / successive bends | 6, transparent version | 90° counterclockwise, triangle pointing left |
| C / mandatory right turn | 7 | 42° counterclockwise, arrow curling up and right |
| H / hospital | 8 | Upright |

No letter or arrow was redrawn or mirrored. The U and S texture UVs remove
transparent source margins. Circle geometry clips the original circular signs;
the transparent warning sign retains its original silhouette. The game renderer
decodes at most a 512px bitmap per sign (256px at low quality), including the
3840px H source, without modifying or replacing any source file.

`signCollectibles.ts` contains only pure definitions for the deterministic engine.
`signCollectibleView.ts` owns a fixed mesh pool, six shared textures, their small
metal backing plates and cleanup. The original orientation remains fixed during
the gentle collectible bob, so every sign stays readable. Late image loads are
closed after unmount instead of retaining image resources.

Visual source review: `outputs/sign-originals-rendered.png` (local QA artifact).
Integration and game reward verification are recorded with the current pass.
