# Supplied equipment assets

The game uses compact, synchronously decoded geometry. Source archives are kept outside the repository. Rebuilding requires Three.js and `meshoptimizer`; the exporters also support the existing isolated `.build-check` dependency installation.

## Integral helmet

Source: `RossiHelmet.zip`, **Normal/Solid/Helmet with visor.STL**. The assembled source is essential: independently positioning the printable visor produces the wrong eye opening. All shell and visor positions come from this assembled original and receive the same forward tilt. `Normal/Pieces/Version2/Helmet.STL` is used only to identify shell versus visor material.

```powershell
node scripts/build-rossi-helmet.mjs '<Normal/Pieces/Version2>' '<Normal/Solid/Helmet with visor.STL>'
```

The archive contains multipart RAR volumes. They must be read continuously. A partial extraction can leave a zero-filled file with a plausible STL header and length; do not use such an extraction. The assembled source has 307,542 triangles. The game export has 5,873 triangles and 84,234 packed bytes. Hidden lining is removed, while visible vents and the original shell shape remain.

The stable mesh name is `full-face-helmet`. Material slots remain shell paint (0), visor (1), and dark vent trim (2), preserving recoloring and sticker targeting.

## Cross helmet

Source: `motocross-helmet-by-radekc-model_files.zip`. Use the clean **thor_helmet_1.stl** and **thor_helmet_visor_1.stl** parts. The versions without `_1` include printing support geometry. The visor-named part is the helmet peak; the game's existing goggles remain separate equipment.

```powershell
node scripts/build-thor-helmet.mjs '<extracted Thor directory>'
```

Side lettering, the rear maker mark and the small printing hanger are removed; molded vents remain. The final export has 4,984 triangles and 60,168 packed bytes. The original goggle lens/frame retain their color controls. The fitted elastic band is 48 mm wide. Shell, peak, goggles and band share the integral helmet's −0.36-radian forward tilt. The `motocross-helmet` and `motocross-peak` surface names stay stable for decals.

## Cap and keychains

`node scripts/build-carried-cap.mjs '<obj.obj>'` retains one supplied cap and removes the stand, duplicates and dense stitch geometry. The 5,425-triangle asset uses real catalog artwork and colors and is carried at the hip. Keychain ignition mounts use per-bike cockpit targets and follow steering where their support moves.

## Dark carbon

`public/textures/carbon-dark.jpg` is the supplied color map reduced to 128 × 128 pixels (5,687 bytes). A shared object-space projection avoids requiring UV coordinates on imported equipment. The weave repeats seven times more densely than its initial preview. Source attribution is next to the texture.

Only one dark finish is offered. Motorcycle paint costs 3,000 Coins, helmet paint/visor 1,000 each, and rims 500. Preview is free; explicit Equip purchases and persists the finish through the existing ownership checks and save schema v1.

Both riding helmets use the same existing adult head transform and scale on all five motorcycles. No equipment import changes rider anatomy.
