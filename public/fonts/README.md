# Font assets

Fetched 2026-09-08 from the official Google Fonts CSS2 endpoint:
https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@1,800&family=Quantico:ital,wght@1,700&display=swap

Headline: Barlow Condensed, italic, weight 800, Latin subset.
File: barlow-condensed-800-italic-latin.woff2 (23,780 bytes)
Source: https://fonts.gstatic.com/s/barlowcondensed/v13/HTxyL3I-JCGChYJ8VI-L6OO_au7B6xTrf3fmu4kG.woff2

Label/body: Quantico, italic, weight 700, Latin subset; matches storefront font family and its bold italic face.
File: quantico-700-italic-latin.woff2 (5,832 bytes)
Source: https://fonts.gstatic.com/s/quantico/v19/rax7HiSdp9cPL3KIF7xuHIRfi0349A.woff2

Latin subsets include U+0000-00FF, so German umlauts and sharp s are covered. Use font-style:italic and matching font-weight in local @font-face declarations. Both SIL Open Font License files have been included from https://github.com/google/fonts/tree/main/ofl/barlowcondensed and https://github.com/google/fonts/tree/main/ofl/quantico.

Image inspection: the 16 primary product photographs have opaque white (or near-white) corners. PNG product files have RGBA containers but are not ready-made transparent garment/logo decals. Source photographs can be used directly for product-card/texture planes with their visible background. Isolated graphic decals would require cropping/masking or extracting a design region first. The actual pfusch-logo.png has transparent alpha and is ready for use as a logo texture/decal. No source image has been edited.
