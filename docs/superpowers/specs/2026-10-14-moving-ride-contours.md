# Moving ride contours

Keep necessary black boundaries visible on the rider and real tree forms from
the production chase camera during lane changes and wheelies. Inspect T-shirt
sleeves from different angles and tree crowns against the sky explicitly.

Use actual imported bikes and the existing immutable skeleton. Preserve the
palette, authored artwork, gameplay, source geometry and pooled render buffers.
Avoid triangle wireframes and new black creases on smooth clothing. Keep the
hero limits at 32 shells / 10 hard contours; tree forms may use three fixed
borrowed-buffer draws. Run heavy rendering on CI to conserve local battery.

Completion requires focused regressions, independent review, successful remote
browser/build verification and inspection of moving chase-camera captures.

For traffic, retain primary body/hazard boundaries while fading nested windows,
small trim and tire shoulder lines smoothly at camera depths 24–62 metres.
Keep their existing single shared contour draw and depth-tested occlusion.
