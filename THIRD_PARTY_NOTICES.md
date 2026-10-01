# Third-party notices

Heracles Records is released under the MIT License — see `LICENSE`. This file
names the work it is built on and the third-party software, fonts, artwork and
data that ship with it. The full license text of every JavaScript package and
font in a build is in `THIRD_PARTY_LICENSES.txt`, generated at build time and
installed beside this file in the app's `resources/licenses` folder.

## CorosLink

Heracles Records began as a fork of
[CorosLink](https://github.com/JunAkerBuilds/CorosLink), Copyright (c) 2026
AtoZ, released under the MIT License. That copyright notice and the MIT
permission notice are kept in `LICENSE`, as the license requires.

## Programs that ship with the app

The app runs these as separate programs; it does not link against them.

### FFmpeg

A static FFmpeg executable, from the builds the
[ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) project
distributes: Linux by [John Van Sickle](https://johnvansickle.com/ffmpeg/),
macOS by [Helmut K. C. Tessarek](https://evermeet.cx/ffmpeg/) (Intel) and
[OSXExperts](https://osxexperts.net/) (Apple silicon), Windows by
[Gyan Doshi](https://www.gyan.dev/ffmpeg/builds/). These builds are licensed
under the **GNU General Public License, version 3**. The license text and the
build's own README, which names its version and components, are installed next
to the executable as `ffmpeg-LICENSE.txt` and `ffmpeg-README.txt`. FFmpeg's
source code is available from <https://ffmpeg.org/download.html>, and each
builder publishes the sources and scripts of its builds at the links above.

### yt-dlp

The [yt-dlp](https://github.com/yt-dlp/yt-dlp) executable, released into the
public domain under the Unlicense. Its standalone executables bundle
third-party components under their own licenses, which the yt-dlp repository
lists.

### Python runtime and ytmusicapi

A self-contained CPython 3.11 from
[python-build-standalone](https://github.com/astral-sh/python-build-standalone),
under the Python Software Foundation License (the text is inside the
`python-runtime` folder), running
[ytmusicapi](https://github.com/sigma67/ytmusicapi) (MIT) and its dependencies
requests (Apache-2.0), urllib3 (MIT), idna (BSD-3-Clause), charset-normalizer
(MIT) and certifi (MPL-2.0). Each package's license file is inside its
`.dist-info` folder in `bin/<platform>/python`.

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

The CorosLink project, from which Heracles Records is forked, exported the
required structures from Z-Anatomy's upstream Blender atlas, attached
strength-group metadata, decimated and Draco-compressed the geometry; the app
recolors it at runtime. The resulting `muscular_lite.glb` and
`skeletal_lite.glb` derivatives are distributed under CC BY-SA 4.0.

### Body figure

The human figure in the exercise picker's Body part and Muscle filters is drawn
from paths taken from
[react-native-body-highlighter](https://github.com/HichamELBSI/react-native-body-highlighter)
3.2.0, Copyright (c) 2022 ELABBASSI Hicham, MIT License.

### Sample routes

The simulated activities used in development builds follow roads and trails
from [OpenStreetMap](https://www.openstreetmap.org/copyright)
(© OpenStreetMap contributors, Open Database License 1.0), routed with
[BRouter](https://brouter.de/), with ground heights from SRTM (NASA/USGS,
public domain).

### Maps

Base maps are drawn from OpenFreeMap (OpenMapTiles schema, data © OpenStreetMap
contributors), Esri, OpenTopoMap, CyclOSM and OpenStreetMap; each map credits
its source in its corner while it is on screen.

## JavaScript packages

Every package from npm that ships inside the app is listed, with its version,
license and license text, in `THIRD_PARTY_LICENSES.txt`.

## Trademarks

COROS is a trademark of COROS Wearables Inc. Heracles Records is an independent,
unofficial app; it is not made, endorsed or supported by COROS. YouTube, YouTube
Music, Apple Music, Spotify, Strava, Hevy, Google Drive, ChatGPT, Claude and the
other services the app connects to are trademarks of their respective owners.
