# Merriweather numeral audit

The deployed Google Fonts Latin 700 subset `merriweather-latin-700-normal.woff2` has no `onum` feature or oldstyle numeral glyphs. It contains `pnum` and `tnum`, but those only select numeral spacing. Requesting `onum` from that file cannot produce a descending oldstyle 3.

Use `merriweather-source-latin-700-features.woff2` (204,936 bytes). It was derived from the official full Merriweather variable source at weight 700, width 100, optical size 18. It retains the original normal digit mapping, Latin language shaping, kerning, and all available Latin OpenType features, including `onum`, `pnum`, `lnum`, and `tnum`. The actual outlines of Merriweather's `two.osf`, `three.osf`, and `seven.osf` are preserved. No digit was redrawn, reshaped, individually scaled, or shifted vertically.

The output's internal family is `PFUSCH Text`, because the original OFL reserves the primary font name Merriweather for original versions. This acknowledges the file is a locally instanced/subset derivative; its shapes are actual Merriweather. Keep the accompanying original copyright and `OFL.txt` when bundling. The original full source is also saved unchanged as `Merriweather-official-variable.ttf`.

For CSS, select oldstyle proportional figures with `font-variant-numeric: oldstyle-nums proportional-nums` and `font-feature-settings: "onum" 1, "pnum" 1`. For Canvas, create/load a FontFace with `weight: "700"` and `featureSettings: '"onum" 1, "pnum" 1'`, add it to `document.fonts`, and await loading before drawing the CanvasTexture. The root task confirmed this descriptor works in Edge Canvas with the original full font: a 220 px oldstyle 3 descends about 35 px, versus about 4 px for its lining 3. The feature-preserving subset should receive the same browser check before adoption.

The original font uses 2,000 units/em. At 700/100/18, `two.osf` has yMin 0; `three.osf` yMin -321 and yMax 1262; `seven.osf` yMin -359 and yMax 1243. The numerals have proportional advances and pair kerning. Draw complete strings such as `23`, `32`, `37` on one shared baseline so natural descenders and spacing remain intact. Do not center or normalize each digit independently.

`numeral-audit.json` records source/output SHA-256 hashes, GSUB feature lists, glyph names, metrics, and HarfBuzz shape comparisons. Both the feature-preserving subset with onum+pnum and the optional default-remapped digit-only fallback are exactly equivalent to the official static instance for the tested strings `23`, `32`, `37`, `00`, `11`, `88` in glyphs, advances, offsets, and extents.

The optional fallback `pfusch-oldstyle-numbers-700.woff2` is 2,272 bytes and has internal family `PFUSCH Oldstyle Numbers`. It maps digit Unicode characters directly to original onum+pnum glyphs and is only needed if a browser cannot apply the FontFace descriptor. The root task's successful Edge test makes this fallback unnecessary there.

## Sources

- Original project: https://github.com/EbenSorkin/Merriweather4
- Official Google Fonts source: https://raw.githubusercontent.com/google/fonts/main/ofl/merriweather/Merriweather%5Bopsz%2Cwdth%2Cwght%5D.ttf
- Official metadata: https://github.com/google/fonts/blob/main/ofl/merriweather/METADATA.pb
- Original SIL OFL 1.1 license: https://raw.githubusercontent.com/google/fonts/main/ofl/merriweather/OFL.txt
- Open Font License font modifications and reserved names: https://openfontlicense.org/ofl-faq/
- FontFace featureSettings specification: https://drafts.csswg.org/css-font-loading/#dom-fontface-featuresettings

The source data was fetched on 2026-09-09. Build/audit tooling and script are staged outside the checkout. No project files were edited by this research task.
