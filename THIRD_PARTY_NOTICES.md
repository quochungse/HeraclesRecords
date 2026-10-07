# Third-party notices

Heracles Records is released under the MIT License — see `LICENSE`. This file
names the work it is built on and the third-party fonts, artwork and data that
ship with it. The full license text of every JavaScript package and
font in a build is in `THIRD_PARTY_LICENSES.txt`, generated at build time and
installed beside this file in the app's `resources/licenses` folder.

## Original code

Part of Heracles Records' code is Copyright (c) 2026 AtoZ, released under the
MIT License. That copyright notice and the MIT permission notice are kept in
`LICENSE`, as the license requires.

## Fonts

Inter (Copyright 2020 The Inter Project Authors), Space Grotesk (Copyright 2020
The Space Grotesk Project Authors) and Source Serif 4 (Copyright 2014 The Source
Serif 4 Project Authors) are used under the SIL Open Font License 1.1. The full
license texts are in `THIRD_PARTY_LICENSES.txt`.

## Artwork and data

### Z-Anatomy anatomy models

The 3D muscle, linea alba, and skeletal meshes used by the Strength view are
exported directly from [Z-Anatomy](https://www.z-anatomy.com/), which is
licensed under the
[Creative Commons Attribution-ShareAlike 4.0 International License](https://creativecommons.org/licenses/by-sa/4.0/).
Z-Anatomy includes material derived from BodyParts3D, copyright The Database
Center for Life Science (DBCLS), also licensed under CC BY-SA 4.0.

AtoZ exported the required structures from Z-Anatomy's upstream Blender
atlas, attached strength-group metadata, decimated and Draco-compressed the
geometry; the app recolors it at runtime. The resulting `muscular_lite.glb` and
`skeletal_lite.glb` derivatives are distributed under CC BY-SA 4.0.

### Body figure

The human figure in the exercise picker's Body part and Muscle filters is drawn
from paths taken from
[react-native-body-highlighter](https://github.com/HichamELBSI/react-native-body-highlighter)
3.2.0, Copyright (c) 2022 ELABBASSI Hicham, MIT License.

### Overview body figure

The human figure on Overview is built from [MakeHuman](http://www.makehumancommunity.org/)'s
base mesh, body-shape targets and default skeleton
([makehumancommunity/makehuman](https://github.com/makehumancommunity/makehuman)),
released under CC0 1.0. `npm run body-figures:bake` shapes, poses and decimates
them into `src/training/body/bodyFigures.json`.

### Sample routes

The simulated activities used in development builds follow roads and trails
from [OpenStreetMap](https://www.openstreetmap.org/copyright)
(© OpenStreetMap contributors, Open Database License 1.0), routed with
[BRouter](https://brouter.de/), with ground heights from SRTM (NASA/USGS,
public domain).

### Administrative regions

Places on "Where you've been" and in the Hall of Records are told apart by the
first-level administrative region they lie in. The outlines are
[Natural Earth](https://www.naturalearthdata.com/) admin-1 states and provinces
1:10m (public domain), simplified, and, for Việt Nam, the provinces from
[OpenStreetMap](https://www.openstreetmap.org/copyright)
(© OpenStreetMap contributors, Open Database License 1.0). The derived file,
`src/trainingMap/adminRegions.json`, is available under the same licence.

### Age grading and VO2max ratings

The Hall of Records grades running speed against the WMA/USATF 2025 road
age-grading standards by Alan Jones with Tom Bernhard
([Age-Grade-Tables](https://github.com/AlanLyttonJones/Age-Grade-Tables)),
dedicated to the public domain under CC0 1.0, and rates VO2max against
The Cooper Institute's normative values by age and sex.

### Maps

Base maps are drawn from OpenFreeMap (OpenMapTiles schema, data © OpenStreetMap
contributors), Esri, OpenTopoMap, CyclOSM and OpenStreetMap; each map credits
its source in its corner while it is on screen.

## JavaScript packages

Every package from npm that ships inside the app is listed, with its version,
license and license text, in `THIRD_PARTY_LICENSES.txt`.

## Trademarks

COROS is a trademark of COROS Wearables Inc. Heracles Records is an independent,
unofficial app; it is not made, endorsed or supported by COROS. Strava, Hevy,
Google Drive, ChatGPT, Claude and the other services the app connects to are
trademarks of their respective owners.
