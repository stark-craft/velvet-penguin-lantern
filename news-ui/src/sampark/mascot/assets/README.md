# Photorealistic mascot asset slots

No artwork is supplied with this change. The subsystem renders nothing until **all** of the following transparent `.webp` or `.png` files are present here. Do not use cartoons, icons, emoji, synthetic placeholder drawings, or a single still stretched through every action.

Required files (use the exact basenames, with either supported extension):

- `monkey-tail-hidden` — mostly concealed tail/hand teaser
- `monkey-hanging` — partial realistic hanging reveal
- `monkey-hanging-newspaper` — full hanging pose with folded paper
- `monkey-grip-strain` — unstable one-hand grip
- `monkey-slip` — grip release clip/pose
- `monkey-falling` — realistic falling clip
- `monkey-land` — compressed landing clip
- `monkey-dust-off` — recovery/body-shake clip
- `monkey-walk-newspaper` — walking/carrying clip
- `monkey-drag-newspaper` — low carry/drag clip
- `monkey-pull-chair` — reaching/pulling clip
- `monkey-sit` — settling into the chair
- `monkey-reading` — seated reading idle, with understated head/paper movement
- `newspaper` — separate realistic folded paper for fall/landing inertia
- `chair` — separate realistic chair, shown partly offscreen until pulled in
- `dust-puff` — subtle transparent impact particles

Use a consistent 160 × 205 px transparent canvas for the monkey clips and a 145 px wide transparent canvas for the chair at display size, with higher-resolution source exports for sharp large-display rendering. Keep the animal's scale, lighting, camera angle, grip point, and paper position consistent between poses. Complex motion slots should be pre-rendered animated WebP or high-quality frame sequences encoded as animated WebP; the CSS moves the composited animal across the page but does not synthesize its gait or anatomy. Manually inspect the supplied files for photorealism before enabling the feature.
