# Fresh garment review — 2026-09-09

Implementation follow-up, 2026-09-10: findings 1–5 below were corrected (normalized color lookup, aligned contrast mask, shorter/wider zip silhouette, longer tee sleeves, zip-hood sponsor clearance). All nine tops were then viewed front/back in the Garage beside their source photograph. The following text records the original findings. Finding 6 is partially addressed: folds, hem volume and windbreaker collar are present; photographed wash variation and finer pocket/cuff construction remain unfinished.

Research-only review of the current `vehicle.ts`, `garmentTexture.ts`, the shop feed, and all 70 front/back photographs for 35 color appearances across nine tops. The live feed still has 16 products; page 2 is empty; the canonical product sitemap has 16 URLs. All 112 published image URLs are unchanged. The checked-in garment-textures.json exactly matches the previously verified texture-crops.json. No new print artwork or crop bounds are required.

## Corrections in the current code

1. **Color lookup:** `sourcesByColor.colorId` uses labels such as `Schwarz`, `Militärgrün`, `British Racing Green`, while preview IDs use `schwarz`, `militargrun`, `british-racing-green`. The equality in garmentTexture.ts does not match any of the 33 non-Original top appearances and always selects the first photo. Normalize with the same catalog slug function, or compare the real option value/label. Keep selected photo RGB when preserving ink.
2. **Fine gray chest marks:** after correcting source selection, the RGB-distance alpha in printedCrop visibly erases much of the gray oval Pfusch mark on Hellgrau Streetphotographer and Signs tees. It treats low-contrast ink as fabric. Use an aligned high-contrast photo's real ink mask and selected-color RGB, or a faithfully extracted mask; do not redraw the mark or increase the threshold globally. Reproduction of the current extraction against every color is staged in fresh-extraction-colors-1.jpg through -5.jpg. The clearest failures are sheet 3 row 3 and sheet 5 row 2.
3. **Short zip fit:** Keep Up Zipper and Racing Zipper currently share exactly the pullover hoodie body profile/length. Their photographed body width/height ratio is approximately .88 versus .72 for pullovers. Keep their garment fabric boxier and about 15–18% shorter relative to its width; change hem/fabric geometry, never the fixed rider skeleton. They also need split kangaroo pockets and a rib waist/cuffs. Pullovers need one large kangaroo pocket. The current renderer has no such pockets.
4. **Tee sleeves:** all three tees have wide, dropped short sleeves reaching close to the elbow in the shop photos. The current sleeve ends at 60% of shoulder→elbow and reads as a regular short sleeve. Extend garment coverage toward roughly 80–90% as a visual starting point and keep a loose opening; retain unchanged arm bones and skin underneath. Keep a crew-neck edge rather than reusing the windbreaker's collar silhouette.
5. **Racing hood/sponsor clearance:** sponsors start at source y233, immediately below the real hood tip around y229. Current texture mapping puts their top at local torso y≈.482 while the shared folded hood reaches down to .47. This creates potential overlap of about .012 model units. In the rear screenshot, verify every sponsor is visible; a shallower zip-hood tip around .49 matches this photo better than moving or shrinking the artwork. Pullover hood photos support a lower tip around .47.
6. **Material identity:** Signs Hoodie is visibly acid-washed throughout; Keep Up/Racing zippers and the tees also have washed cotton variation. Current flat fill plus geometric folds omits this material character. Preserve subtle source-derived fabric variation across the garment, with the exact photographed ink on top. Windbreaker should remain a smoother woven shell with stand collar, gathered cuffs and straight drawcord hem, without the generic rib waistband.

## Per-product visual targets

The widths below refer to the visible print as a proportion of the measured photographic torso, not the padded crop. Existing texture-crops.json has all exact normalized centers/heights and original pixel bounds.

| Product / source | Front | Back | Fit correction |
|---|---|---|---|
| [Keep Up Zipper](https://pfusch-clothing.ch/products/keep-up-zipper) | Small left chest zip-tie logo, 14.2% torso width; do not center it | Full slogan + small powered-by/oval lockup, 61.4% width | Short boxy zip hoodie, split pocket, shallow folded hood |
| [Keep Up T-Shirt](https://pfusch-clothing.ch/products/keep-up-t-shirt) | Centered zip-tie, 17.6% width | Full slogan lockup, 68.5% width | Loose washed tee, long dropped short sleeves, crew neck |
| [Keep Up Hoodie](https://pfusch-clothing.ch/products/keep-up-hoodie) | Centered zip-tie, 17.1% width, higher than other oval-logo hoodies | Full slogan lockup, 67.2% width | Longer pullover body, large kangaroo pocket, rib cuffs/hem |
| [Racing Zipper](https://pfusch-clothing.ch/products/racing-zipper) | Complete sponsors + STREET RACING TEAM + zip-tie composition, 60.3% width | Sponsor strip 68.2% width; separate real Merriweather oldstyle proportional number beneath | Short zip fit; split pocket; retain both original outer-sleeve flames/checkers; verify hood clearance |
| [Ziptie Windbreaker](https://pfusch-clothing.ch/products/unisex-windbreaker) | Left chest oval mark, 20.6% width | Zip-tie lettering, 50.3% width | Stand collar with stored hood, smoother shell, gathered cuffs, straight drawcord hem; no external hoodie |
| [Streetphotographer T-Shirt](https://pfusch-clothing.ch/products/streetphotographer-t-shirt-1) | Centered oval, 18.2% width | Complete radar tower + italic caption, 85.8% width / 62.6% torso height | Loose washed tee; long dropped sleeves; preserve faint gray front ink on light colors |
| [Streetphotographer Hoodie](https://pfusch-clothing.ch/products/streetphotographer-grey-logo) | Centered oval, 17.4% width | Complete tower + caption, 78.8% width / 60.2% torso height | Longer pullover with large pocket, full sleeves/cuffs and folded hood |
| [Signs T-Shirt](https://pfusch-clothing.ch/products/signs-t-shirt) | Centered oval, 18.2% width | Full-color six-sign composition INCLUDING tiny red STOP punctuation, 75.5% width | Loose washed tee; long dropped sleeves; retain Hellgrau front mark |
| [Signs Hoodie](https://pfusch-clothing.ch/products/signs-hoodie) | Centered oval, 16.7% width | Full sign composition + STOP, 75.4% width | Acid-washed loose pullover; large pocket, full sleeves/cuffs and rib hem |

No color-specific graphic replacements or ink inversions were observed in the published color photos. The printed shop lettering must remain actual source artwork. Supplied radar.png lacks the italic caption; signs.png lacks the small STOP punctuation; those standalone assets cannot replace the complete photo crops. Merriweather oldstyle proportional numeral work remains correct and must be retained. Keep Up descriptions also say the print glows at night; any future nighttime treatment should affect the actual ink mask only.

## Reference files

- `fresh-nine-tops-reference.jpg`: every top, front and back, one representative color.
- `fresh-extraction-colors-1.jpg` … `fresh-extraction-colors-5.jpg`: all 35 appearances; exact source crop beside the reproduced current extraction, shown on the selected catalog base.
- Existing `*-placement.jpg`: annotated 640px front/back references.
- Existing `texture-crops.json`: authoritative crop and normalized placement guide.
- Existing `racing-sleeve-crops.json`: source pixel bounds, flame direction and rider-side mapping.

The per-product placement guides remain valid. When garment hem/width profiles change, map those normalized guides to that garment's own fabric bounds rather than stretching the complete graphic to a shared generic torso. Final visible placement and hood/print occlusion should be confirmed in the root task's in-game screenshots.
