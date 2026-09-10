export type BinaryName = "yt-dlp" | "ffmpeg";

/** User-selected measurement system for Heracles Records presentation and writes. */
export type UnitSystem = "metric" | "imperial";

export interface BinaryCheck {
  name: BinaryName;
  available: boolean;
  command?: string;
  source: "bundled" | "path" | "missing";
  version?: string;
  error?: string;
}

export interface BinaryStatus {
  ytDlp: BinaryCheck;
  ffmpeg: BinaryCheck;
}

export interface DriveCandidate {
  name: string;
  rootPath: string;
  musicPath?: string;
  mapPath?: string;
  mapSizeBytes?: number;
  mapFileCount?: number;
  totalBytes?: number;
  freeBytes?: number;
  usedBytes?: number;
  reason: string;
}

export interface WatchTrack {
  name: string;
  relativePath: string;
  absolutePath: string;
  sizeBytes: number;
  modifiedAt: string;
}

export type WatchModelId =
  | "pace-pro"
  | "pace-4"
  | "pace-3"
  | "pace-2"
  | "nomad"
  | "vertix-2"
  | "vertix-2s"
  | "apex-4"
  | "apex-2-pro"
  | "apex-2"
  | "apex-pro"
  | "apex";

export type CorosWatchfaceResolutionProfile =
  | "mip-240-260-800"
  | "amoled-416-800"
  | "amoled-390-800"
  | "other";

export type WatchConnectionSmokeOptionId =
  | "auto"
  | "none"
  | "pace-pro"
  | "pace-4"
  | "pace-3"
  | "pace-2"
  | "nomad"
  | "vertix-2"
  | "vertix-2s"
  | "apex-4"
  | "apex-2-pro"
  | "apex-2"
  | "apex-pro"
  | "apex"
  | "unknown-pace"
  | "installer";

export interface WatchStatus {
  connected: boolean;
  checkedAt: string;
  name?: string;
  model?: WatchModelId;
  rootPath?: string;
  musicPath?: string;
  mapPath?: string;
  mapSizeBytes?: number;
  mapFileCount?: number;
  totalBytes?: number;
  freeBytes?: number;
  usedBytes?: number;
  tracks: WatchTrack[];
  candidates: DriveCandidate[];
  error?: string;
}

/** COROS account region, selecting the regional mobile API host. */
export type CorosWatchfaceRegion = "eu" | "us" | "cn";

/** A separate COROS mobile-app session used only for custom-watchface sharing. */
export interface CorosWatchfaceStatus {
  authenticated: boolean;
  secureStorageAvailable: boolean;
  /** Whether an encrypted COROS account is available to create a new mobile session. */
  savedCredentialsAvailable: boolean;
  /** Account identifier only; the saved password digest never leaves the main process. */
  savedEmail?: string;
  /** Region of the active mobile session, when signed in. */
  region?: CorosWatchfaceRegion;
  /** Best-guess region to preselect in the login form. */
  suggestedRegion: CorosWatchfaceRegion;
}

/** The only carrier currently approved for the guarded legacy editor. */
export type CorosLegacy614aCarrierProfile = "multidata-elev-416";

export interface CorosLegacy614aCarrierInspection {
  profile: CorosLegacy614aCarrierProfile;
  profileName: string;
  fileName: string;
  watchFaceId: number;
  sizeBytes: number;
  payloadCrc16: number;
  fullFileCrc16: number;
  weatherSpriteSize: number;
  weatherPosition: { x: number; y: number };
  temperatureRect: { x0: number; y0: number; x1: number; y1: number };
}

/** Opaque main-process handle returned after an exact reference is inspected. */
export interface CorosLegacy614aCarrierSelection {
  selectionId: string;
  inspection: CorosLegacy614aCarrierInspection;
}

/** Safe normal-display geometry only. Carrier identity and resources are locked. */
export interface CorosLegacy614aCarrierPatchInput {
  weatherPosition: { x: number; y: number };
  temperatureRect: { x0: number; y0: number; x1: number; y1: number };
}

export interface CorosLegacy614aCarrierExportResult {
  saved: boolean;
  filePath?: string;
  watchFaceId: number;
}

/** A source-template, on-watch, or user-created watchface catalog. */
export type CorosWatchfaceThemeCatalog = "editable" | "official" | "custom";

/** Parameters required by a COROS watchface catalog request. */
export interface CorosWatchfaceThemeListInput {
  firmwareType: string;
  language?: string;
  maxWatchFaceVersion?: number;
  /** Optional watch serial for on-watch/custom catalogs; any value works (defaults to `"x"`). */
  snCode?: string;
  /** Optional firmware model header captured from the mobile app. */
  modelVersion?: string;
  catalog?: CorosWatchfaceThemeCatalog;
}

/** An entry returned by a COROS watchface catalog. */
export interface CorosWatchfaceTheme {
  id?: string;
  /** Original editable template used to create a custom watch face. */
  sourceTemplateId?: string;
  name: string;
  previewImageUrl?: string;
  /** The theme's downloadable package resource, when the catalog exposes one. */
  packageUrl?: string;
  firmwareType?: string;
  backgroundImageId?: number;
  watchFaceVersion?: number;
  diyVersion?: number;
  templateType?: number;
  category?: string;
}

/** Device identifiers supplied by the user for the COROS battery-history API. */
export interface CorosBatteryQueryInput {
  deviceId: string;
  firmwareType: string;
  uuid: string;
}

/** A paired watch returned by the signed-in COROS account profile. */
export interface CorosPairedDevice {
  deviceId: string;
  firmwareType: string;
  uuid: string;
  mac?: string;
  /** Optional cosmetic variant reported by the authenticated mobile profile. */
  colorType?: string;
  /** Optional official device artwork pack, accepted only when served over HTTPS. */
  imagePackUrl?: string;
  /** Profile revision returned by COROS for this paired device. */
  profileVersion?: number;
}

/** Gear categories currently exposed by COROS's mobile API. */
export type CorosGearType = 1 | 2;

/** One piece of activity gear attached to the signed-in COROS account. */
export interface CorosGear {
  /** Decimal text because COROS gear IDs exceed Number.MAX_SAFE_INTEGER. */
  gearId: string;
  /** Client-generated decimal identifier used when the gear was created. */
  clientGearUniqId?: string;
  name: string;
  brandName: string;
  type: CorosGearType;
  sportTypeList: number[];
  /** Calendar day in YYYY-MM-DD form. */
  firstUseDay: string;
  /** All distance values are normalized to metres. */
  initialDistanceMeters: number;
  lifeDistanceMeters: number;
  realDistanceMeters: number;
  notify: boolean;
  status?: number;
  usageStatus?: number;
  createdAt?: string;
  updatedAt?: string;
}

/** Sport associations supported by COROS for a gear category. */
export interface CorosGearSupportedInfo {
  type: CorosGearType;
  sportTypeList: number[];
}

export interface CorosGearCatalog {
  gear: CorosGear[];
  supportedInfo: CorosGearSupportedInfo[];
}

/** Values accepted when adding gear to a COROS account. */
export interface CorosGearSaveInput {
  brandName: string;
  type: CorosGearType;
  sportTypeList: number[];
  /** Calendar day in YYYY-MM-DD form. */
  firstUseDay: string;
  initialDistanceMeters: number;
  lifeDistanceMeters: number;
  notify: boolean;
}

/** A nearby Bluetooth device exposed by Electron's Web Bluetooth chooser. */
export interface CorosBluetoothDeviceChoice {
  deviceId: string;
  deviceName: string;
}

export interface CorosBatteryUsageDetail {
  name: string;
  percent?: number;
}

export interface CorosBatteryUsageGroup {
  name: string;
  percent?: number;
  details: CorosBatteryUsageDetail[];
}

/** A daily battery-consumption record normalized from COROS's mobile API. */
export interface CorosBatteryDay {
  date: string;
  percentAtQueryTime?: number;
  totalPercent?: number;
  groups: CorosBatteryUsageGroup[];
}

export interface CorosBatteryReport {
  alarmStatus?: number;
  updatedAt?: string;
  days: CorosBatteryDay[];
}

/** A validated archive held by the main process after the user selected it. */
export interface CorosWatchfaceArchive {
  archiveId: string;
  fileName: string;
  sizeBytes: number;
  /** Decimal text: official template IDs exceed Number.MAX_SAFE_INTEGER. */
  sourceTemplateId: string;
  diyVersion: number;
  /** Effective `o_wf_ver` declared by info.json (defaults to 0 when absent). */
  watchFaceVersion: number;
  /** Target firmware family retained from template selection/import. */
  firmwareType?: string;
  /** Detected from resolution folders, independent of COROS's firmware ID. */
  resolutionProfile: CorosWatchfaceResolutionProfile;
  /** Portable Heracles Records project metadata bundled with an editable website ZIP. */
  editableProject?: CorosWatchfaceEditableProject;
}

export interface CorosWatchfaceProjectExportResult {
  /** False when the user cancelled the save dialog. */
  saved: boolean;
  /** Absolute path to the editable website ZIP, when saved. */
  filePath?: string;
}

export interface CorosWatchfaceArchiveExportInput {
  archiveId: string;
  name: string;
}

/** A public COROS share page downloaded and registered as a Studio archive. */
export interface CorosWatchfaceShareImport {
  archive: CorosWatchfaceArchive;
  name: string;
  /** Firmware recorded by COROS for the shared face, when present. */
  firmwareType?: string;
}

export interface CommunityWatchface {
  id: string;
  slug: string;
  title: string;
  description: string;
  creatorName: string;
  creatorHandle: string | null;
  models: string[];
  tags: string[];
  publishedAt: string | null;
  previewUrl: string;
  detailUrl: string;
  downloadUrl: string;
  packageBytes: number;
  packageSha256: string;
  validatorVersion: string | null;
}

export interface CommunityWatchfaceCatalogQuery {
  q?: string;
  model?: string;
  style?: string;
  sort?: "newest" | "title";
  page?: number;
  pageSize?: number;
}

export interface CommunityWatchfaceCatalogPage {
  schemaVersion: 1;
  items: CommunityWatchface[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    pageCount: number;
  };
  facets: {
    models: string[];
    styles: Array<{ value: string; label: string }>;
  };
}

export interface CommunityWatchfaceImport {
  face: CommunityWatchface;
  archive: CorosWatchfaceArchive;
}

export interface CommunityWatchfaceDownloadProgress {
  slug: string;
  stage: "downloading" | "verifying" | "opening";
  receivedBytes: number;
  totalBytes?: number;
}

export interface CommunityWatchfaceOpenRequest {
  slug: string;
}

export interface CorosWatchfacePublishInput {
  archiveId: string;
  name: string;
  firmwareType: string;
  backgroundImageId: number;
  language?: string;
}

/** Existing custom face metadata used to request a fresh COROS share link. */
export interface CorosWatchfaceExistingShareInput {
  templateId: string;
  sourceTemplateId: string;
  name: string;
  firmwareType: string;
  backgroundImageId: number;
}

/** A browser-rendered 800×800 face background, kept within a selected template. */
export interface CorosWatchfaceCreatorInput {
  sourceArchiveId: string;
  backgroundDataUrl: string;
  /** Fully composed face preview written to the archive's root preview PNG. */
  previewDataUrl?: string;
  /** Target firmware used to validate that required device resolutions exist. */
  firmwareType?: string;
  /** Connected watch model, used when firmware identifiers change over time. */
  watchModel?: WatchModelId;
  /** Exact `o_wf_ver` to write. Omit to preserve/auto-raise the template value. */
  watchFaceVersion?: number;
  /**
   * Experimental export-only `o_template_id` override in info.json. Decimal
   * text is used because official COROS template IDs can exceed
   * Number.MAX_SAFE_INTEGER.
   */
  templateIdOverride?: string;
  /**
   * Experimental export-only `[watchface_id]` override written to every
   * `config.txt` / `AODconfig.txt`. Accepts decimal or `0x` hex (32-bit).
   */
  watchfaceIdOverride?: string;
  /** Experimental export-only `m_name` override for template-identity tests. */
  templateNameOverride?: string;
  /**
   * Deletes every `[key]=` line whose value is blank from each `config.txt` /
   * `AODconfig.txt`. Firmware treats a declared key as feature-present even
   * when empty (an empty `control_*` group still adds a blank entry to the
   * on-watch selector), so absent lines are the only reliable "off".
   */
  stripBlankConfigKeys?: boolean;
  /**
   * Renderer-generated PNG sprites (bitmap-font digits, tinted icons and
   * weekday labels) that replace template assets of identical size.
   */
  assetReplacements?: CorosWatchfaceAssetReplacement[];
  /**
   * Layout experiments: rewrites the values of keys that already exist in a
   * template config file (element positions, rects, colors). Keys absent from
   * the original file are rejected rather than appended.
   */
  configOverrides?: CorosWatchfaceConfigOverride[];
  /**
   * Full-file replacements for existing `config.txt` / `AODconfig.txt` entries.
   * Applied as the new base text before structured `configOverrides`.
   */
  configTextReplacements?: CorosWatchfaceConfigTextFile[];
  /**
   * Raises info.json's `o_wf_ver` to at least this value. The phone-app
   * compiler only bakes weather/temperature elements into the on-watch binary
   * when the template declares a high-enough watchface version (official
   * weather-bearing faces ship `o_wf_ver:4`); a stock DIY face at version 0
   * renders those elements in the preview but drops them on the watch.
   */
  minWatchFaceVersion?: number;
}

export interface CorosWatchfaceConfigOverride {
  /** A config file entry of the archive, e.g. "watchface_800x800/config.txt". */
  path: string;
  values: Record<string, string>;
}

/** Raw UTF-8 body for an existing template config file path. */
export interface CorosWatchfaceConfigTextFile {
  /** Archive entry such as "watchface_416x416/AODconfig.txt". */
  path: string;
  text: string;
}

export interface CorosWatchfaceAssetReplacement {
  /** Zip entry path inside the selected template archive or a studio sprite path. */
  path: string;
  dataUrl: string;
  /** Adds a new isolated sprite instead of replacing a template entry. */
  create?: boolean;
  /** Allows a supported state-sprite replacement to change template PNG dimensions. */
  allowDimensionOverride?: boolean;
}

/** One PNG inside a template archive, addressed by its zip entry path. */
export interface CorosWatchfaceSpriteFile {
  path: string;
  width: number;
  height: number;
}

/**
 * A numbered sprite folder inside a resolution directory. `month` folders
 * contain one label image per month; `state` folders are firmware-swapped icon
 * sets such as battery and weather, never bitmap fonts.
 */
export interface CorosWatchfaceSpriteFolder {
  /** Folder path relative to the resolution directory, e.g. "01" or "a/01". */
  folder: string;
  kind: "digits" | "week" | "month" | "state";
  /** True when the folder belongs to the always-on-display asset tree. */
  aod: boolean;
  files: CorosWatchfaceSpriteFile[];
}

export interface CorosWatchfaceResolutionDetails {
  /** e.g. "watchface_800x800" */
  directory: string;
  width: number;
  height: number;
  /** Raw `[key]=value` pairs from config.txt. */
  config: Record<string, string>;
  /** Raw `[key]=value` pairs from AODconfig.txt, when present. */
  aodConfig: Record<string, string>;
  spriteFolders: CorosWatchfaceSpriteFolder[];
  icons: CorosWatchfaceSpriteFile[];
}

/** Everything the renderer needs to restyle a selected template archive. */
export interface CorosWatchfaceTemplateDetails {
  archiveId: string;
  resolutions: CorosWatchfaceResolutionDetails[];
}

/** A template PNG exported to the renderer for tinting or preview. */
/** The outcome of downloading an official theme's package resource. */
export interface CorosWatchfaceThemeDownload {
  fileName: string;
  sizeBytes: number;
  /** True when the package validated as a DIY starter template archive. */
  usableAsTemplate: boolean;
  /** Set when usable: the registered archive, ready for the creator. */
  archive?: CorosWatchfaceArchive;
  /** Top-level entries when the package is a ZIP but not a starter template. */
  entries?: string[];
  /** Local copy retained so it can be inspected or shared. */
  savedPath?: string;
  message: string;
}

export interface CorosWatchfaceThemeDownloadInput {
  packageUrl: string;
  /** Display name used for the downloaded archive, usually the theme name. */
  name?: string;
  /** Firmware family used to query the catalog that returned this template. */
  firmwareType?: string;
}

export interface CorosWatchfaceTemplateAsset extends CorosWatchfaceSpriteFile {
  dataUrl: string;
}

export interface CorosWatchfaceArtwork {
  dataUrl: string;
  width: number;
  height: number;
}

/**
 * An edit applied to one PNG-valued config entry. The map key is scoped to
 * either config.txt or AODconfig.txt so two entries may share a source bitmap
 * without sharing visibility or replacement state.
 */
export interface CorosWatchfaceConfigAssetOverride {
  /** Absent means the template config entry remains enabled. */
  enabled?: boolean;
  /** Battery/native canvas scale, or artwork zoom inside a fixed direct-asset canvas. */
  scale?: number;
  /** Allow supported selectable-control icons to use the imported PNG dimensions. */
  nativeSize?: boolean;
  /** One source PNG is resized independently for every device resolution. */
  replacement?: CorosWatchfaceArtwork;
  /** Per-state PNGs for a stateful sprite folder such as the battery indicator. */
  stateReplacements?: Record<string, CorosWatchfaceArtwork>;
}

/**
 * A user-supplied PNG font atlas. Glyphs are laid out left-to-right,
 * top-to-bottom in equally sized cells; `glyphs` maps those cells to text.
 */
export interface CorosWatchfaceRasterFont {
  /** Friendly name shown in the font selector and saved with the project. */
  label: string;
  /** PNG data URL for the full glyph atlas. */
  dataUrl: string;
  /** One character per atlas cell, in reading order. */
  glyphs: string;
  /** Number of equally sized cells across the atlas. */
  columns: number;
  /** Optional pre-rasterized labels such as MON, TUE, and WED. */
  labels?: Record<string, string>;
  /**
   * Optional independent PNGs keyed by their exact glyph or label (for
   * example `"7"`, `"MON"`, or `"PM"`). These take priority over the atlas,
   * so a font does not have to reuse a uniformly gridded source image.
   */
  sprites?: Record<string, string>;
  /** Native pixel dimensions for independently imported glyph/label PNGs. */
  spriteSizes?: Record<string, { width: number; height: number }>;
  /** Native pixel dimensions of the uploaded atlas image. */
  atlasSize?: { width: number; height: number };
  /** When true, use the design's selected digit colour for the atlas alpha. */
  tint: boolean;
}

/** A PNG decoded from a sprite folder by the main process. */
export interface CorosWatchfaceRasterFontSprite {
  name: string;
  relativePath: string;
  dataUrl: string;
  sizeBytes: number;
}

/** A user-selected folder of PNG digit and optional weekday sprites. */
export interface CorosWatchfaceRasterFontFolder {
  label: string;
  sprites: CorosWatchfaceRasterFontSprite[];
}

export interface CorosWatchfaceSpriteCrop {
  /** Normalized source coordinates in the inclusive 0..1 image space. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CorosWatchfaceTransformOrigin {
  /** Normalized horizontal pivot, where 0.5 is the visual center. */
  x: number;
  /** Normalized vertical pivot, where 0.5 is the visual center. */
  y: number;
}

export interface CorosWatchfaceShadowEffect {
  id: string;
  kind: "outer-shadow" | "inner-shadow";
  enabled: boolean;
  color: string;
  /** Normalized 0..1 alpha multiplied with the shadow color. */
  opacity: number;
  /** Blur radius in 800px master watch-face pixels. */
  blur: number;
  /** Positive values expand the mask; negative values contract it. */
  spread: number;
  /** Offset distance in 800px master watch-face pixels. */
  distance: number;
  /** Clockwise degrees from the positive X axis. */
  angle: number;
}

export interface CorosWatchfaceEffectStyle {
  id: string;
  name: string;
  effects: CorosWatchfaceShadowEffect[];
}

export type CorosWatchfaceEffectBinding =
  | { kind: "local"; effects: CorosWatchfaceShadowEffect[] }
  | { kind: "style"; styleId: string };

export type CorosWatchfaceStrokePaint =
  | {
      kind: "solid";
      color: string;
    }
  | {
      kind: "linear-gradient";
      from: string;
      to: string;
      /** Clockwise degrees from the positive X axis. */
      angle: number;
    };

export interface CorosWatchfaceStroke {
  id: string;
  enabled: boolean;
  paint: CorosWatchfaceStrokePaint;
  /** Normalized 0..1 alpha applied to the stroke paint. */
  opacity: number;
  position: "inside" | "center" | "outside";
  /** Width in the Studio's 800px master watch-face space. */
  weight: number;
}

export interface CorosWatchfaceEditorGroup {
  id: string;
  name: string;
  /** Flat editor-layer ids. Groups are flattened during watch export. */
  layerIds: string[];
}

export interface CorosWatchfaceEditorGuide {
  id: string;
  axis: "x" | "y";
  /** Position in the editor's largest preview-resolution coordinate space. */
  position: number;
}

export interface CorosWatchfaceDesignSprite {
  id: string;
  /** User-facing layer name. Absent keeps the legacy “Imported sprite” label. */
  name?: string;
  dataUrl: string;
  sourceWidth: number;
  sourceHeight: number;
  width: number;
  height: number;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  /** Absent means fully opaque for legacy projects. */
  opacity?: number;
  flipX?: boolean;
  flipY?: boolean;
  /** Skew angles are clamped to -80..80 degrees by the editor. */
  skewX?: number;
  skewY?: number;
  /** Imported images preserve proportions unless explicitly unlocked. */
  aspectLocked?: boolean;
  /** Normalized source crop. Absent means the complete source image. */
  crop?: CorosWatchfaceSpriteCrop;
  /** Normalized pivot for rotation and skew. */
  origin?: CorosWatchfaceTransformOrigin;
  /** Absent means visible for projects saved before layer toggles. */
  visible?: boolean;
  /** Optional monochrome tint while preserving the imported image alpha. */
  tintColor?: string | null;
}

/** A two-stop linear gradient fill, angle in degrees clockwise from +x. */
export interface CorosWatchfaceGradientFill {
  from: string;
  to: string;
  angle: number;
}

/** Base fields shared by every freeform background shape (in 800px space). */
interface CorosWatchfaceBackgroundElementBase {
  id: string;
  x: number;
  y: number;
  rotation: number;
  /** Absent means visible for projects saved before group visibility controls. */
  visible?: boolean;
  /** Absent means fully opaque for legacy projects. */
  opacity?: number;
}

export interface CorosWatchfaceBackgroundRect extends CorosWatchfaceBackgroundElementBase {
  kind: "rect";
  width: number;
  height: number;
  /** When true, editing width or height preserves the shape's proportions. */
  aspectLocked?: boolean;
  cornerRadius: number;
  fill: string;
  gradient?: CorosWatchfaceGradientFill;
  strokeColor?: string;
  strokeWidth?: number;
}

export interface CorosWatchfaceBackgroundEllipse extends CorosWatchfaceBackgroundElementBase {
  kind: "ellipse";
  width: number;
  height: number;
  /** When true, editing width or height preserves the shape's proportions. */
  aspectLocked?: boolean;
  fill: string;
  gradient?: CorosWatchfaceGradientFill;
  strokeColor?: string;
  strokeWidth?: number;
}

export interface CorosWatchfaceBackgroundLine extends CorosWatchfaceBackgroundElementBase {
  kind: "line";
  /** End point relative to (x, y). */
  dx: number;
  dy: number;
  color: string;
  strokeWidth: number;
}

export interface CorosWatchfaceBackgroundText extends CorosWatchfaceBackgroundElementBase {
  kind: "text";
  text: string;
  fontFamily: string;
  fontSize: number;
  color: string;
  weight: number;
  align: "left" | "center" | "right";
}

export type CorosWatchfaceBackgroundElement =
  | CorosWatchfaceBackgroundRect
  | CorosWatchfaceBackgroundEllipse
  | CorosWatchfaceBackgroundLine
  | CorosWatchfaceBackgroundText;

/** Firmware-drawn calorie goal progress. */
export interface CorosWatchfaceKcalProgressStyle {
  /** Resolution whose pixel coordinate system the stored geometry uses. */
  referenceWidth?: number;
  referenceHeight?: number;
  arcEnabled: boolean;
  rectEnabled: boolean;
  arcColor: string;
  rectColor: string;
  /** Editor-only sample used by the live preview; the watch supplies the real percentage. */
  previewPercent: number;
  arc: {
    centerX: number;
    centerY: number;
    radiusX: number;
    radiusY: number;
    startAngle: number;
    endAngle: number;
    strokeWidth: number;
    /** COROS flag: draw the uncompleted portion instead of the completed portion. */
    background: boolean;
  };
  rect: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    direction: "left" | "right" | "top" | "bottom";
  };
}

/** Firmware-drawn exercise-goal progress arc/bar. */
export interface CorosWatchfaceExerciseProgressStyle {
  /** Resolution whose pixel coordinate system the stored geometry uses. */
  referenceWidth?: number;
  referenceHeight?: number;
  /** Keeps the legacy serialized name for the rectangular progress bar. */
  enabled: boolean;
  arcEnabled: boolean;
  color: string;
  /** Editor-only sample used by the live preview; the watch supplies the real percentage. */
  previewPercent: number;
  arc: {
    centerX: number;
    centerY: number;
    radiusX: number;
    radiusY: number;
    startAngle: number;
    endAngle: number;
    strokeWidth: number;
    /** COROS flag: draw the uncompleted portion instead of the completed portion. */
    background: boolean;
  };
  rect: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    direction: "left" | "right" | "top" | "bottom";
  };
}

/** Studio-owned fixed-Exercise separator baked into the background artwork. */
export interface CorosWatchfaceExerciseSeparatorStyle {
  enabled: boolean;
  /** Base center in the active mode's authoring resolution. */
  x: number;
  y: number;
  /** Authored glyph/PNG height before applying scale. */
  size: number;
  scale: number;
  color: string;
  /** Optional independent PNG; absent renders a generated colon glyph. */
  artwork?: CorosWatchfaceArtwork | null;
}

export interface CorosWatchfaceDesignState {
  version: 1;
  /**
   * Independent visual state for alternate firmware display modes. Current
   * display fields remain at the top level for backwards compatibility.
   */
  modeDesigns?: {
    aod?: CorosWatchfaceModeDesignState;
  };
  /** Exact archive `o_wf_ver`; absent keeps automatic compatibility behavior. */
  archiveWatchFaceVersion?: number;
  /** Deletes blank `[key]=` config lines from built archives (see creator input). */
  stripBlankConfigKeys?: boolean;
  /**
   * Studio raw-text edits for template `config.txt` / `AODconfig.txt` paths.
   * Keys are archive-relative paths; values are full UTF-8 file bodies.
   */
  configTextEdits?: Record<string, string>;
  /** Solid base colour painted behind artwork and freeform background elements. */
  backgroundColor?: string;
  accentColor: string;
  artwork: CorosWatchfaceArtwork | null;
  /** Whether the source artwork is painted into the composed background. */
  artworkVisible?: boolean;
  zoom: number;
  fontFamily: string;
  /** Optional portable PNG glyph atlas, used when no local font is selected. */
  rasterFont?: CorosWatchfaceRasterFont;
  /** Typography settings for rasterized digit and date sprites. */
  fontWeight?: number;
  fontStyle?: "normal" | "italic";
  /** Character spacing as a fraction of the font size (for example 0.04). */
  letterSpacing?: number;
  digitColor: string;
  tintLabels: boolean;
  tintIcons: boolean;
  previewComplication: string;
  metricChanges: Record<string, boolean>;
  metricStyles: Record<string, { color?: string; scale: number; rotation?: number; fontFamily?: string; fontWeight?: number; fontStyle?: "normal" | "italic"; letterSpacing?: number; rasterFont?: CorosWatchfaceRasterFont }>;
  /** Optional native calorie goal arc/bar configuration. */
  kcalProgress?: CorosWatchfaceKcalProgressStyle;
  /** Optional native exercise-goal bar configuration. */
  exerciseProgress?: CorosWatchfaceExerciseProgressStyle;
  /** Independent fixed-Exercise colon flattened into Current/AOD artwork. */
  exerciseSeparator?: CorosWatchfaceExerciseSeparatorStyle;
  /** Shared digit style for every value shown in the selectable control slot. */
  selectableMetricStyle?: {
    color?: string;
    scale: number;
    /** Clockwise rotation applied inside each firmware sprite canvas. */
    rotation?: number;
    fontFamily?: string;
    fontWeight?: number;
    fontStyle?: "normal" | "italic";
    letterSpacing?: number;
    rasterFont?: CorosWatchfaceRasterFont;
    /** Preserve each selectable digit's natural width and expand value rectangles. */
    nativeSize?: boolean;
  };
  /**
   * Per-component selectable-control state. Missing entries inherit whether
   * the imported template already declares that component.
   */
  controlComplicationEnabled?: Record<string, boolean>;
  /** Selects one mutually exclusive native barometer parser branch. */
  controlBarometerMode?: "static" | "directional";
  /** False removes the Battery choice from the firmware-selectable control slot. */
  controlBatteryEnabled?: boolean;
  /** False removes the Sunrise choice from the firmware-selectable control slot. */
  controlSunriseEnabled?: boolean;
  /** False removes the Sunset choice from the firmware-selectable control slot. */
  controlSunsetEnabled?: boolean;
  /** False removes the Floors choice from the firmware-selectable control slot. */
  controlFloorEnabled?: boolean;
  /** False removes the Temperature choice from the firmware-selectable control slot. */
  controlTemperatureEnabled?: boolean;
  /** Per selectable-control icon offsets, independent from the slot origin/value. */
  controlIconOffsets?: Record<string, { dx: number; dy: number }>;
  /** Converts firmware auto-aligned HH:MM into four independently positioned digits. */
  separateAutoTime?: boolean;
  timeStyles: Record<string, { color?: string; scale: number; rotation?: number; fontFamily?: string; fontWeight?: number; fontStyle?: "normal" | "italic"; letterSpacing?: number; rasterFont?: CorosWatchfaceRasterFont }>;
  /** Weekday/month/day sizing; absent in projects saved before resizing. */
  dateStyles?: Record<
    string,
    {
      scale: number;
      /** Clockwise rotation applied inside each firmware sprite canvas. */
      rotation?: number;
      /** Exact exported PNG dimensions when set. */
      width?: number;
      height?: number;
      /** Imported PNG dimensions preserve their proportions unless unlocked. */
      aspectLocked?: boolean;
      /** Date-month rendering mode; absent preserves the starter's format. */
      monthFormat?: "digits" | "labels";
      fontFamily?: string;
      color?: string;
      fontWeight?: number;
      fontStyle?: "normal" | "italic";
      letterSpacing?: number;
      rasterFont?: CorosWatchfaceRasterFont;
      /** Legacy weekday/date-day natural-width mode. */
      nativeSize?: boolean;
    }
  >;
  staticSeparators: Record<
    "colon" | "dateSlash",
    {
      enabled: boolean;
      x: number;
      y: number;
      size: number;
      color: string;
      fontFamily?: string;
    }
  >;
  /** AM/PM indicator styling; absent in projects saved before the feature. */
  ampmIndicator?: {
    enabled: boolean;
    x: number;
    y: number;
    scale: number;
    /** Optional tint; absent preserves the template sprite color. */
    color?: string;
    fontFamily?: string;
  };
  /** Dynamic 41-state weather icon; absent in older projects. */
  weatherIndicator?: {
    enabled: boolean;
    x: number;
    y: number;
    scale: number;
    /** Optional tint applied to all weather states. */
    color?: string;
  };
  layoutOffsets: Record<string, { dx: number; dy: number }>;
  /**
   * Editor layer ids whose positions should change together. The ids are kept
   * at editor level so firmware-backed layers and freeform artwork can share a
   * link group without changing the exported watch-face format.
   */
  linkedLayerGroups?: string[][];
  /** Persistent flat groups used by the modern editor. */
  editorGroups?: CorosWatchfaceEditorGroup[];
  /** Project-specific ruler guides in preview coordinates. */
  editorGuides?: CorosWatchfaceEditorGuide[];
  /**
   * Editor layer ids whose positions are protected from drag, nudge, and
   * inspector position edits. This is an editor-only setting and does not
   * alter the exported watch-face format.
   */
  lockedLayerIds?: string[];
  /** Reusable, live-linked visual-effect styles. */
  effectStyles?: CorosWatchfaceEffectStyle[];
  /** Effects keyed by editor layer id, or by `aod:<id>` for always-on assets. */
  layerEffects?: Record<string, CorosWatchfaceEffectBinding>;
  /** Ordered front-to-back stroke stacks keyed by editor layer id. */
  layerStrokes?: Record<string, CorosWatchfaceStroke[]>;
  /** Visibility overrides for firmware-backed editor layers. */
  layerVisibility?: Record<string, boolean>;
  /** Normalized 0..1 opacity keyed by editor layer id. */
  layerOpacities?: Record<string, number>;
  /** Per-layer colors for firmware components without specialized styles. */
  layerColors?: Record<string, string>;
  /** Per-config PNG visibility and isolated replacement choices. */
  configAssetOverrides?: Record<string, CorosWatchfaceConfigAssetOverride>;
  designSprites: CorosWatchfaceDesignSprite[];
  /**
   * Imported-image and freeform-element ids in bottom-to-top paint order.
   * Absent preserves the legacy order: shapes first, imported images above.
   */
  artworkLayerOrder?: string[];
  /**
   * Freeform vector shapes baked into the background PNG (800px space).
   * Absent in projects saved before the background design canvas.
   */
  backgroundElements?: CorosWatchfaceBackgroundElement[];
}

/**
 * Visual/editor state that can diverge between Current and Always-on without
 * duplicating archive-wide settings or raw config text.
 */
export type CorosWatchfaceModeDesignState = Partial<
  Pick<
    CorosWatchfaceDesignState,
    | "backgroundColor"
    | "accentColor"
    | "artwork"
    | "artworkVisible"
    | "zoom"
    | "fontFamily"
    | "rasterFont"
    | "fontWeight"
    | "fontStyle"
    | "letterSpacing"
    | "digitColor"
    | "tintLabels"
    | "tintIcons"
    | "previewComplication"
    | "metricChanges"
    | "metricStyles"
    | "kcalProgress"
    | "exerciseProgress"
    | "exerciseSeparator"
    | "selectableMetricStyle"
    | "controlComplicationEnabled"
    | "controlBarometerMode"
    | "controlIconOffsets"
    | "separateAutoTime"
    | "timeStyles"
    | "dateStyles"
    | "staticSeparators"
    | "ampmIndicator"
    | "weatherIndicator"
    | "layoutOffsets"
    | "linkedLayerGroups"
    | "editorGroups"
    | "editorGuides"
    | "lockedLayerIds"
    | "effectStyles"
    | "layerEffects"
    | "layerStrokes"
    | "layerVisibility"
    | "layerOpacities"
    | "layerColors"
    | "configAssetOverrides"
    | "designSprites"
    | "artworkLayerOrder"
    | "backgroundElements"
  >
> & {
  /** Whether Studio must emit a flattened background for this mode. */
  backgroundEdited?: boolean;
};

export interface CorosWatchfaceProjectSummary {
  projectId: string;
  name: string;
  updatedAt: string;
  /** Decimal text: official template IDs exceed Number.MAX_SAFE_INTEGER. */
  sourceTemplateId: string;
  /** Firmware family the project's starter template was selected for. */
  firmwareType?: string;
  /** Cached dashboard thumbnail, generated when the project was last saved. */
  previewDataUrl?: string;
}

export interface CorosWatchfaceProjectSaveInput {
  projectId?: string;
  name: string;
  sourceArchiveId: string;
  firmwareType?: string;
  design: CorosWatchfaceDesignState;
  /** Small rendered preview used by the projects dashboard. */
  previewDataUrl?: string;
}

export interface CorosWatchfaceEditableProject {
  name: string;
  design: CorosWatchfaceDesignState;
}

export interface CorosWatchfaceProjectExportInput
  extends CorosWatchfaceEditableProject {
  sourceArchiveId: string;
  firmwareType?: string;
  /** Current rendered face used by websites as the package thumbnail. */
  previewDataUrl: string;
}

export interface CorosWatchfaceProject extends CorosWatchfaceProjectSummary {
  archive: CorosWatchfaceArchive;
  design: CorosWatchfaceDesignState;
}

/** The official COROS hand-off link and an offline QR image for opening it. */
export interface CorosWatchfaceShareLink {
  url: string;
  qrDataUrl: string;
  expiresAt: string;
  previewImageUrl?: string;
}

export interface LocalTrack {
  id: string;
  url: string;
  title: string;
  filePath: string;
  sizeBytes: number;
  createdAt: string;
  transferredAt?: string;
}

export interface DownloadAudioResult {
  tracks: LocalTrack[];
  output: string[];
  warnings?: string[];
}

export type DownloadJobStatus =
  | "queued"
  | "downloading"
  | "completed"
  | "failed"
  | "cancelled";

export type DownloadActivityPhase =
  | "starting"
  | "downloading"
  | "converting"
  | "between_tracks"
  | "completed"
  | "failed";

export interface DownloadProgressUpdate {
  trackProgress?: number;
  trackIndex?: number;
  trackTotal?: number;
  currentTrackTitle?: string;
  phase?: DownloadActivityPhase;
  activity?: string;
  completedTrackIncrement?: number;
}

export interface DownloadJob {
  id: string;
  url: string;
  title: string;
  status: DownloadJobStatus;
  progress: number;
  error?: string;
  tracks: LocalTrack[];
  createdAt: string;
  updatedAt: string;
  entryType?: "video" | "playlist" | "search" | "audio";
  query?: string;
  fileBaseName?: string;
  phase?: DownloadActivityPhase;
  trackIndex?: number;
  trackTotal?: number;
  currentTrackTitle?: string;
  trackProgress?: number;
  activity?: string;
  completedTrackCount?: number;
  warning?: string;
}

export type DownloadQueueItem =
  | {
      url: string;
      title?: string;
    }
  | {
      source: "search";
      query: string;
      title: string;
      sourceUrl: string;
      fileBaseName?: string;
    }
  | {
      /** A directly downloadable public audio asset, such as a podcast RSS enclosure. */
      source: "audio";
      audioUrl: string;
      title: string;
      fileBaseName?: string;
    };

/** Live progress for a combined playlist download (many tracks → one MP3). */
export interface CombinedDownloadProgress {
  /** What the operation is currently doing. */
  phase: "downloading" | "merging" | "completed";
  /** 1-based index of the track currently downloading. */
  index: number;
  /** Total tracks being combined. */
  total: number;
  /** Display title of the track currently downloading. */
  title: string;
  /** 0..1 progress of the current track download. */
  trackProgress: number;
  /** The track was already present from an earlier interrupted attempt. */
  reused?: boolean;
}

/**
 * A progress update tagged with the id of the combined download it belongs to,
 * so concurrent combines (e.g. one per service) stay isolated in the UI.
 */
export interface CombinedDownloadProgressEvent extends CombinedDownloadProgress {
  id: string;
}

export interface CombinedDownloadResult {
  /** The merged MP3, registered in the local cache. */
  track: LocalTrack;
  /** Number of source tracks that were successfully downloaded and merged. */
  downloadedCount: number;
  /** Number of tracks restored from a previous attempt's cache. */
  reusedCount: number;
  /** Number of source tracks requested. */
  totalCount: number;
  warnings?: string[];
}

export type YouTubeHistoryEntryType =
  | "video"
  | "playlist"
  | "search"
  | "youtube";

export interface YouTubeHistoryEntry {
  url: string;
  title: string;
  entryType: YouTubeHistoryEntryType;
  visits: number;
  lastVisitedAt: string;
  downloadedAt?: string;
}

export interface YouTubeMusicStatus {
  configured: boolean;
  pythonAvailable: boolean;
  ytmusicapiAvailable: boolean;
  authenticated: boolean;
  authMethod?: "headers" | "oauth";
  authUpdatedAt?: string;
  syncedAt?: string;
  songCount: number;
  albumCount: number;
  playlistCount: number;
  dependencyError?: string;
}

export interface YouTubeMusicConfig {
  clientId: string;
  clientSecret: string;
}

export interface YouTubeMusicSong {
  id: string;
  videoId?: string;
  songTitle: string;
  albumTitle?: string;
  artistName?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
}

export interface YouTubeMusicAlbum {
  id: string;
  browseId?: string;
  playlistId?: string;
  albumTitle: string;
  artistName?: string;
  year?: string;
  thumbnailUrl?: string;
  songCount: number;
  songs: YouTubeMusicSong[];
}

export interface YouTubeMusicPlaylist {
  id: string;
  playlistId?: string;
  title: string;
  description?: string;
  thumbnailUrl?: string;
  songCount: number;
  songs: YouTubeMusicSong[];
}

export interface YouTubeMusicLibrary {
  albums: YouTubeMusicAlbum[];
  songs: YouTubeMusicSong[];
  playlists: YouTubeMusicPlaylist[];
  syncedAt?: string;
}

/**
 * Result pushed to the renderer when the embedded YouTube Music sign-in captures
 * credentials: the refreshed status on success, or a message if the ytmusicapi
 * setup failed (e.g. Python/ytmusicapi missing).
 */
export type YouTubeMusicAuthCapture =
  | { status: YouTubeMusicStatus; error?: undefined }
  | { status?: undefined; error: string };

export interface YouTubeMusicSyncResult extends YouTubeMusicLibrary {
  status: YouTubeMusicStatus;
}

export interface AppleMusicStatus {
  authenticated: boolean;
  hasUserToken: boolean;
  authUpdatedAt?: string;
}

export interface AppleMusicTrack {
  id: string;
  title: string;
  artistName?: string;
  albumName?: string;
  durationMs?: number;
  trackNumber?: number;
  isrc?: string;
  artworkUrl?: string;
  catalogUrl?: string;
}

export interface AppleMusicPlaylist {
  id: string;
  kind: "catalog" | "library";
  name: string;
  description?: string;
  curatorName?: string;
  lastModifiedAt?: string;
  artworkUrl?: string;
  url?: string;
  trackCount: number;
  tracks: AppleMusicTrack[];
}

/** A show returned by Apple's public podcast catalogue. */
export interface ApplePodcastShow {
  /** Apple Podcasts collection id, serialized so it is safe across IPC. */
  id: string;
  /** Two-letter storefront used to resolve this show. */
  storefront: string;
  title: string;
  authorName?: string;
  description?: string;
  artworkUrl?: string;
  genre?: string;
  episodeCount?: number;
  /** Canonical Apple Podcasts show URL, when Apple supplies one. */
  applePodcastsUrl?: string;
  /** Public RSS feed URL. Absent for feedless or restricted shows. */
  feedUrl?: string;
}

/** A publicly downloadable audio enclosure from a podcast RSS feed. */
export interface ApplePodcastEpisode {
  /** Stable RSS GUID when present, otherwise the enclosure URL. */
  id: string;
  title: string;
  description?: string;
  publishedAt?: string;
  durationSeconds?: number;
  episodeNumber?: number;
  seasonNumber?: number;
  artworkUrl?: string;
  audioUrl: string;
  mimeType?: string;
  sizeBytes?: number;
}

export interface ApplePodcastShowDetail extends ApplePodcastShow {
  episodes: ApplePodcastEpisode[];
  /** Total valid public RSS episodes currently available from this feed. */
  totalEpisodeCount: number;
  /** Whether another page of older episodes can be loaded in this session. */
  hasMoreEpisodes: boolean;
}

export interface TransferResult {
  copiedTrack: WatchTrack;
  watch: WatchStatus;
}

/**
 * Streamed progress for a single track being copied to the watch. Emitted from
 * the main process while `watch:transferLocalTrack` runs so the renderer can
 * show live progress instead of freezing on a synchronous copy.
 */
export interface WatchTransferProgress {
  /** Download id of the track currently transferring. */
  id: string;
  /** File name of the track currently transferring. */
  name: string;
  copiedBytes: number;
  totalBytes: number;
  /** 0..1 progress of the current file. */
  progress: number;
}

export type CorosMapType = "landscape" | "topo";

export interface CorosMapPackage {
  id: string;
  region: string;
  parent: string;
  title: string;
  type: CorosMapType;
  sizeBytes: number;
  link: string;
  downloadUrl: string;
  version: string;
  bundleVersion?: string;
  updatedAt?: string;
}

export interface CorosMapManifest {
  version: string;
  bundleVersion?: string;
  updatedAt?: string;
  totalSizeBytes?: number;
  packages: CorosMapPackage[];
}

export type CorosMapDownloadStatus =
  | "queued"
  | "downloading"
  | "cached"
  | "failed"
  | "cancelled";

export interface CorosMapDownloadJob {
  id: string;
  packageId: string;
  title: string;
  region: string;
  type: CorosMapType;
  downloadUrl: string;
  sizeBytes: number;
  status: CorosMapDownloadStatus;
  progress: number;
  receivedBytes: number;
  filePath?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CachedCorosMapPackage {
  packageId: string;
  title: string;
  region: string;
  parent: string;
  type: CorosMapType;
  sizeBytes: number;
  downloadUrl: string;
  filePath: string;
  extractedPath?: string;
  downloadedAt: string;
}

export interface CorosMapLocalSelection {
  sourcePath: string;
  mapPath: string;
  sizeBytes: number;
  fileCount: number;
}

export interface CorosMapInstallResult extends CorosMapLocalSelection {
  installedPath: string;
  watch: WatchStatus;
}

export type CorosMapInstallPhase =
  | "preparing"
  | "copying"
  | "completed"
  | "failed"
  | "cancelled";

export interface CorosMapInstallProgress {
  active: boolean;
  phase: CorosMapInstallPhase;
  label: string;
  sourcePath?: string;
  installedPath?: string;
  copiedBytes: number;
  totalBytes: number;
  copiedFiles: number;
  totalFiles: number;
  progress: number;
  error?: string;
  updatedAt: string;
}

export type RouteMode = "loop" | "point-to-point";
export type RouteSurfacePreference = "road" | "trail";
export type RouteElevationPreference = "any" | "flatter" | "hilly";
export type RouteActivityType =
  | "walking"
  | "running"
  | "hiking"
  | "cycling-road"
  | "cycling-mountain";

/**
 * Which routing/geocoding backend the Route Studio uses.
 * - `keyless` (default): BRouter + Nominatim, no signup required.
 * - `ors`: OpenRouteService, requires a saved API key (power users).
 */
export type RouteBackend = "keyless" | "ors";

export interface RouteBuilderConfig {
  /** Optional OpenRouteService key; only used when `backend` is `ors`. */
  openRouteServiceApiKey: string;
  /** Selected routing backend. Absent is treated as `keyless`. */
  backend?: RouteBackend;
}

/** A single map waypoint the draw tool routes through. */
export interface RouteWaypoint {
  lat: number;
  lon: number;
}

/**
 * Request for the interactive draw tool. `snap` routes each leg along real
 * roads/trails (BRouter); otherwise legs are straight lines.
 */
export interface RouteWaypointRequest {
  waypoints: RouteWaypoint[];
  activityType: RouteActivityType;
  snap: boolean;
}

/** Geometry + stats for a routed path, without any persistence. */
export interface RouteGeometry {
  points: TrainingHubTrackPoint[];
  distanceMeters: number;
  durationSeconds?: number;
  ascentMeters?: number;
  descentMeters?: number;
}

/** Payload used to persist a finished drawn route. */
export interface DrawnRoutePayload {
  name?: string;
  waypoints: RouteWaypoint[];
  points: TrainingHubTrackPoint[];
  distanceMeters: number;
  durationSeconds?: number;
  ascentMeters?: number;
  descentMeters?: number;
  activityType: RouteActivityType;
  /** True when the path returns to its start (a loop). */
  closed: boolean;
  snap: boolean;
  /** Controls user-facing generated route names only. */
  unitSystem?: UnitSystem;
}

export interface RouteApiKeyValidation {
  status: "valid" | "invalid" | "quota" | "error" | "empty";
  message: string;
}

export interface ActivityPaceBaseline {
  /** Typical (median) pace in seconds per kilometre for a sport. */
  secondsPerKm: number;
  /** Number of stored activities the pace was derived from. */
  sampleSize: number;
}

/** Personal pace baselines keyed by route activity type (only sports with data). */
export type ActivityPaceBaselines = Partial<
  Record<RouteActivityType, ActivityPaceBaseline>
>;

export interface RouteShareSession {
  /** Full LAN URL the QR encodes; the phone fetches the GPX from here. */
  url: string;
  /** PNG data URL of the QR code for the share URL. */
  qrDataUrl: string;
  fileName: string;
  /** LAN IP the GPX is served from (shown for troubleshooting). */
  lanAddress: string;
  /** ISO timestamp when the share link auto-expires. */
  expiresAt: string;
}

export interface RouteGeocodeResult {
  label: string;
  lat: number;
  lon: number;
  city?: string;
  country?: string;
}

export interface GenerateRouteRequest {
  startLocation: string;
  destinationLocation?: string;
  distanceKm: number;
  mode: RouteMode;
  activityType: RouteActivityType;
  surfacePreference: RouteSurfacePreference;
  avoidHighways: boolean;
  elevationPreference: RouteElevationPreference;
  /** Controls user-facing route names and validation messages only. */
  unitSystem: UnitSystem;
  /**
   * Optional nudge used only for loop routes. Changing it produces a different
   * loop for the same inputs (powers the "Regenerate" control). Absent keeps the
   * deterministic default behaviour.
   */
  variationSeed?: number;
}

export interface GeneratedRoute {
  id: string;
  name: string;
  createdAt: string;
  startLocation: string;
  destinationLocation?: string;
  distanceMeters: number;
  durationSeconds?: number;
  ascentMeters?: number;
  descentMeters?: number;
  mode: RouteMode;
  activityType: RouteActivityType;
  surfacePreference: RouteSurfacePreference;
  avoidHighways: boolean;
  elevationPreference: RouteElevationPreference;
  points: TrainingHubTrackPoint[];
  bounds?: {
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
  };
  gpxPath?: string;
}

export interface SpotifyConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface SpotifyStatus {
  configured: boolean;
  authenticated: boolean;
  redirectUri: string;
  displayName?: string;
  userId?: string;
  tokenExpiresAt?: string;
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  ownerId: string;
  ownerName: string;
  collaborative: boolean;
  public: boolean | null;
  totalTracks: number;
  snapshotId: string;
  syncable: boolean;
  description?: string;
  artworkUrl?: string;
  url?: string;
}

export interface SpotifyPlaylistTrack {
  spotifyTrackId: string;
  artistName: string;
  trackName: string;
  albumName?: string;
  durationMs?: number;
  addedAt?: string;
  filename: string;
  query: string;
  artworkUrl?: string;
}

export type SpotifySyncTrackStatus =
  | "queued"
  | "downloading"
  | "done"
  | "failed";

export interface SpotifySyncTrack {
  playlistId: string;
  spotifyTrackId: string;
  artistName: string;
  trackName: string;
  query: string;
  filename: string;
  status: SpotifySyncTrackStatus;
  localDownloadId?: string;
  filePath?: string;
  error?: string;
  updatedAt: string;
}

export interface SpotifySyncUpdate extends SpotifySyncTrack {}

export interface SpotifySyncResult {
  playlistId: string;
  tracks: SpotifySyncTrack[];
  completed: number;
  failed: number;
}

export interface TrainingHubStatus {
  authenticated: boolean;
  userId?: string;
  regionId?: string;
  baseUrl?: string;
  rememberCredentials?: boolean;
  email?: string;
  /**
   * A start-up re-login is in flight right now.
   *
   * `authenticated` is false while this is true, and the two mean very
   * different things to a screen: signed out is a state that waits for the
   * athlete, whereas this one resolves on its own in a second or two. Anything
   * that offers a sign-in form or empties itself on `!authenticated` has to
   * check this first, or a launch that is busy signing itself back in shows the
   * athlete a login screen and throws away the data it is about to refill.
   */
  restoring?: boolean;
}

// Result of a login/reconnect attempt. When the COROS account has two-factor
// authentication enabled, the first step returns `twoFactorRequired: true`
// (with the code already emailed) and the caller must complete the flow via
// `verifyTrainingHubTwoFactor(code)`.
export interface TrainingHubLoginResult {
  twoFactorRequired: boolean;
  status: TrainingHubStatus;
  // Account (email) awaiting a 2FA code — used by the UI copy while verifying.
  email?: string;
}

// The account profile behind `/account/query` on teamapi.coros.com. Everything
// here is read back from that one response; `unit` only switches display, so
// the stored numbers stay metric (cm / kg) regardless of it.
export interface CorosProfile {
  userId: string;
  nickname?: string;
  email?: string;
  /** Absolute https URL of the COROS-hosted avatar. */
  avatarUrl?: string;
  countryCode?: string;
  language?: string;
  /** COROS packs the birthday as a YYYYMMDD integer, e.g. 19940626. */
  birthday?: number;
  /** 0 = male, 1 = female, as COROS encodes it in `sex`. */
  sex?: number;
  statureCm?: number;
  weightKg?: number;
  /** 0 = metric, 1 = imperial. */
  unit?: number;
  /** 0 = Celsius, 1 = Fahrenheit. */
  temperatureUnit?: number;
  /**
   * Which heart-rate model the zones are built on: 1 = max heart rate,
   * 2 = heart-rate reserve, 3 = lactate threshold. Read off the COROS web
   * client, whose picker maps these three codes to "Max Heart Rate Zone",
   * "Heart Rate Reserve Zone" and "Lactate Threshold HR Zone".
   */
  hrZoneType?: number;
  /** Server-side timestamp of the last max-HR write, "YYYY-MM-DD HH:mm:ss". */
  maxHrUpdatedAt?: string;
  twoFactorRequired?: boolean;
  /** Activities COROS has on file (`sportDataSummary.count`). */
  activityCount?: number;
  thresholds: CorosProfileThresholds;
}

/** One zone row; which metric is filled depends on the family it belongs to. */
export interface CorosProfileZone {
  index: number;
  /** Percent of the family's reference value. */
  ratio?: number;
  bpm?: number;
  paceSecondsPerKm?: number;
  watts?: number;
}

export type CorosProfileZoneFamily =
  | "maxHr"
  | "restingHr"
  | "lthr"
  | "thresholdPace"
  | "cyclePower";

/** Inclusive bounds COROS accepts for an editable threshold. */
export interface CorosProfileRange {
  min: number;
  max: number;
}

export interface CorosProfileThresholds {
  maxHr?: number;
  restingHr?: number;
  /** Lactate-threshold heart rate. */
  lthr?: number;
  /** Lactate-threshold pace, in seconds per kilometre. */
  thresholdPaceSecondsPerKm?: number;
  /** Functional threshold power, watts. */
  ftp?: number;
  zones: Record<CorosProfileZoneFamily, CorosProfileZone[]>;
  /** Server-declared valid ranges, used to validate before writing. */
  ranges: Partial<Record<CorosProfileZoneFamily | "ftp" | "weightKg", CorosProfileRange>>;
}

/**
 * Everything the Personal screen needs, in one payload: the account
 * profile plus the dashboard the fitness-score and race-predictor panels read.
 * The dashboard is null when only that half of the fetch failed — the screen
 * still has a profile to show.
 */
export interface CorosProfileSnapshot {
  profile: CorosProfile;
  dashboard: TrainingHubDashboard | null;
  /** ISO timestamp of the fetch this snapshot came from, cache hits included. */
  cachedAt: string;
}

// Fields `/account/update` actually persists. Verified field by field against
// the live endpoint on 2026-09-04 by writing a changed value, reading it back
// and restoring the original: every key below took effect, `sex` did not (the
// server ignores it — the gender write is named `gender`), and the request must
// be multipart/form-data. A JSON body answers `0000` and silently saves nothing.
export interface CorosProfilePatch {
  nickname?: string;
  /** YYYYMMDD, e.g. 19940626. */
  birthday?: number;
  /** 0 = male, 1 = female. Sent to COROS as `gender`. */
  sex?: number;
  statureCm?: number;
  weightKg?: number;
  maxHr?: number;
  restingHr?: number;
  unit?: number;
  temperatureUnit?: number;
  /**
   * 1 = max heart rate, 2 = heart-rate reserve, 3 = lactate threshold.
   * Switching models makes COROS rebuild the zones, so the write carries the
   * anchor value and zone table that model runs on, the way the web client
   * sends them.
   */
  hrZoneType?: number;
}

// COROS `/activity/detail/download` file-type codes. Verified against the live
// teamapi.coros.com endpoint: 0=CSV, 1=GPX, 2=KML, 3=TCX, 4=FIT (5/6 are rejected).
export type TrainingHubActivityFileType = 0 | 1 | 2 | 3 | 4;

export interface TrainingHubExportFormat {
  fileType: TrainingHubActivityFileType;
  /** Short label shown in the UI, e.g. "GPX". */
  label: string;
  /** Lower-case file extension without a leading dot, e.g. "gpx". */
  extension: string;
  /** One-line hint describing what the format is good for. */
  description: string;
}

// Ordered for the export menu: the everyday formats first, raw data last.
export const TRAINING_HUB_EXPORT_FORMATS: readonly TrainingHubExportFormat[] = [
  {
    fileType: 4,
    label: "FIT",
    extension: "fit",
    description: "Original COROS activity file"
  },
  {
    fileType: 1,
    label: "GPX",
    extension: "gpx",
    description: "GPS track for GPX Studio, Plotaroute, sharing"
  },
  {
    fileType: 3,
    label: "TCX",
    extension: "tcx",
    description: "Training Center XML with heart rate & laps"
  },
  {
    fileType: 2,
    label: "KML",
    extension: "kml",
    description: "Route for Google Earth"
  },
  {
    fileType: 0,
    label: "CSV",
    extension: "csv",
    description: "Raw data points as a spreadsheet"
  }
];

export interface TrainingHubExportResult {
  /** False when the user cancelled the save dialog. */
  saved: boolean;
  /** Absolute path the file was written to, when saved. */
  filePath?: string;
  /** Activity metadata for convenience messages after a save dialog closes. */
  activityId?: string;
  activityName?: string;
  activityStartTime?: number;
  fileType?: TrainingHubActivityFileType;
  formatLabel?: string;
}

export type ActivityBackupState =
  | "listing"
  | "downloading"
  | "done"
  | "cancelled"
  | "error";

/** Live progress for a bulk activity backup run. */
export interface ActivityBackupProgress {
  state: ActivityBackupState;
  folder: string;
  fileType: TrainingHubActivityFileType;
  formatLabel: string;
  /** Activities discovered on the COROS account (0 while listing). */
  total: number;
  /** Files downloaded during this run. */
  completed: number;
  /** Activities skipped because the file already exists in the folder. */
  skipped: number;
  failed: number;
  /** Name of the activity currently downloading. */
  currentName?: string;
  error?: string;
}

export interface TrainingHubActivity {
  activityId: string;
  name?: string;
  sportType: number;
  sportName?: string;
  startTime?: number;
  endTime?: number;
  duration?: number;
  distance?: number;
  avgHr?: number;
  maxHr?: number;
  calories?: number;
  trainingLoad?: number;
  elevationGain?: number;
}

export interface RpeDistributionBucket {
  /** RPE level 1..5. */
  level: number;
  /** Number of rated sessions at this level. */
  frequency: number;
  /** Sum of session sRPE (Foster CR10 × duration minutes) at this level. */
  srpe: number;
  /** Sum of duration seconds at this level. */
  timeSeconds: number;
}

export interface RpeDistribution {
  /** Exactly 5 buckets, level 1..5, always present (zeros allowed). */
  buckets: RpeDistributionBucket[];
  coverage: {
    /** Activities with feel_type in 1..5 within the window. */
    rated: number;
    /** All activities within the window (rated + unrated). */
    total: number;
  };
}

export interface TrainingHubDailyMetric {
  happenDay: string;
  trainingLoad?: number;
  /** Foster session-RPE load (AU) for the day, from cached activity feelType. */
  rpeLoad?: number;
  rhr?: number;
  avgSleepHrv?: number;
  sleepHrvBase?: number;
  tiredRateNew?: number;
  tiredRateStateNew?: number;
  trainingLoadRatio?: number;
  staminaLevel?: number;
  vo2max?: number;
  distance?: number;
  duration?: number;
}

export interface TrainingHubDailyMetrics {
  dayList: TrainingHubDailyMetric[];
  weekList: Record<string, unknown>[];
  raw?: Record<string, unknown>;
}

export interface TrainingHubSportStatistic {
  sportType?: number;
  sportName?: string;
  distance?: number;
  duration?: number;
  count?: number;
  trainingLoad?: number;
}

export interface TrainingHubZoneDistributionEntry {
  index: number;
  ratio?: number;
  value?: number;
}

/**
 * Heart-rate buckets only. COROS also ships distance buckets in the same
 * payload, on 5 km boundaries it never states and padded with sessions that
 * recorded no distance — see the note on `parseZoneDistributions`; the
 * Distance Zones panel tallies its own.
 */
export interface TrainingHubZoneDistributions {
  hrTrainingLoad: TrainingHubZoneDistributionEntry[];
  hrDistance: TrainingHubZoneDistributionEntry[];
  hrTime: TrainingHubZoneDistributionEntry[];
}

export interface TrainingHubAnalytics {
  dayList: TrainingHubDailyMetric[];
  weekList: Record<string, unknown>[];
  sportStatistics: TrainingHubSportStatistic[];
  zoneDistributions: TrainingHubZoneDistributions;
  rpeDistribution: RpeDistribution;
  raw?: Record<string, unknown>;
}

export interface TrainingHubRaceScore {
  distance?: number;
  distanceLabel?: string;
  predictSeconds?: number;
  avgPace?: number;
  score?: number;
  raw?: Record<string, unknown>;
}

export interface TrainingHubRacePredictor {
  staminaLevel?: number;
  recoveryPct?: number;
  aerobicEnduranceScore?: number;
  lactateThresholdCapacityScore?: number;
  anaerobicEnduranceScore?: number;
  anaerobicCapacityScore?: number;
  lthr?: number;
  ltsp?: number;
  runScoreList: TrainingHubRaceScore[];
  raw?: Record<string, unknown>;
}

/**
 * What a structured-workout lap was for. Read off the COROS lap `mode`, which
 * a structured run files as 2–5 (interval, recovery, warm-up, cool-down) and a
 * gym session as 14/15 (set, rest). `mode` values outside those leave `phase`
 * absent rather than guessing — the same field is 0 on an unstructured run and
 * carries roll-up codes 16/17 the lap grouping already separates out.
 */
export type TrainingHubLapPhase =
  | "warmup"
  | "work"
  | "recovery"
  | "cooldown"
  | "set"
  | "rest";

export interface TrainingHubActivityLap {
  index: number;
  distance?: number;
  duration?: number;
  avgHr?: number;
  maxHr?: number;
  pace?: number;
  elevationGain?: number;
  /** Raw COROS lap `mode`, kept so an unmapped value stays inspectable. */
  mode?: number;
  /** Structured-workout phase, when `mode` names one. */
  phase?: TrainingHubLapPhase;
  /** Steps per minute for foot sports, rpm for cycling. */
  avgCadence?: number;
  maxCadence?: number;
  /** Metres. COROS sends centimetres. */
  strideLength?: number;
  /** Ground contact time, milliseconds. */
  groundTime?: number;
  /** Vertical oscillation, centimetres. COROS sends millimetres. */
  verticalOscillation?: number;
  /** Vertical oscillation as a percentage of stride length. COROS sends tenths. */
  verticalRatio?: number;
  avgPower?: number;
}

/**
 * Activity-level running/cycling dynamics.
 *
 * COROS reports each of these twice — once as a `summary.avg*` field and once
 * as the `avg` of the matching `graphList` channel — and the two disagree: on a
 * Pace Pro run `summary.avgGroundTime`, `avgVertVibration` and `avgVertRatio`
 * all come back 0 while the graph channels carry 303 ms, 85 mm and 10.0%. Zero
 * is COROS's "not recorded" here, so the parser reads the summary first and
 * falls back to the channel, which lands on the real number either way.
 */
export interface TrainingHubActivityDynamics {
  /** Steps per minute for foot sports, rpm for cycling. */
  avgCadence?: number;
  maxCadence?: number;
  /** Metres. */
  strideLength?: number;
  /** Metres. */
  maxStrideLength?: number;
  /** Ground contact time, milliseconds. */
  groundTime?: number;
  /** Ground contact time, milliseconds. */
  maxGroundTime?: number;
  /** Vertical oscillation, centimetres. */
  verticalOscillation?: number;
  /** Vertical oscillation, centimetres. */
  maxVerticalOscillation?: number;
  /** Vertical oscillation as a percentage of stride length. */
  verticalRatio?: number;
  /** Vertical oscillation as a percentage of stride length. */
  maxVerticalRatio?: number;
  avgPower?: number;
  maxPower?: number;
}

/**
 * One bucket of an activity's own zone distribution. `index` 0 is COROS's
 * below-zone-1 bucket — it repeats zone 1's bounds rather than carrying its
 * own, so only `high` is meaningful there.
 */
export interface TrainingHubActivityZoneBucket {
  index: number;
  /** Lower bound in bpm. */
  low?: number;
  /** Upper bound in bpm. */
  high?: number;
  seconds?: number;
  percent?: number;
}

/** Training effect and VO2max as COROS scored this single activity. */
export interface TrainingHubActivityEffect {
  /** Aerobic training effect, 0–5. */
  aerobic?: number;
  /** Anaerobic training effect, 0–5. */
  anaerobic?: number;
  /** VO2max as of this activity. */
  vo2max?: number;
}

/** Conditions COROS recorded for the activity. Absent for indoor sports. */
export interface TrainingHubActivityWeather {
  temperatureC?: number;
  feelsLikeC?: number;
  humidityPct?: number;
}

export interface TrainingHubTrackPoint {
  lat?: number;
  lon?: number;
  elevation?: number;
  distance?: number;
}

export interface TrainingHubActivityTrack {
  points: TrainingHubTrackPoint[];
}

/**
 * One sample of an activity's recorded channels. Every field is optional and
 * populated independently: COROS fills whichever channels the watch and its
 * pods recorded, so a wrist-only easy run carries HR and pace while a Pace Pro
 * run adds the whole running-form group.
 */
export interface TrainingHubActivitySeriesPoint {
  /** Seconds from the start of the activity. */
  elapsed?: number;
  distance?: number;
  hr?: number;
  pace?: number;
  power?: number;
  /** Metres above sea level. */
  altitude?: number;
  /** Steps per minute for foot sports, rpm for cycling. */
  cadence?: number;
  /** Metres. COROS sends centimetres. */
  strideLength?: number;
  /** Ground contact time, milliseconds. */
  groundTime?: number;
  /** Vertical oscillation, centimetres. COROS sends millimetres. */
  verticalOscillation?: number;
  /** Vertical oscillation as a percentage of stride length. COROS sends tenths. */
  verticalRatio?: number;
}

export interface StrengthSet {
  reps: number;
  weightKg: number;
  workSec: number;
  restSec: number;
  calories: number;
  /** Original set classification when supplied by an external strength log. */
  type?: StrengthSetType;
  /** Rating of perceived exertion, on Hevy's 1–10 scale. */
  rpe?: number;
}

export type StrengthSetType = "normal" | "warmup" | "dropset" | "failure";

export type StrengthSource = "coros" | "hevy" | "combined";

export type StrengthDataSource = StrengthSource;

export interface StrengthSourceIds {
  coros?: string;
  hevy?: string;
}

export interface StrengthExercise {
  nameKey: string;   // "T####"/"S####" library code, or a custom name
  rawName?: string;  // payload name, used to resolve custom exercises
  /** Provider exercise/template identity, when one exists. */
  externalId?: string;
  /** Provider exercise classification (for example, `weight_reps`). */
  exerciseType?: string;
  /** Hevy muscle metadata, used only when name-based resolution has no match. */
  primaryMuscleGroup?: string;
  secondaryMuscleGroups?: string[];
  sets: number;
  totalReps: number;
  entries: StrengthSet[];
}

export interface StrengthSummary {
  sets: number;
  totalReps: number;
  totalWeightKg: number;
  exercises: number;
  calories: number;
  durationSec: number;
  avgHr?: number;
  maxHr?: number;
  trainingLoad?: number;
  aerobicEffect?: number;
  anaerobicEffect?: number;
}

export interface StrengthDetail {
  summary: StrengthSummary;
  exercises: StrengthExercise[];
}

/** One completed strength activity plus its cached set-by-set breakdown. */
export interface StrengthSession {
  activityId: string;
  /** Absent on legacy cached rows, which are implicitly COROS sessions. */
  source?: StrengthSource;
  sourceIds?: StrengthSourceIds;
  sportType: number;
  name?: string;
  sportName?: string;
  /** Epoch seconds. */
  startTime?: number;
  duration?: number;
  calories?: number;
  avgHr?: number;
  maxHr?: number;
  trainingLoad?: number;
  detail: StrengthDetail;
}

export interface StrengthHistory {
  sessions: StrengthSession[];
  /** Strength activities in the window whose breakdown is not cached yet. */
  pending: number;
  /** Breakdowns fetched from COROS during this call. */
  fetched: number;
  /** Window length in days that produced this history. */
  days: number;
  /** Source selection used to produce this history. */
  source?: StrengthDataSource;
  pendingBySource?: Partial<Record<Exclude<StrengthSource, "combined">, number>>;
  fetchedBySource?: Partial<Record<Exclude<StrengthSource, "combined">, number>>;
  /** Non-fatal provider errors; cached sessions remain usable. */
  warnings?: string[];
}

export interface StrengthHistoryRequest {
  days?: number;
  force?: boolean;
  source?: StrengthDataSource;
}

export interface HevyStatus {
  connected: boolean;
  userId?: string;
  displayName?: string;
  profileUrl?: string;
  lastSyncedAt?: string;
  includeWarmups: boolean;
}

export interface HevySettingsInput {
  includeWarmups: boolean;
}

export interface TrainingHubActivityDetail {
  activityId?: string;
  name?: string;
  sportType?: number;
  sportName?: string;
  startTime?: number;
  duration?: number;
  distance?: number;
  avgHr?: number;
  maxHr?: number;
  calories?: number;
  elevationGain?: number;
  /** Total descent in metres. */
  elevationLoss?: number;
  trainingLoad?: number;
  /** Grade-adjusted pace in seconds per kilometre. */
  adjustedPace?: number;
  laps: TrainingHubActivityLap[];
  dynamics?: TrainingHubActivityDynamics;
  /** This activity's own HR zone distribution, empty when COROS sent none. */
  hrZones: TrainingHubActivityZoneBucket[];
  effect?: TrainingHubActivityEffect;
  weather?: TrainingHubActivityWeather;
  track?: TrainingHubActivityTrack;
  series?: TrainingHubActivitySeriesPoint[];
  strength?: StrengthDetail;
  raw: Record<string, unknown>;
}

export interface TrainingHubScheduledExercise {
  name: string;
  sets?: number;
  reps?: number;
  weight?: number;
  targetType?: number;
  targetLabel?: string;
}

export interface TrainingHubSportType {
  sportType: number;
  sportName: string;
}

export interface TrainingHubUpcomingWorkout {
  happenDay: string;
  name: string;
  volume?: string;
  trainingLoad?: number;
  sportType?: number;
  sortNo?: number;
  exercises?: TrainingHubScheduledExercise[];
}

export interface TrainingHubThresholdZone {
  index: number;
  hr?: number;
  pace?: number;
  ratio?: number;
}

export interface TrainingHubPersonalRecord {
  type: number;
  label: string;
  name?: string;
  distance?: number;
  duration?: number;
  avgPace?: number;
  happenDay?: string;
  activityId?: string;
  /** Raw COROS record `type` before alias resolution (used when deduping). */
  apiType?: number;
}

export interface TrainingHubPersonalRecordGroup {
  type: number;
  label: string;
  records: TrainingHubPersonalRecord[];
}

export interface TrainingHubSleepHrvReading {
  happenDay: string;
  avgSleepHrv?: number;
  sleepHrvBase?: number;
}

export interface TrainingHubSleepHrvSummary {
  happenDay?: string;
  avgSleepHrv?: number;
  sleepHrvBase?: number;
  remainWearDays?: number;
  recentReadings: TrainingHubSleepHrvReading[];
}

export interface TrainingHubSleepRecord {
  happenDay: string;
  kind?: "main" | "nap";
  completeness?: "complete" | "partial";
  partialReason?: string;
  totalMinutes?: number;
  score?: number;
  deepMinutes?: number;
  lightMinutes?: number;
  remMinutes?: number;
  awakeMinutes?: number;
  deepPercent?: number;
  lightPercent?: number;
  remPercent?: number;
  awakePercent?: number;
  awakeCountOverFiveMinutes?: number;
  windowMinutes?: number;
  napMinutes?: number;
  napStart?: string;
  napEnd?: string;
  avgHr?: number;
  /** The night's heart-rate range, folded in from the daily health feed. */
  minHr?: number;
  maxHr?: number;
  sleepStart?: string;
  sleepEnd?: string;
  /**
   * The calendar days the window's two ends fall on, as `yyyyMMdd`, when COROS
   * dated them. It writes `Main Sleep Window: 2026-09-08 00:40 - 2026-09-08
   * 06:00`, so a night that began before midnight says so outright instead of
   * leaving the clock times to be guessed at.
   */
  sleepStartDay?: string;
  sleepEndDay?: string;
}

export interface TrainingHubSleepSummary {
  latest?: TrainingHubSleepRecord;
  records: TrainingHubSleepRecord[];
  mcpConnected: boolean;
}

/**
 * One reading inside a night. `at` is the true instant; `clock` is what the
 * watch showed at the time, carried alongside because COROS sends its own UTC
 * offset per point and the machine reading this may sit in another timezone.
 */
export interface SleepSeriesPoint {
  /** The true instant, UTC. */
  at: number;
  /**
   * The same instant in the athlete's own timezone, expressed as if it were
   * UTC. Charts plot against this and the sleep window's bounds, which share
   * the frame — so a night reads the same on a machine in another timezone.
   */
  localAt: number;
  clock: string;
  value: number;
}

/** COROS's own verdict on a night's HRV — never recomputed from the points. */
export interface SleepHrvAssessment {
  happenDay: string;
  avg?: number;
  normalLow?: number;
  normalHigh?: number;
  baseline?: number;
  evaluation?: string;
}

/**
 * What happened across one night, sample by sample. Not sleep stages — COROS
 * sends none — but the two series it does send inside the sleep window.
 */
export interface SleepNightSeries {
  happenDay: string;
  hrv: SleepSeriesPoint[];
  stress: SleepSeriesPoint[];
  assessment?: SleepHrvAssessment;
  /** The sleep window the series were clipped to, as epoch ms. */
  windowStart?: number;
  windowEnd?: number;
  fetchedAt?: number;
  source: "cache" | "network";
  mcpConnected: boolean;
  error?: string;
}

/**
 * Whether a snapshot cost a request. `"cache"` means it did not — the line the
 * screen shows says "cached" rather than "updated" on the strength of it.
 */
export type SleepHistorySource = "cache" | "network";

export interface SleepHistorySnapshot {
  /** Nights newest first, main sleeps only — naps are folded into their night. */
  records: TrainingHubSleepRecord[];
  /** Last night, by the rule in `src/training/sleepFreshness.ts`. */
  latest?: TrainingHubSleepRecord;
  mcpConnected: boolean;
  /** Epoch ms the newest record in this snapshot was fetched from COROS. */
  fetchedAt?: number;
  source: SleepHistorySource;
  /** Set when a network fill was attempted and failed; the cache still stands. */
  error?: string;
}

export interface TrainingHubDailyHealthRecord {
  happenDay: string;
  steps?: number;
  calories?: number;
  /**
   * Heart rate through the night, which arrives here and nowhere else:
   * `querySleepData` sends no heart rate at all, and every other COROS surface
   * averages over the whole day. Dated by wake-up day, like the sleep it
   * belongs to.
   */
  sleepAvgHr?: number;
  sleepMinHr?: number;
  sleepMaxHr?: number;
}

export interface TrainingHubDailyHealthSummary {
  latest?: TrainingHubDailyHealthRecord;
  records: TrainingHubDailyHealthRecord[];
  mcpConnected: boolean;
}

export interface TrainingHubDashboard {
  racePredictor: TrainingHubRacePredictor;
  rhr?: number;
  recoveryPct?: number;
  recoveryState?: number;
  fullRecoveryHours?: number;
  fitnessMaxHr?: number;
  runningLevelHr?: number;
  lthrZones: TrainingHubThresholdZone[];
  ltspZones: TrainingHubThresholdZone[];
  personalRecords: TrainingHubPersonalRecordGroup[];
  sleepHrv?: TrainingHubSleepHrvSummary;
  sportDataCount?: number;
  raw?: Record<string, unknown>;
}

export type AppUpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "error";

export interface AppUpdateSnapshot {
  supported: boolean;
  currentVersion: string;
  status: AppUpdateStatus;
  availableVersion?: string;
  downloadPercent?: number;
  releaseNotes?: string;
  error?: string;
  /** macOS ad-hoc builds cannot self-install; user must open the release asset. */
  installMethod?: "restart" | "manual";
  manualInstallUrl?: string;
  /** When false, the app does not check for updates automatically on startup. */
  autoCheck: boolean;
  /** When false, available updates are not downloaded until the user asks. */
  autoDownload: boolean;
}

export interface AppStorageLocation {
  id: string;
  label: string;
  description: string;
  path: string;
  kind: "directory" | "file";
  exists: boolean;
  /** Null when the location does not exist or its size could not be read. */
  sizeBytes: number | null;
}

export interface AppInfo {
  version: string;
  electronVersion: string;
  chromeVersion: string;
  nodeVersion: string;
  platform: string;
  arch: string;
  userDataPath: string;
  storageLocations: AppStorageLocation[];
}

// ----- Training Coach chatbot -----

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/** Optional assistant attribution metadata stored with a message. */
export interface PersistedChatSource {
  snapshotIncluded: boolean;
  mcpEnabled: boolean;
  mcpUsed: boolean;
  mcpTools: string[];
  mcpError?: string;
}

/**
 * Marks a transcript entry as written by an analysis rather than by the athlete
 * or an interactive turn. A conversation can host up to five analyses, so the
 * marker carries the name: the UI renders `\u26a1 <name> \u00b7 <triggerLabel>` so the
 * athlete can tell which one spoke.
 *
 * **`automationId` is a stored JSON key, not a name anyone chose again.** This
 * marker is written into `chat_sessions` transcripts, and every entry an
 * athlete already has spells it that way. Renaming it would cost every
 * historical run its attribution — the chip would render nameless — for no
 * gain a person can see. Chat transcripts are the athlete's own record and
 * outlive any number of refactors on the side that writes into them.
 */
export interface ChatEntryAnalysisMarker {
  runId: string;
  /** The analysis id. Stored under its pre-rename key; see above. */
  automationId: string;
  /**
   * The attachment id, on entries written while attachments existed. Nothing
   * writes it any more — an analysis is its own place now — and it is optional
   * rather than deleted so that transcripts holding one still parse and still
   * render their chip.
   */
  bindingId?: string;
  name: string;
  triggerLabel: string;
}

export interface PersistedChatMessageEntry {
  kind: "message";
  role: ChatRole;
  content: string;
  source?: PersistedChatSource;
  /** Display-safe provider reasoning summary, never raw chain-of-thought. */
  reasoningSummary?: string;
  /**
   * Set when an analysis produced this entry. The synthetic user turn that
   * carries the playbook is stored with `role: "user"` and the same marker,
   * rendered as a chip rather than an athlete bubble.
   */
  automation?: ChatEntryAnalysisMarker;
}

/**
 * An analysis looked and had nothing to say (5.5). A silent run writes no
 * answer, so without this entry the athlete watching sees the live bubble
 * vanish mid-sentence and the conversation keeps no record that it ever ran —
 * which reads as a bug rather than as a verdict.
 *
 * `kind` and the `automation` field are stored discriminators; see
 * `ChatEntryAnalysisMarker` for why they keep their pre-rename spelling.
 */
export interface PersistedChatAnalysisSilentEntry {
  kind: "automationSilent";
  automation: ChatEntryAnalysisMarker;
  /** Epoch milliseconds. The chip shows when it looked. */
  at: number;
}

/**
 * How a `chat:saveSession` call describes what it is based on (5.6b). Lives
 * here rather than beside the store because the renderer declares the same
 * call and must not import a main-process module to do it.
 */
export interface SaveChatSessionOptions {
  /**
   * How many of the stored entries the caller's array accounts for. Anything
   * the row holds beyond that arrived from somewhere else — in practice a coach
   * analysis writing from the main process while the window held a copy from
   * before the run — and is kept instead of being overwritten.
   *
   * Omitting it replaces the row outright, which is what the runner wants: it
   * re-read the transcript itself a moment earlier, with nothing awaited in
   * between.
   */
  knownEntryCount?: number;
}

export interface CoachInputChoice {
  id: string;
  label: string;
  description?: string;
  /** Text sent back to Coach when the athlete selects this choice. */
  response: string;
}

export interface CoachInputPrompt {
  promptId: string;
  question: string;
  choices: CoachInputChoice[];
  allowCustom: boolean;
  /** Athlete response retained as model context without a separate chat bubble. */
  answer?: string;
  selectedChoiceId?: string;
  answeredAt?: number;
}

export type ChatProvider =
  | "chatgpt"
  | "claude-api"
  | "claude-code"
  | "openrouter"
  | "local";

export type ClaudeCodeConnectionState =
  | "not-installed"
  | "sign-in-required"
  | "connecting"
  | "connected"
  | "connection-failed"
  | "usage-limit-reached";

export interface ClaudeCodePermissions {
  recentActivities: boolean;
  trainingMetrics: boolean;
  upcomingWorkouts: boolean;
  sleepData: boolean;
  fullActivityFiles: boolean;
}

export interface ClaudeCodeConfig {
  /** Optional user-selected path. Heracles Records never reads Claude credential files. */
  executablePath?: string;
  /**
   * When true (the default) Claude Code runs against a Heracles Records-only
   * CLAUDE_CONFIG_DIR, so the app signs in to its own account instead of
   * borrowing whichever one the machine's CLI is using.
   */
  useAppScopedAuth: boolean;
  /** Model alias (e.g. "opus", "sonnet", "haiku") or full id. Empty = account default. */
  model?: string;
  /** Reasoning effort. The Agent SDK downgrades levels a model cannot serve. */
  effort: AnthropicEffort;
  /** Last observed CLI default model, cached so the picker can name it. */
  defaultModel?: string;
  /** Cached account model list, so the picker does not probe on every render. */
  availableModels?: Array<{ value: string; label: string }>;
  lastConnectionStatus?: ClaudeCodeConnectionState;
  lastCheckedAt?: string;
  permissions: ClaudeCodePermissions;
}

export interface ClaudeCodeStatus {
  state: ClaudeCodeConnectionState;
  installed: boolean;
  authenticated: boolean;
  executablePath?: string;
  version?: string;
  authMethod?: string;
  subscriptionType?: string;
  /** Model Claude Code picks when none is requested, as reported by the CLI. */
  defaultModel?: string;
  /** Models this account can use, named with the versions the CLI reports. */
  availableModels?: Array<{ value: string; label: string }>;
  /** Signed-in Claude account, read live from the CLI and never persisted. */
  email?: string;
  /** Organisation the account belongs to, when Claude reports one. */
  orgName?: string;
  checkedAt: string;
  message: string;
}

export interface ClaudeCodeConnectionTest {
  ok: boolean;
  status: ClaudeCodeStatus;
  message: string;
}

/** Pending `claude auth login` waiting for the code from the callback page. */
export interface ClaudeCodeLoginStart {
  url: string;
  /** Directory the resulting credentials land in, for display only. */
  scope: "app" | "machine";
}

/**
 * Reasoning effort, shared by both Claude paths: forwarded as
 * output_config.effort on the Messages API, and as the Agent SDK's `effort`
 * option for the subscription path.
 */
export type AnthropicEffort = "low" | "medium" | "high" | "xhigh" | "max";

/** Direct Claude access with the athlete's own Anthropic API key. */
export interface AnthropicApiConfig {
  /** Messages API model id, e.g. claude-opus-5. */
  model: string;
  effort: AnthropicEffort;
  /** True when an encrypted key is stored; key material is never returned. */
  hasApiKey: boolean;
  /** Only read when saving or testing settings; never returned by get. */
  apiKey?: string;
  /** Set true when saving to remove any stored key. */
  clearApiKey?: boolean;
}

export interface AnthropicApiConnectionTest {
  ok: boolean;
  message: string;
  /** Model id the key was verified against. */
  model?: string;
}

export interface LocalChatConfig {
  /** OpenAI-compatible API base URL, normalized to end in /v1. */
  baseUrl: string;
  /** Model id as listed by the local server, e.g. llama3.2 or qwen3:8b. */
  model: string;
  /** True when an encrypted API key is stored; token material is never returned. */
  hasApiKey: boolean;
  /** Optional token used only when saving/testing settings; never returned by get. */
  apiKey?: string;
  /** Set true when saving to remove any stored local API key. */
  clearApiKey?: boolean;
  /** Attach COROS MCP tools when the local endpoint accepts OpenAI-style tools. */
  toolsEnabled: boolean;
}

export interface ChatGptConfig {
  /** Optional model id. Empty uses the best model available to the account. */
  model?: string;
}

export interface OpenRouterConfig {
  /** OpenRouter model slug, such as openrouter/auto or anthropic/claude-sonnet-4. */
  model: string;
  /** True when an encrypted API key is stored; token material is never returned. */
  hasApiKey: boolean;
  /** Optional token used only when saving/testing settings; never returned by get. */
  apiKey?: string;
  /** Set true when saving to remove the stored OpenRouter API key. */
  clearApiKey?: boolean;
}

export interface OpenRouterModelOption {
  id: string;
  name: string;
}

export interface OpenRouterConnectionTest {
  ok: boolean;
  message: string;
  models: OpenRouterModelOption[];
  /** Masked label returned by OpenRouter; never contains the full key. */
  keyLabel?: string;
}

/** Hard cap on custom coach instructions so a pasted document cannot crowd out the coach prompt. */
/**
 * The answer a run gives when it looked and found nothing worth saying. A
 * control token, not prose: it decides `silent` vs `success`, and the athlete
 * must never read it. Lives here rather than beside the runner because the
 * renderer needs it too — a run streaming live has to hold it back.
 */
export const NOTHING_TO_REPORT = "NOTHING_TO_REPORT";

export const MAX_CUSTOM_COACH_INSTRUCTIONS = 4000;

/**
 * The rolling-summary window, shared by the interactive chat and by analysis
 * runs. One pair of numbers rather than two: the summary lives on the
 * conversation, so a chat and a coach talking in the same thread that disagreed
 * about where the tail starts would roll each other's work forward.
 *
 * Bounds and defaults live in `chatContextCompaction.ts`.
 */
export interface CompactContextSettings {
  /**
   * Whether long transcripts are compacted before they are sent. Off means a
   * conversation is always sent in full — the record is identical either way,
   * this only ever trims the context window.
   */
  enabled: boolean;
  /** How far past the summary a transcript may run before it is rolled. */
  limit: number;
  /** How many recent entries survive a roll and go to the model verbatim. */
  keep: number;
}

export interface ChatSettings {
  provider: ChatProvider;
  chatgpt: ChatGptConfig;
  anthropic: AnthropicApiConfig;
  claudeCode: ClaudeCodeConfig;
  openRouter: OpenRouterConfig;
  local: LocalChatConfig;
  sidebarOpen?: boolean;
  /** When true, show activity/fitness/HR chart cards in the transcript. Default false. */
  visualizationsEnabled?: boolean;
  /** Free-form athlete preferences appended to the coach system prompt. */
  customInstructions?: string;
  /** The rolling-summary window for chat and analyses alike. */
  compactContext: CompactContextSettings;
}

/**
 * What a compaction pass decided, as the renderer sees it.
 *
 * `tailStart` indexes the entry array the renderer handed over, so it can build
 * the wire transcript from the same array it already holds rather than trusting
 * the main process to have the athlete's in-flight turn.
 */
export interface ChatContextCompaction {
  /** Prepended to the tail as a labelled user turn, when there is one. */
  summary?: string;
  /** Where the verbatim tail begins in the entries that were sent. */
  tailStart: number;
  /** Entries the stored summary now accounts for. */
  through: number;
  /** Whether this call ran a summariser turn. */
  rolled: boolean;
  /** A roll ran and produced nothing; the untrimmed tail is what to send. */
  failed: boolean;
  /**
   * Why it produced nothing, when the roll knew. Shown for the athlete's own
   * "Compact context" and ignored by the automatic pass, which tries again on
   * the next turn.
   */
  failureReason?: string;
  /** How many entries the tail holds, for the "compacted N turns" notice. */
  tailLength: number;
  /** Total entries considered, so a caller can say what was compressed. */
  entryCount: number;
}

/**
 * What compaction has actually done to a conversation, for the dev-build
 * inspector.
 *
 * Read-only by construction: it plans but never rolls, so opening it costs no
 * model call. A debug view that spends tokens to show you what you are spending
 * is a trap, and one that silently advances the stored summary would change the
 * thing it claims to be reporting.
 *
 * `pending` is therefore what makes this honest rather than merely informative:
 * when a roll is due, these are the turns the *next* message folds into the
 * summary, and until then they are still going over in full.
 */
export interface ChatContextInspection {
  /** The stored rolling summary, if there is one. */
  summary?: string;
  /** Entries at the head the stored summary accounts for. */
  through: number;
  /** The window in force, after normalisation. */
  window: { limit: number; keep: number };
  /** Whether the automatic per-turn pass is switched on. */
  enabled: boolean;
  /** Entries in the transcript inspected. */
  entryCount: number;
  /** Where the verbatim tail begins in that transcript. */
  tailStart: number;
  /** Turns the next message would fold into the summary before sending. */
  pending: ChatMessage[];
  /** Turns sent verbatim. */
  tail: ChatMessage[];
  /**
   * Characters across the summary turn, `pending` and `tail` — what this turn
   * costs if the roll has not happened yet, which is the number worth seeing.
   */
  characterCount: number;
}

export interface ChatSessionSummary {
  id: string;
  provider: ChatProvider;
  title: string;
  preview: string;
  updatedAt: string;
  createdAt: string;
  messageCount: number;
  /** ISO timestamp the conversation was pinned, or null when unpinned. */
  pinnedAt: string | null;
}

/**
 * What a turn is allowed to do. Analysis runs are `read-only` (decision 3):
 * they may read, analyse and draft, but never write to COROS.
 */
/**
 * What one turn cost, summed across its tool rounds — a tool-using answer is
 * several provider calls and the athlete pays for all of them.
 *
 * Both counts are whole tokens as the provider reported them. A provider that
 * reports nothing leaves this undefined rather than zero: "this run cost
 * nothing" and "nobody told us what this run cost" are different facts, and a
 * budget that treats the second as the first undercounts silently.
 */
export interface ChatTokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * What a turn may reach for. `read-only` is decision 3's analysis set; `none`
 * is for a turn that works on text it was handed and has no business calling
 * anything — the rolling summariser of 5.7, where a tool round-trip would be
 * both slower and a chance to wander off the one job it has.
 */
export type ChatToolPolicy = "interactive" | "read-only" | "none";

/**
 * A trigger is what turns an analysis into an *auto* analysis.
 *
 * It lives on the analysis, and so does everything else — because an analysis
 * lives in exactly one conversation. Two earlier shapes put it elsewhere: on a
 * reusable definition that declared a cadence before it had anywhere to speak,
 * and then on an *attachment* joining one definition to several conversations.
 * Both are gone. An athlete writing "tell me when my ramp is steep" is writing
 * it about one conversation's history, and the indirection bought reuse nobody
 * asked for at the price of two objects, two screens and two ways for them to
 * disagree.
 */
export type AnalysisTriggerKind =
  | "schedule"
  | "activity"
  | "threshold"
  | "manual";

export type AnalysisTrigger =
  | {
      kind: "schedule";
      cadence: "daily" | "weekly";
      /** 0=Sunday..6=Saturday; weekly only. */
      dayOfWeek?: number;
      /** Local wall-clock "HH:mm". */
      timeOfDay: string;
    }
  | {
      kind: "activity";
      /** COROS sport type ids; empty means every sport. */
      sportTypes: number[];
      minDurationSec?: number;
      minDistanceM?: number;
      /**
       * Analyse every matching activity that appeared since the last analysis,
       * one run each in chronological order. Off (the default) analyses only
       * the most recent match.
       */
      multiActivity?: boolean;
    }
  | {
      kind: "threshold";
      metric:
        | "acuteChronicRamp"
        | "restingHrDrift"
        | "planAdherence"
        | "sleepDebt";
      value: number;
    }
  | { kind: "manual" };

export type AnalysisThresholdMetric = Extract<
  AnalysisTrigger,
  { kind: "threshold" }
>["metric"];

/** The guard rails around an automatic trigger. */
export interface AnalysisConditions {
  /** Minimum gap between two runs of the same analysis. */
  cooldownMin: number;
  /** Per analysis, per local day. */
  maxRunsPerDay: number;
  /** Local "HH:mm" range where runs are deferred, not dropped. */
  quietHours?: { start: string; end: string };
}

/**
 * Lives here, not beside the store, because the trigger editor is a renderer
 * screen: creating an analysis is where a person picks a cadence, and the form
 * has to show what it will get if they touch nothing. A renderer must not
 * import a main-process module to learn that.
 */
export const DEFAULT_ANALYSIS_CONDITIONS: AnalysisConditions = {
  cooldownMin: 120,
  maxRunsPerDay: 3
};

/**
 * Section 7, decided. An analysis with no effort of its own runs at `low`,
 * whatever its trigger and whatever the interactive chat is set to.
 *
 * Two reasons this is a flat default rather than a trigger-kind carve-out:
 *
 * 1. **The editor already promises it.** `EffortSwitch` renders
 *    `runtime.effort ?? "low"`, so an analysis saved without touching that
 *    control showed `low` and then ran at the chat's effort.
 * 2. **Effort is cost, not capability.** Provider and model still inherit from
 *    chat settings — those are the coach the athlete chose. How hard it thinks
 *    on a run nobody is watching is a different question, and a preset that
 *    wants more says so out loud.
 *
 * Lives here rather than beside the runner because the renderer shows the
 * resolved value, and must not import a main-process module to learn it.
 */
export const ANALYSIS_DEFAULT_EFFORT: AnthropicEffort = "low";

export interface AnalysisRuntime {
  /** Defaults to the interactive chat provider when unset. */
  provider?: ChatProvider;
  model?: string;
  effort?: AnthropicEffort;
}

/**
 * One analysis, in one conversation.
 *
 * `trigger === null` is a manual analysis: it sits in the conversation and
 * runs when the athlete presses Run now. Anything else makes it automatic, and
 * "auto analysis" means exactly that and nothing more.
 */
export interface CoachAnalysis {
  id: string;
  /**
   * The conversation it belongs to, and the only one. An analysis is created
   * inside a conversation and cannot be moved; deleting the conversation
   * deletes it.
   */
  sessionId: string;
  name: string;
  /** Persona and remit, injected into the run's system instructions. */
  role?: string;
  playbook: string;
  enabled: boolean;
  presetId?: string;
  runtime: AnalysisRuntime;
  /** null = manual only. Present = an auto analysis. */
  trigger: AnalysisTrigger | null;
  /** Meaningless without a trigger; kept at its defaults until one is set. */
  conditions: AnalysisConditions;
  /**
   * The trigger stays on this machine: not published to the sync vault, not
   * written into a backup. The analysis itself still travels, so the other
   * machine shows it in this conversation — as a manual one, because the
   * schedule that fires it belongs to this desk.
   *
   * Stored apart rather than filtered on the way out. `syncPolicy` classifies
   * whole tables, the oplog carries whole rows (`SELECT *`), and a merge is an
   * `INSERT OR REPLACE` — so a column dropped from a payload comes back as
   * NULL on the other side rather than as "unchanged". A device-only trigger
   * therefore lives in `coach_analysis_local_triggers`, which is `device` tier
   * and has no way out of this machine at all.
   */
  deviceOnly: boolean;
  /** Run order within the conversation: they execute in turn (2.3). */
  sortOrder: number;
  lastRunAt?: string;
  nextRunAt?: string;
  /**
   * `start_time` (epoch seconds) of the newest activity this analysis has
   * already looked at. Absent means it never has, and the creation time
   * (`createdAt`) becomes the floor instead.
   */
  lastActivityAt?: number;
  /**
   * Section 10's backoff. A `failed` run deliberately leaves `lastRunAt` and
   * the watermark where they were, so without this a dead provider is
   * re-offered the same activity on every 15-minute poll for as long as it
   * stays dead.
   *
   * `backoffUntil` is the wall clock it is held off until; absent means it is
   * not. `backoffLevel` counts consecutive failures and picks the step (5m,
   * 15m, 60m); 0 or absent means healthy.
   */
  backoffUntil?: string;
  backoffLevel?: number;
  /**
   * 3.3's transition state: whether this analysis's threshold condition held
   * the last time the scheduler looked. **Absent means never evaluated**,
   * which is the state that matters most — an analysis written today must not
   * fire on a condition that has been true all week, so its first look records
   * the answer and says nothing.
   */
  thresholdFiring?: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Create payload; the store assigns id, order, clocks and timestamps. */
export interface CoachAnalysisInput {
  sessionId: string;
  name: string;
  role?: string;
  playbook: string;
  enabled?: boolean;
  presetId?: string;
  runtime?: AnalysisRuntime;
  /** Omitted or null creates a manual analysis. */
  trigger?: AnalysisTrigger | null;
  /** Merged over the defaults; `quietHours: null` is how a window is cleared. */
  conditions?: Partial<Omit<AnalysisConditions, "quietHours">> & {
    quietHours?: AnalysisConditions["quietHours"] | null;
  };
  deviceOnly?: boolean;
}

/**
 * Edit payload. Every field is optional and an omitted one is unchanged;
 * `trigger: null` is how an auto analysis is turned back into a manual one.
 * `sessionId` is absent on purpose — an analysis cannot change conversation.
 */
export type CoachAnalysisPatch = Partial<Omit<CoachAnalysisInput, "sessionId">>;

/** Why a create was refused, so the UI can explain rather than just fail. */
export type CoachAnalysisErrorCode =
  | "ANALYSIS_SESSION_REQUIRED"
  | "ANALYSIS_LIMIT_REACHED"
  | "ANALYSIS_NOT_FOUND";

/**
 * Refusals are expected — the per-conversation cap, mostly — and the UI has to
 * explain each one. An Error crossing IPC loses its `code`, so create answers
 * with a result instead of throwing.
 */
export type CoachAnalysisCreateResult =
  | { ok: true; analysis: CoachAnalysis }
  | { ok: false; code: CoachAnalysisErrorCode; message: string };

export type CoachAnalysisRunStatus =
  | "running"
  | "success"
  | "silent"
  | "skipped"
  | "failed"
  | "cancelled";

export interface CoachAnalysisRun {
  id: string;
  analysisId: string;
  status: CoachAnalysisRunStatus;
  triggerKind: AnalysisTriggerKind;
  triggerPayload?: Record<string, unknown>;
  /** Conversation actually written into. */
  sessionId?: string;
  /** The opening line, kept for the run-log row. */
  summary?: string;
  model?: string;
  effort?: string;
  /** What this run cost, when the provider said (13). */
  inputTokens?: number;
  outputTokens?: number;
  error?: string;
  /**
   * disabled | missing-session | cooldown | quiet-hours | no-auth | offline |
   * budget | stale-slot | no-activity | two-factor-required | backoff | burst
   */
  skipReason?: string;
  /** Set once the unread badge is cleared. */
  seenAt?: string;
  startedAt: string;
  finishedAt?: string;
}

/** Run-log query, mirrored by the renderer so it never imports the db layer. */
export interface CoachAnalysisRunQuery {
  analysisId?: string;
  sessionId?: string;
  /** Inclusive lower bound on `startedAt`, ISO. */
  since?: string;
  statuses?: CoachAnalysisRunStatus[];
  /** Only runs the athlete has not looked at yet (`seen_at IS NULL`). */
  unseenOnly?: boolean;
  limit?: number;
}

/**
 * An analysis that changed, on the wire.
 *
 * Every surface that renders one — the row in the conversation header, the
 * detail screen — has to follow an edit made somewhere else, and none of them
 * asked. `analysis` is null when it was deleted, which is the one change a
 * surface cannot re-read for itself.
 */
export interface CoachAnalysisUpdate {
  analysisId: string;
  sessionId: string;
  analysis: CoachAnalysis | null;
}

/**
 * What the conversation list has to say about one conversation (9.3). An auto
 * run changes the transcript and so bumps the row to the top; without this the
 * row reorders for no visible reason.
 */
export interface CoachAnalysisSessionAttention {
  sessionId: string;
  /** A live analysis writes here, whether or not it ever has. */
  attached: boolean;
  /** Runs that landed in it and have not been looked at yet. */
  unread: number;
}

/**
 * Section 10: why every analysis is held, and since when.
 *
 * One flag for the whole feature rather than a column per analysis, because
 * the cause is one thing the athlete has to fix once — COROS is asking for a
 * login code, and no amount of retrying anywhere will answer it. Persisted, so
 * a restart does not quietly resume a paused world.
 */
export interface CoachAnalysisPause {
  /**
   * `two-factor-required` — COROS wants a login code and no analysis can
   * supply one. `budget` — this month's token spend reached the athlete's
   * ceiling. Both are one fact about the whole feature that the athlete fixes
   * once, which is why they share one flag.
   */
  reason: "two-factor-required" | "budget";
  since: string;
  /** The run that tripped it, so the banner can point at something real. */
  runId?: string;
}

/**
 * Guard rail 3's answer for one provider. The reason is prose, not a code: it
 * lands on the skipped run and in the banner, and both are read by a person.
 */
export interface ProviderAuthVerdict {
  ok: boolean;
  reason?: string;
}

/** 13: what the athlete has spent this month, and their ceiling. */
export interface CoachAnalysisSpend {
  monthStart: string;
  inputTokens: number;
  outputTokens: number;
  /** Null when no ceiling is set, which is the default. */
  budget: number | null;
  /**
   * Runs that reported a cost, out of those that reached a provider. When
   * these differ the total is short of the truth, and a budget that did not
   * say so would read as comfortably under when nobody knows.
   */
  countedRuns: number;
  providerRuns: number;
}

/** One analysis plus what it last did, for the conversation's list. */
export interface CoachAnalysisSummary {
  analysis: CoachAnalysis;
  lastRun?: CoachAnalysisRun;
}

export interface LocalChatConnectionTest {
  ok: boolean;
  message: string;
  normalizedBaseUrl?: string;
  models?: string[];
}

export type LocalChatServerKind = "ollama" | "lmstudio";

export interface LocalChatServerCandidate {
  kind: LocalChatServerKind;
  label: string;
  baseUrl: string;
  ok: boolean;
  models: string[];
  message?: string;
}

export interface LocalChatDiscovery {
  servers: LocalChatServerCandidate[];
}

/** Sign-in state surfaced to the renderer; never includes token material. */
export interface ChatAuthStatus {
  signedIn: boolean;
  /** From the id_token, for display in the header when signed in. */
  email?: string;
  /** Access-token expiry (unix seconds), for debugging/telemetry only. */
  expiresAt?: number;
}

/**
 * OAuth token blob persisted encrypted via safeStorage. Mirrors the Codex
 * "Sign in with ChatGPT" token set. Kept in the main process only.
 */
export interface StoredChatToken {
  access_token: string;
  refresh_token: string;
  id_token?: string;
  /** ChatGPT account id from the id_token's OpenAI auth claim. */
  account_id?: string;
  email?: string;
  /** Unix seconds: now + expires_in at the time of issue/refresh. */
  expires_at: number;
  token_type: string;
}

// ----- COROS MCP (Model Context Protocol) connection -----

export interface CorosMcpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface CorosMcpStatus {
  /** A live MCP client session is open. */
  connected: boolean;
  /** OAuth tokens are stored (can reconnect without a browser). */
  authorized: boolean;
  /** Tools discovered from the server. */
  tools: CorosMcpTool[];
}

// ----- Configurable MCP server registry -----

export type McpTransport = "streamable-http";
export type McpAuthType = "oauth" | "bearer" | "none";

export interface McpServerConfig {
  id: string;
  name: string;
  url: string;
  transport: McpTransport;
  authType: McpAuthType;
  scope?: string;
  enabled: boolean;
  /** Built-in (COROS): non-deletable, url/id immutable, can be disabled. */
  builtin: boolean;
  sortOrder: number;
}

export interface McpServerInput {
  id?: string;
  name: string;
  url: string;
  transport?: McpTransport;
  authType?: McpAuthType;
  scope?: string | null;
  enabled?: boolean;
}

export interface McpServerStatus {
  id: string;
  name: string;
  enabled: boolean;
  connected: boolean;
  /** Auth is satisfied (OAuth tokens stored, or bearer set, or authType none). */
  authenticated: boolean;
  toolCount: number;
  error?: string;
}

// Streaming chat is push-based: `chat:send` kicks off the request and the
// assistant text arrives via these main->renderer events, correlated by
// requestId. Renderers must not await `chat:send` for content.
export interface ChatStreamStart {
  requestId: string;
}

export interface ChatStreamToken {
  requestId: string;
  delta: string;
}

export interface ChatStreamDone {
  requestId: string;
  fullText: string;
  finishReason?: string;
}

export interface ChatStreamError {
  requestId: string;
  message: string;
  /** True when the failure is an expired/invalid session (drop to login gate). */
  authError?: boolean;
}

/**
 * Diagnostic signal about where the answer's data is coming from: the static
 * training snapshot injected into `instructions`, and/or live COROS MCP tool
 * calls the model makes mid-stream.
 */
export type ChatStreamInfo =
  | {
      requestId: string;
      kind: "context";
      /** True when real COROS activity/metrics were injected as a snapshot. */
      snapshotIncluded: boolean;
      /** True when the COROS MCP tool was attached to the request. */
      mcpEnabled: boolean;
    }
  | {
      requestId: string;
      kind: "mcp";
      /** The MCP tool name, when known. */
      tool?: string;
      /** Raw event type, e.g. "response.mcp_call.completed". */
      status: string;
      message?: string;
    }
  | {
      requestId: string;
      kind: "thinking";
      /** Incremental display-safe reasoning/thinking summary from the provider. */
      delta: string;
    }
  | {
      requestId: string;
      kind: "planDraft";
      draft: PlanDraftPreview;
    }
  | {
      requestId: string;
      kind: "workoutDelete";
      preview: WorkoutDeletePreview;
    }
  | {
      requestId: string;
      kind: "activityVisual";
      preview: ActivityVisualPreview;
    }
  | {
      requestId: string;
      kind: "fitnessTrend";
      preview: FitnessTrendPreview;
    }
  | {
      requestId: string;
      kind: "hrZoneSummary";
      preview: HrZonePreview;
    }
  | {
      requestId: string;
      kind: "coachPrompt";
      prompt: CoachInputPrompt;
    };

// ----- Training plan upload (AI coach) -----

export type TrainingLibrarySyncState =
  | "local"
  | "synced"
  | "pending"
  | "conflicted"
  | "failed"
  | "stale";

export type TrainingPlanSource =
  | "coros"
  | "local"
  | "template"
  | "coach";

export type TrainingPlanDifficulty =
  | "beginner"
  | "intermediate"
  | "advanced"
  | "custom";

export type TrainingPlanDestination =
  | "workoutLibrary"
  | "calendar"
  | "localPlan"
  | "nativePlan"
  | "localTemplate"
  | "nativePlanAndCalendar";

export type TrainingPlanEntryKind = "workout" | "rest" | "note";

export interface TrainingPlanPhase {
  id: string;
  name: string;
  startWeek: number;
  endWeek: number;
  kind?: "base" | "build" | "peak" | "taper" | "recovery" | "custom";
}

export interface TrainingPlanEntry {
  id: string;
  kind: TrainingPlanEntryKind;
  weekIndex: number;
  /** Zero-based day within the plan week; undefined places the entry in the holding area. */
  dayIndex?: number;
  sortOrder: number;
  title?: string;
  workout?: PlanWorkoutEntryInput;
  programId?: string;
  remotePlanProgramId?: string;
  plannedDurationSeconds?: number;
  plannedDistanceMeters?: number;
  plannedTrainingLoad?: number;
  plannedStrengthSets?: number;
  notes?: string;
}

export interface TrainingPlanGenerationRequest {
  goal: string;
  sports: WorkoutSport[];
  difficulty: TrainingPlanDifficulty;
  weeks: number;
  sessionsPerWeek: number;
  /** ISO date for Day 1 of Week 1. */
  startDate: string;
  /** Monday = 0 through Sunday = 6. */
  availableDayIndexes: number[];
  maxSessionMinutes?: number;
  constraints?: string;
}

export interface TrainingPlanCalendarOccurrence {
  planEntryId: string;
  happenDay: string;
  schedulePlanId: string;
  scheduleIdInPlan: string;
  planProgramId: string;
  pbVersion?: number;
  createdAt: string;
  removedAt?: string;
}

export interface TrainingPlanCalendarFailure {
  planEntryId: string;
  happenDay: string;
  message: string;
  /** True when COROS may have accepted the write but its identity could not be verified. */
  writeMayHaveSucceeded?: boolean;
}

export interface TrainingPlanCalendarInstall {
  id: string;
  startDate: string;
  planRevision: string;
  state: "active" | "partial" | "removed";
  lastOperation?: "install" | "remove";
  occurrences: TrainingPlanCalendarOccurrence[];
  failures: TrainingPlanCalendarFailure[];
  createdAt: string;
  updatedAt: string;
}

export interface TrainingPlanDocument {
  id: string;
  remoteId?: string;
  name: string;
  description: string;
  goal: string;
  difficulty: TrainingPlanDifficulty;
  notes: string;
  source: TrainingPlanSource;
  sportMix: WorkoutSport[];
  weekCount: number;
  startDate?: string;
  phases: TrainingPlanPhase[];
  entries: TrainingPlanEntry[];
  calendarInstalls?: TrainingPlanCalendarInstall[];
  tags: string[];
  collectionId?: string;
  favorite: boolean;
  archived: boolean;
  syncState: TrainingLibrarySyncState;
  remoteVersion?: number;
  remoteUpdatedAt?: number;
  lastSyncedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TrainingPlanCalendarPreviewEntry {
  planEntryId: string;
  name: string;
  happenDay: string;
  sport?: WorkoutSport;
  schedulePlanId?: string;
  scheduleIdInPlan?: string;
  planProgramId?: string;
  pbVersion?: number;
}

export interface TrainingPlanCalendarConflict {
  happenDay: string;
  existing: Array<{
    name: string;
    schedulePlanId: string;
    scheduleIdInPlan: string;
  }>;
}

export interface TrainingPlanCalendarPreview {
  previewId: string;
  operation: "install" | "remove";
  planId: string;
  planName: string;
  planRevision: string;
  startDate: string;
  entries: TrainingPlanCalendarPreviewEntry[];
  conflicts: TrainingPlanCalendarConflict[];
  blockers: string[];
  expiresAt: string;
}

export interface TrainingPlanCalendarMutationResult {
  plan: TrainingPlanDocument;
  scheduledCount: number;
  removedCount: number;
  failures: TrainingPlanCalendarFailure[];
}

export interface TrainingCollection {
  id: string;
  name: string;
  description?: string;
  color?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TrainingWorkoutMetadata {
  programId: string;
  favorite: boolean;
  tags: string[];
  collectionId?: string;
  source: "coros" | "local" | "activity" | "coach";
  syncState: TrainingLibrarySyncState;
  lastUsedAt?: string;
  lastSyncedAt?: string;
  cachedVersion?: string;
}

export interface TrainingLibraryWorkout extends TrainingHubLibraryWorkout {
  favorite: boolean;
  tags: string[];
  collectionId?: string;
  source: TrainingWorkoutMetadata["source"];
  syncState: TrainingLibrarySyncState;
  lastUsedAt?: string;
  lastSyncedAt?: string;
  usedByPlanIds: string[];
  scheduledCount: number;
}

export interface NativeCorosPlanSummary {
  remoteId: string;
  name: string;
  overview: string;
  totalDay: number;
  minWeeks?: number;
  maxWeeks?: number;
  startDay?: string;
  endDay?: string;
  executeStatus?: number;
  inSchedule?: boolean;
  workoutCount: number;
  sportTypes: number[];
  trainingLoad?: number;
  durationSeconds?: number;
  distanceMeters?: number;
  version?: number;
  updateTimestamp?: number;
  syncState: TrainingLibrarySyncState;
  lastSyncedAt?: string;
}

export interface NativeCorosPlanEntity {
  /** Stable occurrence ID supplied by COROS. Distinct from the reusable idInPlan. */
  id?: string;
  idInPlan: string;
  planProgramId?: string;
  happenDay?: string;
  dayNo?: number;
  sortNo?: number;
  sortNoInPlan?: number;
  sortNoInSchedule?: number;
  status?: number;
}

export interface NativeCorosPlanProgram {
  id?: string;
  idInPlan?: string;
  planProgramId?: string;
  name: string;
  overview?: string;
  sportType?: number;
  planDistance?: number;
  planDuration?: number;
  planTrainingLoad?: number;
  planSets?: number;
  exercises?: TrainingHubScheduledExercise[];
}

export interface NativeCorosPlanDetail extends NativeCorosPlanSummary {
  entities: NativeCorosPlanEntity[];
  programs: NativeCorosPlanProgram[];
  weekStages: Array<{
    weekNo: number;
    stage?: number | string;
    planDistance?: number;
    planDuration?: number;
    planTrainingLoad?: number;
  }>;
  /** Lossless payload retained only at the remote adapter boundary. */
  rawPayload: Record<string, unknown>;
}

export interface TrainingPlanWriteCapabilities {
  create: boolean;
  update: boolean;
  duplicate: boolean;
  delete: boolean;
  activate: boolean;
  removeActive: boolean;
  reason?: string;
  verifiedAt?: string;
}

export interface TrainingActivityMatch {
  id: string;
  planId?: string;
  planEntryId?: string;
  schedulePlanId: string;
  scheduleIdInPlan: string;
  activityId?: string;
  happenDay: string;
  status:
    | "completed"
    | "partial"
    | "missed"
    | "skipped"
    | "rescheduled"
    | "upcoming";
  confidence?: number;
  manual: boolean;
  plannedDurationSeconds?: number;
  completedDurationSeconds?: number;
  plannedDistanceMeters?: number;
  completedDistanceMeters?: number;
  plannedTrainingLoad?: number;
  completedTrainingLoad?: number;
  updatedAt: string;
}

export interface TrainingLibrarySnapshot {
  workouts: TrainingLibraryWorkout[];
  plans: TrainingPlanDocument[];
  nativePlans: NativeCorosPlanSummary[];
  collections: TrainingCollection[];
  matches: TrainingActivityMatch[];
  cachedAt: string;
  stale: boolean;
  offline: boolean;
  partialFailures: string[];
  nativePlanWrites: TrainingPlanWriteCapabilities;
}

export interface WorkoutMetadataPatch {
  favorite?: boolean;
  tags?: string[];
  collectionId?: string | null;
  source?: TrainingWorkoutMetadata["source"];
  lastUsedAt?: string;
}

export interface TrainingPlanMetadataPatch {
  favorite?: boolean;
  tags?: string[];
  collectionId?: string | null;
  archived?: boolean;
}

export interface TrainingLibraryDeleteRequest {
  programIds: string[];
  confirmed: boolean;
}

export interface TrainingTrendPoint {
  date: string;
  label: string;
  trainingLoad?: number;
  rpeLoad?: number;
  avgSleepHrv?: number;
  sleepHrvBase?: number;
  rhr?: number;
  sleepMinutes?: number;
  sleepScore?: number;
}

export interface ActivityVisualLapPoint {
  index: number;
  avgHr?: number;
  maxHr?: number;
  distance?: number;
  duration?: number;
  pace?: number;
  /** Steps per minute for foot sports, rpm for cycling. */
  avgCadence?: number;
}

/**
 * A channel the card can draw either way. `series` is the per-sample recording
 * and `laps` the per-lap averages, which is all COROS returns for plenty of
 * activities — a channel with only lap averages still draws as a bar per lap
 * rather than dropping off the card.
 */
export interface ActivityVisualChannelSection {
  chartKind: "series" | "laps";
  series?: TrainingHubActivitySeriesPoint[];
  laps?: ActivityVisualLapPoint[];
}

export type ActivityVisualHrSection = ActivityVisualChannelSection;

export interface ActivityVisualPreview {
  previewId: string;
  activityId: string;
  sportType?: number;
  name?: string;
  startTime?: string;
  avgHr?: number;
  maxHr?: number;
  sections: {
    hr?: ActivityVisualHrSection;
    pace?: { series: TrainingHubActivitySeriesPoint[] };
    power?: { series: TrainingHubActivitySeriesPoint[] };
    cadence?: ActivityVisualChannelSection;
    elevation?: { points: TrainingHubTrackPoint[] };
    laps?: ActivityVisualLapPoint[];
  };
}

/** @deprecated Legacy persisted shape — migrated to ActivityVisualPreview */
export interface ActivityHrTrendLapPoint {
  index: number;
  avgHr?: number;
  maxHr?: number;
  distance?: number;
}

/** @deprecated Legacy persisted shape — migrated to ActivityVisualPreview */
export interface ActivityHrTrendPreview {
  previewId: string;
  activityId: string;
  name?: string;
  startTime?: string;
  avgHr?: number;
  maxHr?: number;
  chartKind: "series" | "laps";
  series?: TrainingHubActivitySeriesPoint[];
  laps?: ActivityHrTrendLapPoint[];
}

export interface FitnessTrendPreview {
  previewId: string;
  trendPoints: TrainingTrendPoint[];
}

export interface HrZoneEntry {
  index: number;
  label: string;
  percent: number;
  value: number;
}

export interface HrZonePreview {
  previewId: string;
  metric: "time" | "distance" | "trainingLoad";
  zones: HrZoneEntry[];
  lthrZones: TrainingHubThresholdZone[];
}

export interface PlanDraftPreviewEntry {
  key: string;
  name: string;
  sport?: WorkoutSport;
  scheduleDate?: string;
  volume?: string;
  saveToLibrary: boolean;
  workoutType: string;
  stepsSummary?: string;
  /** Canonical workout input used to reformat previews when units change. */
  source?: PlanWorkoutEntryInput;
}

export interface PlanDraftPreview {
  draftId: string;
  /** Distinguishes a multi-workout plan from a reusable one-off workout. */
  artifactType?: "plan" | "workout";
  name: string;
  summary: string;
  entries: PlanDraftPreviewEntry[];
  conflicts: string[];
  warnings: string[];
  uploadedAt?: number;
  /**
   * Set when the athlete removed this creation from the conversation. The
   * entry stays in the transcript and the draft is rewritten in place, because
   * a save that shortens the array is exactly what `foreignTail` refuses — a
   * shorter array reads as "the row grew behind my back" and the guard puts the
   * tail back. Nothing that was already saved to COROS or the library is
   * touched; only the card goes.
   */
  removedAt?: number;
  uploadResult?: {
    workoutsScheduled: number;
    workoutsCreated: number;
    destination?: TrainingPlanDestination;
    localPlanId?: string;
    groupedPlanCreated?: boolean;
  };
}

export interface PlanWorkoutEntryInput {
  key: string;
  name: string;
  description?: string;
  /** Structured-workout sport. Omitted legacy drafts are treated as Run. */
  sport?: WorkoutSport;
  sport_options?: WorkoutSportOptions;
  steps?: RunWorkoutStepInput[];
  distance_km?: number;
  schedule_date?: string;
  sort_no?: number;
  save_to_library?: boolean;
}

export type WorkoutSport =
  | "run"
  | "trailRun"
  | "bike"
  | "swim"
  | "strength"
  | "xcSki"
  | "indoorClimb"
  | "bouldering"
  | "hyrox";

export type WorkoutHeartRateBasis = "maxHr" | "reserve" | "lthr";
export type WorkoutHeartRatePreset =
  | "recovery"
  | "warmUp"
  | "fatBurn"
  | "aerobicEndurance"
  | "aerobicPower"
  | "threshold"
  | "anaerobicEndurance"
  | "anaerobicPower"
  | "anaerobic";
export type WorkoutPacePreset =
  | "recovery"
  | "aerobicEndurance"
  | "aerobicPower"
  | "threshold"
  | "anaerobicEndurance"
  | "anaerobicPower";
export type WorkoutFtpPreset =
  | "recovery"
  | "aerobicEndurance"
  | "aerobicPower"
  | "threshold"
  | "anaerobicEndurance"
  | "anaerobicPower"
  | "sprint";
export type WorkoutRunningPowerPreset =
  | "easy"
  | "moderate"
  | "threshold"
  | "interval"
  | "repetition";
export type WorkoutSwimStroke =
  | "freestyle"
  | "breaststroke"
  | "backstroke"
  | "butterfly"
  | "mix"
  | "individualMedley"
  | "drills"
  | "notSet";
export type WorkoutClimbSystem =
  | "yds"
  | "french"
  | "uiaa"
  | "ewbank"
  | "vScale"
  | "font";

type WorkoutPercentPresetOrRange<TPreset extends string> =
  | { preset: TPreset; lowPercent?: never; highPercent?: never }
  | { preset?: never; lowPercent: number; highPercent: number };

export type WorkoutIntensityInput =
  | { type: "none" }
  | { type: "heartRate"; lowBpm: number; highBpm: number }
  | ({ type: "heartRatePercent"; basis: WorkoutHeartRateBasis; zoneId?: number } &
      WorkoutPercentPresetOrRange<WorkoutHeartRatePreset>)
  | {
      type: "pace";
      lowSecondsPerKm: number;
      highSecondsPerKm: number;
      displayUnit: "km" | "mi";
    }
  | {
      type: "effortPace";
      lowSecondsPerKm: number;
      highSecondsPerKm: number;
      displayUnit: "km" | "mi";
    }
  | ({ type: "thresholdPacePercent"; zoneId?: number } &
      WorkoutPercentPresetOrRange<WorkoutPacePreset>)
  | ({ type: "effortPacePercent"; zoneId?: number } &
      WorkoutPercentPresetOrRange<WorkoutPacePreset>)
  | ({ type: "ftpPercent"; zoneId?: number } &
      WorkoutPercentPresetOrRange<WorkoutFtpPreset>)
  | {
      type: "power";
      lowWatts: number;
      highWatts: number;
      preset?: never;
      zoneId?: never;
    }
  | {
      type: "power";
      preset: WorkoutRunningPowerPreset;
      zoneId?: number;
      lowWatts?: never;
      highWatts?: never;
    }
  | { type: "speed"; low: number; high: number; unit: "km/h" | "mph" }
  | { type: "cadence"; low: number; high: number; unit: "spm" | "rpm" }
  | { type: "swimStroke"; stroke: WorkoutSwimStroke }
  | { type: "weight"; mode: "bodyweight" }
  | { type: "weight"; mode: "weight"; value: number; unit: "kg" | "lb" }
  | { type: "rpe"; value: number }
  | {
      type: "climbGrade";
      system: WorkoutClimbSystem;
      relativeToOnsight: number;
      absoluteGrade?: never;
    }
  | {
      type: "climbGrade";
      system: WorkoutClimbSystem;
      absoluteGrade: string;
      relativeToOnsight?: never;
    }
  /** @deprecated Read compatibility for editor drafts created before typed HR bases. */
  | {
      type: "lthrPercent";
      lowPercent: number;
      highPercent: number;
      zoneId?: number;
    };

export interface WorkoutSportOptions {
  poolLength?: { value: number; unit: "m" | "yd" };
  gradingSystem?: WorkoutClimbSystem;
}

export type RunWorkoutCreateStepKind =
  | "warmup"
  | "training"
  | "rest"
  | "cooldown"
  | "interval"
  | "sendOff";

export type RunWorkoutCreateTargetType =
  | "time"
  | "distance"
  | "load"
  | "hrRecovery"
  | "open"
  | "reps"
  | "elevationGain"
  | "routes";

export interface RunWorkoutCreateStep {
  kind: RunWorkoutCreateStepKind;
  name?: string;
  target_type?: RunWorkoutCreateTargetType;
  target_distance_meters?: number;
  target_duration_seconds?: number;
  target_load?: number;
  target_hr_recovery_bpm?: number;
  target_reps?: number;
  target_elevation_gain_meters?: number;
  target_routes?: number;
  /** Send-off window used by Pool Swim package intervals. */
  send_off_seconds?: number;
  /** Typed intensity is authoritative. Legacy raw fields remain read-compatible. */
  intensity?: WorkoutIntensityInput;
  /** COROS strength/HYROX exercise identity or uniquely resolvable name. */
  exercise_id?: string;
  exercise_name?: string;
  exercise_kind?: number;
  pace?: string;
  intensity_type?: number;
  intensity_value?: number;
  intensity_value_extend?: number;
  intensity_display_unit?: number;
  intensity_multiplier?: number;
  intensity_custom?: number;
  hr_type?: number;
  is_intensity_percent?: boolean;
  intensity_percent?: number;
  intensity_percent_extend?: number;
  rest_type?: number;
  rest_value?: number;
  sets?: number;
  overview?: string;
  target_value?: number;
  target_display_unit?: number;
}

export interface RunWorkoutCreateRepeatGroup {
  repeat: number;
  name?: string;
  steps: RunWorkoutCreateStep[];
  rest_type?: number;
  rest_value?: number;
  overview?: string;
}

export type RunWorkoutStepInput =
  | RunWorkoutCreateStep
  | RunWorkoutCreateRepeatGroup;

export type WorkoutCreateStepKind = RunWorkoutCreateStepKind;
export type WorkoutCreateTargetType = RunWorkoutCreateTargetType;
export type WorkoutCreateStep = RunWorkoutCreateStep;
export type WorkoutCreateRepeatGroup = RunWorkoutCreateRepeatGroup;
export type WorkoutStepInput = RunWorkoutStepInput;

export interface CorosTrainingPlanDraftInput {
  name: string;
  workouts: PlanWorkoutEntryInput[];
}

export interface UploadPlanResultEntry {
  key: string;
  name: string;
  date?: string;
  programId?: string;
  scheduled: boolean;
  savedToLibrary: boolean;
}

export interface UploadPlanResult {
  planName: string;
  workoutsCreated: number;
  workoutsScheduled: number;
  entries: UploadPlanResultEntry[];
  destination?: TrainingPlanDestination;
  localPlanId?: string;
  groupedPlanCreated?: boolean;
  remoteWrites?: string[];
}

export interface TrainingHubScheduledWorkoutEntry {
  planId: string;
  idInPlan: string;
  planProgramId: string;
  happenDay: string;
  name: string;
  programId?: string;
  sportType?: number;
  sortNo?: number;
  volume?: string;
  trainingLoad?: number;
  exercises?: TrainingHubScheduledExercise[];
  /** Raw program payload from schedule/query — required to re-add the workout when rescheduling. */
  rawProgram?: Record<string, unknown>;
}

export interface TrainingHubLibraryWorkout {
  id: string;
  name: string;
  sportType?: number;
  volume?: string;
  trainingLoad?: number;
  createTimestamp?: number;
}

export interface WorkoutExerciseOption {
  id: string;
  name: string;
  exerciseKind?: number;
  thumbnailUrl?: string;
  media?: WorkoutExerciseMedia[];
}

export interface WorkoutExerciseMedia {
  coverUrl?: string;
  videoUrl?: string;
}

export type WorkoutEditRef =
  | {
      kind: "scheduled";
      happenDay: string;
      planId: string;
      idInPlan: string;
      planProgramId: string;
    }
  | { kind: "library"; programId: string };

export type RunWorkoutEditorStepKind =
  | "warmup"
  | "training"
  | "rest"
  | "cooldown"
  | "sendOff";

export type RunWorkoutEditorTarget =
  | { type: "time"; seconds: number }
  | { type: "distance"; meters: number }
  | { type: "load"; load: number }
  | { type: "hrRecovery"; bpm: number }
  | { type: "open" }
  | { type: "reps"; count: number }
  | { type: "elevationGain"; meters: number }
  | { type: "routes"; count: number };

export type RunWorkoutEditorIntensity = WorkoutIntensityInput;

export interface RunWorkoutEditorStep {
  id: string;
  sourceExerciseId?: string;
  nodeType: "step";
  kind: RunWorkoutEditorStepKind;
  name: string;
  target: RunWorkoutEditorTarget;
  intensity: RunWorkoutEditorIntensity;
  exerciseId?: string;
  exerciseName?: string;
  exerciseKind?: number;
  /** Number of sets for a standalone Strength exercise. */
  sets?: number;
  /** COROS recovery mode used between sets. Strength uses timed rest (1). */
  restType?: number;
  /** Recovery duration between sets, in seconds. */
  restValue?: number;
  /** Optional per-step instructions. COROS localization keys are not exposed here. */
  overview?: string;
  sendOffSeconds?: number;
  editable: boolean;
  unsupportedReason?: string;
}

export interface RunWorkoutEditorRepeatGroup {
  id: string;
  sourceExerciseId?: string;
  nodeType: "repeat";
  name: string;
  repeat: number;
  steps: RunWorkoutEditorStep[];
  editable: boolean;
  unsupportedReason?: string;
}

export type RunWorkoutEditorNode =
  | RunWorkoutEditorStep
  | RunWorkoutEditorRepeatGroup;

export interface RunWorkoutEditorDraft {
  name: string;
  overview: string;
  sportType: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  sport: WorkoutSport;
  sportOptions?: WorkoutSportOptions;
  nodes: RunWorkoutEditorNode[];
}

export type WorkoutEditorStepKind = RunWorkoutEditorStepKind;
export type WorkoutEditorTarget = RunWorkoutEditorTarget;
export type WorkoutEditorIntensity = RunWorkoutEditorIntensity;
export type WorkoutEditorStep = RunWorkoutEditorStep;
export type WorkoutEditorRepeatGroup = RunWorkoutEditorRepeatGroup;
export type WorkoutEditorNode = RunWorkoutEditorNode;
export type WorkoutEditorDraft = RunWorkoutEditorDraft;

export interface WorkoutZone {
  index: number;
  id: number;
  key: string;
  label: string;
  lowPercent: number;
  highPercent: number;
  lowBpm?: number;
  highBpm?: number;
}

/** @deprecated Use WorkoutZone. */
export type WorkoutLthrZone = WorkoutZone;

export interface WorkoutEditorContext {
  distanceUnit: "metric" | "imperial";
  paceUnit: "km" | "mi";
  lthrBpm?: number;
  maxHr?: number;
  restingHr?: number;
  thresholdPaceSecondsPerKm?: number;
  ftp?: number;
  criticalPower?: number;
  zones: Partial<Record<
    "maxHr" | "reserve" | "lthr" | "thresholdPace" | "ftp" | "runningPower",
    WorkoutZone[]
  >>;
  lthrZones: WorkoutLthrZone[];
  defaultPoolLength: { value: number; unit: "m" | "yd" };
  climbSystems: Partial<Record<"indoorClimb" | "bouldering", WorkoutClimbSystem>>;
}

export interface WorkoutEditorDocument {
  ref: WorkoutEditRef;
  revision: string;
  draft: RunWorkoutEditorDraft;
  context: WorkoutEditorContext;
  canEdit: boolean;
  unsupportedReason?: string;
}

export interface WorkoutEditPreview {
  durationSeconds?: number;
  distanceMeters?: number;
  trainingLoad?: number;
  baseFitness?: number;
  loadImpact?: number;
  intensityTrendPercent?: number;
}

export interface WorkoutEditSaveResult {
  verified: boolean;
  warning?: string;
  document: WorkoutEditorDocument;
}

export interface DeleteWorkoutResult {
  removedFromSchedule: boolean;
  removedFromLibrary: boolean;
  workoutName?: string;
  scheduleDate?: string;
  programId?: string;
  message: string;
}

export interface WorkoutDeletePreview {
  requestId: string;
  target: "scheduled" | "library" | "both";
  workoutName?: string;
  scheduleDate?: string;
  programId?: string;
  summary: string;
}

/** Persisted coach timeline entry (messages plus inline action cards). */
export type PersistedChatEntry =
  | PersistedChatMessageEntry
  | PersistedChatAnalysisSilentEntry
  | { kind: "coachPrompt"; prompt: CoachInputPrompt }
  | { kind: "planDraft"; draft: PlanDraftPreview }
  | { kind: "workoutDelete"; preview: WorkoutDeletePreview }
  | { kind: "activityVisual"; preview: ActivityVisualPreview }
  | { kind: "activityHrTrend"; preview: ActivityHrTrendPreview }
  | { kind: "fitnessTrend"; preview: FitnessTrendPreview }
  | { kind: "hrZoneSummary"; preview: HrZonePreview };

export interface IntervalsStatus {
  connected: boolean;
  athleteId?: string;
}

export interface IntervalsActivity {
  intervalsId: string;
  name: string;
  startEpochMs: number;
  movingSec: number;
  distanceM: number;
  type: string;
  fileExt: "fit" | "tcx" | "unknown";
}

export interface IntervalsActivityWithStatus extends IntervalsActivity {
  onCoros: boolean;
}

export interface ManualActivityInput {
  sport: "run" | "bike" | "other";
  startTimeIso: string;
  durationSec: number;
  distanceM: number;
  calories?: number;
  avgHr?: number;
}
