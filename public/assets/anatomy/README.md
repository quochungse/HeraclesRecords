# Strength figure assets

`hero/` holds the body the Strength view draws, one file shared by both figures
(`shared.bin.gz`: triangle indices) and one per sex (`male.bin.gz`,
`female.bin.gz`: int16 positions), described by `hero.json` and read by
`src/strength/heroBody.ts`. Each array is coded with
[meshoptimizer](https://github.com/zeux/meshoptimizer)'s vertex and index codecs
(decoded by the copy three.js ships) and every file gzipped over that, which
takes the two figures from 3.0 MB to 1.4 MB.

They were baked from Z-Anatomy's atlas
([Models-of-human-anatomy](https://github.com/Z-Anatomy/Models-of-human-anatomy),
revision `b16b4c2eb7de824722f5eef9d5f56c5569a3d640`), exported by
`scripts/export-z-anatomy-models.py` (superficial muscles with their strength
group, the linea alba, the visible bones). The bake then:

- kept the intact anatomical-right half of the muscles, sorted by group, with the
  external oblique's medial aponeurosis trimmed (the page mirrors the half);
- thickened the man's muscles as a gym-goer's, each moving away from the bone
  under it, the pectoral's lower fringe and the neck left near their size;
- reshaped the woman to a fit woman's proportions (narrower shoulders and waist,
  wider hips, chest lower on a shorter abdomen, sternum pushed back), toned her
  glutes and legs, and gave her a bust of her own, shaped from a sculpt;
- removed the skull, jaw and teeth, and placed a clay head on each figure, its
  eyes smoothed to plain spheres.

The bake ran offline and is not part of the repository; `npm run
test:anatomy-assets` checks what it produced. Credits and licences are in
`NOTICE.txt` and `THIRD_PARTY_NOTICES.md`.
