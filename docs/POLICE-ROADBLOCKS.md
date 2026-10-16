# Partial police roadblocks

At 75,000 points, eligible traffic waves can become a stationary police car in
the middle lane and a low nail strip in one outside lane. The opposite outside
lane stays open and adjacent to the preceding safe route. The seeded choice
survives spacing retries, requires two free pooled slots and has a 1,600–1,900m
cooldown. Existing arrival separation remains in force. Pursuit, camera and ramp
conflicts defer the blockade; passing its police car does not start a chase.

A grounded tire hit warns the rider and queues a fall seven metres beyond the
strip. A wheelie does not protect the rear tire; actual jump clearance does.
Pause freezes the queue and the existing single revive clears it.

The 2.4 × 0.65 × 0.16m strip has twelve metal tips, small amber end markers and
one shared black contour. Four meshes and one contour are shared by pool clones;
no additional lights, textures or per-frame geometry updates are used.

Verification: fourteen engine regressions cover threshold, reachable lanes,
retry/cooldown, capacity, delayed contact, wheelie/jump, pause, revive and replay
determinism. Two model regressions cover scale, visibility, contours and shared
resources. The existing remote production-build browser check captures the
blockade on mobile and desktop; local GPU checks are intentionally avoided.
