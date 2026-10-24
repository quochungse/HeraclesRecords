import { useEffect, useRef, useState } from "react";
import {
  ACESFilmicToneMapping,
  Box3,
  CanvasTexture,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  type BufferGeometry,
  type Material
} from "three";
import { Eye, EyeOff, Layers3 } from "lucide-react";
import {
  calculateFocusDistance,
  cinematicDollyProgress,
  cinematicEaseOut,
  nearestOrbitAngle,
  turnSpinUp
} from "./bodyFocus";
import { figureSex, type FigureSex } from "../training/body/physique";
import { loadHeroBody } from "./heroBody";
import { useHeroSample } from "./heroSample";
import { MUSCLE_BY_ID, MUSCLES, type MuscleId } from "./muscles";
import {
  heatLevel,
  metricValue,
  type HeatMetric,
  type MuscleStat
} from "./strengthAnalytics";
import { t } from "../i18n/core";

export type BodyView = "front" | "back";

interface BodyMapV2Props {
  view: BodyView;
  viewRequest: number;
  /** Turn the camera round the body without stopping. */
  rotating?: boolean;
  /** The side the turning camera faces now, written each frame it turns. */
  facingRef?: { current: BodyView };
  metric: HeatMetric;
  muscleById: Record<MuscleId, MuscleStat>;
  max: number;
  selected: MuscleId | null;
  hovered: MuscleId | null;
  onHover: (muscle: MuscleId | null) => void;
  onSelect: (muscle: MuscleId | null) => void;
  onViewChange?: (view: BodyView) => void;
  /** Hiding muscle groups is an authoring tool, hidden in prod. */
  showLayerControls?: boolean;
}

const MODEL_HEIGHT = 2;
// Canonical bounds of the upstream Z-Anatomy atlas after Blender's Y-up glTF
// conversion. The baked body is in that frame, so the figure is scaled by the
// atlas rather than by what it holds: a head or a bust cannot move the rest.
const Z_ANATOMY_BOUNDS = new Box3(
  new Vector3(-0.33558, 0.00634, -0.1314),
  new Vector3(0.33558, 1.70753, 0.13713)
);
const CAMERA_FOV = 25;
const CAMERA_FRAMING = 1.28;
// A touch under the figure's middle, so it stands a little high in the frame:
// the figure's controls run along its foot and the space over its head is
// empty.
const TARGET_Y = MODEL_HEIGHT * 0.485;
const COLOR_EPSILON = 0.0016;
const MAX_PIXEL_RATIO = 1.5;
const LAYER_STORAGE_KEY = "heraclesrecords-strength-muscle-layers-v2";
const SELECT_TRANSITION_MS = 900;
const CHANGE_SELECTION_MS = 750;
const CLEAR_SELECTION_MS = 700;
const CHANGE_VIEW_MS = 650;
// One turn every 3 s.
const ROTATE_RADIANS_PER_SECOND = (2 * Math.PI) / 3;
// A turn gathers speed rather than starting at it: a camera that has just
// come to rest — the body brought back from a muscle — would otherwise jump
// from standing to a third of a turn a second in one frame.
const TURN_SPIN_UP_MS = 900;
// A turn alone is drawn at 30 frames a second: the loop still wakes on every
// display frame, but the GPU is asked for half of them.
const TURN_FRAME_MS = 1000 / 30;
const CALLOUT_REVEAL_PROGRESS = 0.58;
const CAMERA_EYE_LIFT = 0.045;

// Draw priority, highest first. It only settles coincident boundaries, so it
// is fixed: the obliques sit over the abs they share an edge with.
const LAYER_ORDER: MuscleId[] = [
  "obliques",
  ...MUSCLES.map((muscle) => muscle.id).filter((id) => id !== "obliques")
];

function layerPriority(muscle: MuscleId): number {
  const index = LAYER_ORDER.indexOf(muscle);
  return index < 0 ? 0 : LAYER_ORDER.length - index;
}

function isMuscleId(value: unknown): value is MuscleId {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(MUSCLE_BY_ID, value)
  );
}

// An `order` stored by an earlier build, when the panel also reordered the
// layers, is read past and dropped on the next write.
function readHiddenLayers(): Set<MuscleId> {
  try {
    const stored = JSON.parse(localStorage.getItem(LAYER_STORAGE_KEY) ?? "null") as {
      hidden?: unknown;
    } | null;
    return new Set(
      Array.isArray(stored?.hidden) ? stored.hidden.filter(isMuscleId) : []
    );
  } catch {
    return new Set();
  }
}

interface Palette {
  base: Color;
  bone: Color;
  head: Color;
  connective: Color;
  heat: Color[];
  rim: Color;
  sky: Color;
  ground: Color;
  exposure: number;
  /**
   * How hard a hovered or selected belly is lit from inside. On a dark stage
   * the glow is what picks it out; on a light one the same amount washes the
   * heat colour toward white, so the muscle you just clicked reads *paler*
   * than it did before you clicked it. Paper leans on the dimming of
   * everything around it instead, and keeps barely any glow.
   */
  focusGlow: number;
  /**
   * How much lighter and more saturated a hovered or selected muscle turns, as
   * an HSL lightness step (0 keeps its colour). It does on a light stage what
   * the glow does on a dark one, without the glow's white.
   */
  focusLift: number;
}

function readPalette(element: HTMLElement): Palette {
  const styles = getComputedStyle(element);
  const readColor = (name: string, fallback: string) => {
    const value = styles.getPropertyValue(name).trim();
    try {
      return new Color(value || fallback);
    } catch {
      return new Color(fallback);
    }
  };
  const readNumber = (name: string, fallback: number) => {
    const value = Number.parseFloat(styles.getPropertyValue(name).trim());
    return Number.isFinite(value) ? value : fallback;
  };

  return {
    base: readColor("--m3d-base", "#39424b"),
    bone: readColor("--m3d-v2-bone", "#c8bea7"),
    head: readColor("--m3d-head", "#938e87"),
    connective: readColor("--m3d-v2-connective", "#d9cfc0"),
    heat: [0, 1, 2, 3, 4, 5].map((level) =>
      readColor(`--m3d-heat-${level}`, level === 0 ? "#938e87" : "#f2502d")
    ),
    rim: readColor("--m3d-rim", "#7fe8c4"),
    sky: readColor("--m3d-sky", "#93b8dc"),
    ground: readColor("--m3d-ground", "#151a1f"),
    exposure: readNumber("--m3d-exposure", 1),
    focusGlow: readNumber("--m3d-focus-glow", 0.42),
    focusLift: readNumber("--m3d-focus-lift", 0)
  };
}

function colorDistance(a: Color, b: Color): number {
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
}

function createShadowTexture(): CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(
      size / 2,
      size / 2,
      0,
      size / 2,
      size / 2,
      size / 2
    );
    gradient.addColorStop(0, "rgba(0,0,0,0.72)");
    gradient.addColorStop(0.5, "rgba(0,0,0,0.3)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

interface MuscleMaterial {
  material: MeshStandardMaterial;
  target: Color;
  scratch: Color;
  level: number;
}

function fitRootToModelFrame(root: Object3D) {
  const size = Z_ANATOMY_BOUNDS.getSize(new Vector3());
  const center = Z_ANATOMY_BOUNDS.getCenter(new Vector3());
  const scale = size.y > 0 ? MODEL_HEIGHT / size.y : 1;
  root.scale.setScalar(scale);
  root.position.set(
    -center.x * scale,
    -Z_ANATOMY_BOUNDS.min.y * scale,
    -center.z * scale
  );
  return { size, scale };
}

interface AnatomyWorld {
  dispose: () => void;
  refreshPalette: () => void;
  setHover: (hovered: MuscleId | null) => void;
  setHidden: (hidden: Set<MuscleId>) => void;
  setLevels: (levels: Record<MuscleId, number>) => void;
  setPresentation: (
    view: BodyView,
    selected: MuscleId | null,
    rotating: boolean
  ) => void;
}

interface CameraPose {
  angle: number;
  target: Vector3;
  distance: number;
}

interface CameraTransition {
  from: CameraPose;
  to: CameraPose;
  startedAt: number;
  duration: number;
  revealCallout: boolean;
}

function createWorld(
  container: HTMLDivElement,
  callout: HTMLDivElement,
  handlers: {
    onHover: (muscle: MuscleId | null) => void;
    onSelect: (muscle: MuscleId | null) => void;
    onViewChange: (view: BodyView) => void;
    onFacing: (view: BodyView) => void;
    onLoad: () => void;
    onLoadProgress: (progress: number | null) => void;
    onError: () => void;
  },
  sex: FigureSex
): AnatomyWorld {
  const renderer = new WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: "high-performance"
  });
  renderer.setPixelRatio(
    Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO)
  );
  renderer.setClearAlpha(0);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;

  const canvas = renderer.domElement;
  canvas.className = "body-map-canvas anatomy-body-canvas";
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "img");
  canvas.setAttribute(
    "aria-label",
    t("strength.map.label")
  );
  container.appendChild(canvas);

  const scene = new Scene();
  const camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.05, 100);
  const cameraDistance =
    (MODEL_HEIGHT * CAMERA_FRAMING) /
    (2 * Math.tan((CAMERA_FOV * Math.PI) / 360));
  const cameraTarget = new Vector3(0, TARGET_Y, 0);
  camera.position.set(0, TARGET_Y + CAMERA_EYE_LIFT, cameraDistance);
  camera.lookAt(cameraTarget);
  callout.dataset.visible = "false";
  callout.dataset.side = "right";

  const hemi = new HemisphereLight(0xaac3d8, 0x171b20, 0.9);
  const key = new DirectionalLight(0xfff8ed, 1.82);
  key.position.set(-2.8, 4.2, 3.7);
  const fill = new DirectionalLight(0xe5f0ff, 1.48);
  fill.position.set(3.2, 1.6, 2.6);
  const rim = new DirectionalLight(0xb9e6da, 0.72);
  rim.position.set(0.8, 2.2, -3.8);
  const lightRig = new Group();
  lightRig.name = "anatomy-camera-light-rig";
  lightRig.add(key, fill, rim);
  scene.add(hemi, lightRig);

  const modelRoot = new Group();
  modelRoot.name = "z-anatomy-muscular-system";
  scene.add(modelRoot);

  const shadowTexture = createShadowTexture();
  const shadowMaterial = new MeshBasicMaterial({
    map: shadowTexture,
    transparent: true,
    depthWrite: false,
    opacity: 0.44
  });
  const shadowGeometry = new PlaneGeometry(1, 1);
  const shadow = new Mesh(shadowGeometry, shadowMaterial);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -0.008;
  shadow.scale.set(1.45, 0.68, 1);
  scene.add(shadow);

  const groups = new Map<MuscleId, MuscleMaterial>();
  const sharedMaterials = new Set<Material>([shadowMaterial]);
  const geometries = new Set<BufferGeometry>([shadowGeometry]);
  const pickTargets: Mesh[] = [];
  const muscleMeshes = new Map<MuscleId, Mesh[]>();
  let hiddenMuscles = new Set<MuscleId>();

  for (const muscle of MUSCLES) {
    const isTopTorsoLayer = muscle.id === "obliques";
    const material = new MeshStandardMaterial({
      color: 0x46505a,
      emissive: 0x46505a,
      emissiveIntensity: 0.025,
      roughness: 0.54,
      metalness: 0.01,
      polygonOffset: isTopTorsoLayer,
      polygonOffsetFactor: isTopTorsoLayer ? -1 : 0,
      polygonOffsetUnits: isTopTorsoLayer ? -1 : 0
    });
    sharedMaterials.add(material);
    groups.set(muscle.id, {
      material,
      target: new Color(0x46505a),
      scratch: new Color(),
      level: 0
    });
  }

  const boneMaterial = new MeshPhysicalMaterial({
    color: 0x9bcbd8,
    emissive: 0x9bcbd8,
    emissiveIntensity: 0.1,
    roughness: 0.22,
    metalness: 0,
    clearcoat: 0.85,
    clearcoatRoughness: 0.16,
    transmission: 0.18,
    thickness: 0.08,
    ior: 1.38,
    transparent: true,
    opacity: 0.52,
    depthWrite: false
  });
  sharedMaterials.add(boneMaterial);

  const connectiveMaterial = new MeshPhysicalMaterial({
    color: 0xd9cfc0,
    emissive: 0xd9cfc0,
    emissiveIntensity: 0.025,
    roughness: 0.62,
    metalness: 0,
    clearcoat: 0.16,
    clearcoatRoughness: 0.5
  });
  sharedMaterials.add(connectiveMaterial);

  // The head is neutral clay with a soft sheen, opaque: it gives the figure a
  // face without competing with the heat colours below it.
  const headMaterial = new MeshStandardMaterial({
    color: 0x938e87,
    emissive: 0x938e87,
    emissiveIntensity: 0.1,
    roughness: 0.3,
    metalness: 0
  });
  sharedMaterials.add(headMaterial);

  let palette = readPalette(container);
  let localHover: MuscleId | null = null;
  let externalHover: MuscleId | null = null;
  let selected: MuscleId | null = null;
  let presentationView: BodyView = "front";
  let rotating = false;
  let lastTurnAt = 0;
  // How far into its spin-up the turn is, 0 to 1; back to 0 whenever it stops.
  let turnRamp = 0;
  let modelReady = false;
  let calloutProjectionReady = false;
  let calloutRevealReady = false;
  let cameraPose: CameraPose = {
    angle: 0,
    target: cameraTarget.clone(),
    distance: cameraDistance
  };
  let cameraTransition: CameraTransition | null = null;
  let selectedBounds: Box3 | null = null;
  let selectedAnchor: Vector3 | null = null;
  let frame = 0;
  let visible = true;
  let disposed = false;
  let needsRender = true;
  let last = performance.now();

  const pointer = new Vector2();
  const raycaster = new Raycaster();
  const boundsSize = new Vector3();
  const projectedAnchor = new Vector3();
  const cameraRight = new Vector3();
  let pointerInside = false;
  let hoverDirty = false;

  const applyLayers = () => {
    for (const id of groups.keys()) {
      for (const mesh of muscleMeshes.get(id) ?? []) {
        // Draw priority resolves coincident boundaries only. Depth testing
        // remains enabled, so a deeper muscle cannot paint over the surface.
        mesh.renderOrder = layerPriority(id);
        mesh.visible = !hiddenMuscles.has(id);
      }
    }
    needsRender = true;
    start();
  };

  const applyPalette = () => {
    palette = readPalette(container);
    hemi.color.copy(palette.sky);
    hemi.groundColor.copy(palette.ground);
    rim.color.copy(palette.rim);
    renderer.toneMappingExposure = palette.exposure;
    boneMaterial.color.copy(palette.bone);
    boneMaterial.emissive.copy(palette.bone);
    connectiveMaterial.color.copy(palette.connective);
    connectiveMaterial.emissive.copy(palette.connective);
    headMaterial.color.copy(palette.head);
    headMaterial.emissive.copy(palette.head);
    for (const group of groups.values()) {
      group.target.copy(palette.heat[group.level] ?? palette.base);
    }
    needsRender = true;
    start();
  };

  const updateCalloutVisibility = () => {
    callout.dataset.visible = String(
      selected !== null && calloutProjectionReady && calloutRevealReady
    );
  };

  const applyCameraPose = () => {
    cameraTarget.copy(cameraPose.target);
    camera.position.set(
      cameraPose.target.x + Math.sin(cameraPose.angle) * cameraPose.distance,
      cameraPose.target.y + CAMERA_EYE_LIFT,
      cameraPose.target.z + Math.cos(cameraPose.angle) * cameraPose.distance
    );
    camera.lookAt(cameraPose.target);
    // Keep the studio key, fill, and rim stable relative to the viewer.
    lightRig.rotation.y = cameraPose.angle;
  };

  const muscleBounds = (muscle: MuscleId): Box3 | null => {
    const meshes = muscleMeshes.get(muscle) ?? [];
    if (!modelReady || meshes.length === 0) {
      return null;
    }
    modelRoot.updateMatrixWorld(true);
    const bounds = new Box3().makeEmpty();
    for (const mesh of meshes) {
      bounds.expandByObject(mesh, true);
    }
    return bounds.isEmpty() ? null : bounds;
  };

  const destinationPose = (): CameraPose => {
    const angle = presentationView === "front" ? 0 : Math.PI;
    selectedBounds = selected ? muscleBounds(selected) : null;
    if (!selectedBounds) {
      selectedAnchor = null;
      return {
        // A turning body is not brought round to a side: a resize or a model
        // arriving mid-turn would snap it to the front or back. Coming back
        // from a muscle it keeps the side the camera was flying to, so the
        // body settles face on before the turn takes up again.
        angle: rotating
          ? (cameraTransition?.to.angle ?? cameraPose.angle)
          : nearestOrbitAngle(cameraPose.angle, angle),
        target: new Vector3(0, TARGET_Y, 0),
        distance: cameraDistance
      };
    }

    const size = selectedBounds.getSize(boundsSize);
    const center = selectedBounds.getCenter(new Vector3());
    cameraRight.set(Math.cos(angle), 0, -Math.sin(angle));
    const compositionOffset = Math.min(
      0.1,
      Math.max(0.025, size.x * 0.16)
    );
    const target = center.clone().addScaledVector(cameraRight, compositionOffset);
    const distance = calculateFocusDistance({
      width: size.x * 1.22,
      height: size.y,
      verticalFovDegrees: CAMERA_FOV,
      aspect: camera.aspect,
      fullBodyDistance: cameraDistance
    });

    // Bias the anchor toward the camera-right copy of bilateral groups, then
    // lift it just off the visible surface so the callout line reads cleanly.
    selectedAnchor = center.clone();
    selectedAnchor.addScaledVector(cameraRight, size.x * 0.34);
    selectedAnchor.y += size.y * 0.06;
    selectedAnchor.z =
      presentationView === "front"
        ? selectedBounds.max.z + 0.008
        : selectedBounds.min.z - 0.008;

    return {
      angle: nearestOrbitAngle(cameraPose.angle, angle),
      target,
      distance
    };
  };

  const positionCallout = () => {
    if (!selectedAnchor || !selected) {
      calloutProjectionReady = false;
      updateCalloutVisibility();
      return;
    }

    projectedAnchor.copy(selectedAnchor).project(camera);
    const width = container.clientWidth;
    const height = container.clientHeight;
    const projectionIsValid =
      width > 0 &&
      height > 0 &&
      Number.isFinite(projectedAnchor.x) &&
      Number.isFinite(projectedAnchor.y) &&
      projectedAnchor.z >= -1 &&
      projectedAnchor.z <= 1;
    if (!projectionIsValid) {
      calloutProjectionReady = false;
      updateCalloutVisibility();
      return;
    }

    const safeInset = 16;
    const anchorX = (projectedAnchor.x * 0.5 + 0.5) * width;
    const anchorY = (-projectedAnchor.y * 0.5 + 0.5) * height;
    const calloutWidth = Math.max(72, callout.offsetWidth);
    const calloutHeight = Math.max(28, callout.offsetHeight);
    const fitsRight = anchorX + calloutWidth <= width - safeInset;
    const side = fitsRight ? "right" : "left";
    const unclampedX = fitsRight ? anchorX : anchorX - calloutWidth;
    const x = Math.min(
      width - safeInset - calloutWidth,
      Math.max(safeInset, unclampedX)
    );
    const y = Math.min(
      height - safeInset - calloutHeight,
      Math.max(safeInset, anchorY - calloutHeight / 2)
    );
    callout.dataset.side = side;
    callout.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
    calloutProjectionReady = true;
    updateCalloutVisibility();
  };

  const applyPresentationImmediately = () => {
    cameraTransition = null;
    cameraPose = destinationPose();
    applyCameraPose();
    calloutRevealReady = selected !== null && selectedAnchor !== null;
    positionCallout();
    needsRender = true;
    start();
  };

  const beginPresentation = (duration: number) => {
    const destination = destinationPose();
    calloutRevealReady = false;
    updateCalloutVisibility();

    if (duration <= 0) {
      cameraPose = destination;
      applyPresentationImmediately();
      return;
    }

    cameraTransition = {
      from: {
        angle: cameraPose.angle,
        target: cameraPose.target.clone(),
        distance: cameraPose.distance
      },
      to: destination,
      startedAt: performance.now(),
      duration,
      revealCallout: selected !== null && selectedAnchor !== null
    };
    needsRender = true;
    start();
  };

  const updatePointer = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  };

  const pick = (): MuscleId | null => {
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster
      .intersectObjects(pickTargets, false)
      .filter((candidate) => candidate.object.visible);
    const nearest = hits[0];
    if (!nearest) {
      return null;
    }
    const muscle = nearest.object.userData.strengthMuscle;
    return typeof muscle === "string" ? (muscle as MuscleId) : null;
  };

  const onPointerMove = (event: PointerEvent) => {
    pointerInside = true;
    updatePointer(event);
    hoverDirty = true;
    start();
  };

  const onPointerUp = (event: PointerEvent) => {
    if (event.button !== 0) {
      return;
    }
    updatePointer(event);
    const hit = pick();
    if (!hit && localHover) {
      localHover = null;
      handlers.onHover(null);
    }
    handlers.onSelect(hit);
  };

  const onPointerLeave = () => {
    pointerInside = false;
    hoverDirty = false;
    if (localHover) {
      localHover = null;
      handlers.onHover(null);
      needsRender = true;
      start();
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    let next: BodyView | null = null;
    if (event.key === "ArrowLeft") {
      next = "front";
    } else if (event.key === "ArrowRight") {
      next = "back";
    } else if (event.key === "Home") {
      next = "front";
    }
    if (next) {
      event.preventDefault();
      handlers.onViewChange(next);
    }
  };

  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("keydown", onKeyDown);

  const resize = () => {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width <= 0 || height <= 0) {
      return;
    }
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (modelReady) {
      if (cameraTransition) {
        cameraTransition.to = destinationPose();
        needsRender = true;
        start();
        return;
      }
      applyPresentationImmediately();
      return;
    }
    needsRender = true;
    start();
  };

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);

  // A hidden window drops the frame loop; coming back has to restart it, or a
  // turning body stands still until the pointer moves over it.
  const onVisibilityChange = () => {
    if (!document.hidden) {
      start();
    }
  };
  document.addEventListener("visibilitychange", onVisibilityChange);

  const intersectionObserver = new IntersectionObserver(
    (entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
      if (visible) {
        start();
      }
    },
    { threshold: 0 }
  );
  intersectionObserver.observe(container);

  const tick = () => {
    frame = 0;
    if (!visible || document.hidden || disposed) {
      return;
    }
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    let animating = false;
    let turning = false;

    if (cameraTransition) {
      const progress = Math.min(
        1,
        Math.max(0, (now - cameraTransition.startedAt) / cameraTransition.duration)
      );
      const orbitProgress = cinematicEaseOut(progress);
      const dollyProgress = cinematicDollyProgress(progress);
      cameraPose.angle =
        cameraTransition.from.angle +
        (cameraTransition.to.angle - cameraTransition.from.angle) * orbitProgress;
      cameraPose.target.lerpVectors(
        cameraTransition.from.target,
        cameraTransition.to.target,
        orbitProgress
      );
      cameraPose.distance =
        cameraTransition.from.distance +
        (cameraTransition.to.distance - cameraTransition.from.distance) *
          dollyProgress;
      applyCameraPose();
      needsRender = true;
      if (
        cameraTransition.revealCallout &&
        progress >= CALLOUT_REVEAL_PROGRESS
      ) {
        calloutRevealReady = true;
      }
      if (progress >= 1) {
        cameraPose.angle = cameraTransition.to.angle;
        cameraPose.target.copy(cameraTransition.to.target);
        cameraPose.distance = cameraTransition.to.distance;
        applyCameraPose();
        calloutRevealReady = cameraTransition.revealCallout;
        cameraTransition = null;
      } else {
        animating = true;
      }
    }

    // The turn waits for a transition to land, and never runs with a muscle
    // in focus: the camera is framing that muscle then.
    if (rotating && !cameraTransition && selected === null) {
      turning = true;
      const sinceTurn = now - lastTurnAt;
      if (sinceTurn > 250) {
        // The turn starting, or the loop back after a pause: go on from here
        // rather than jump by the time it was away.
        lastTurnAt = now;
      } else if (sinceTurn >= TURN_FRAME_MS - 1) {
        lastTurnAt = now;
        turnRamp = Math.min(1, turnRamp + sinceTurn / TURN_SPIN_UP_MS);
        cameraPose.angle +=
          (sinceTurn / 1000) * ROTATE_RADIANS_PER_SECOND * turnSpinUp(turnRamp);
        applyCameraPose();
        handlers.onFacing(Math.cos(cameraPose.angle) >= 0 ? "front" : "back");
        needsRender = true;
        hoverDirty = pointerInside;
      }
    } else {
      turnRamp = 0;
    }

    if (hoverDirty && pointerInside) {
      hoverDirty = false;
      const hit = pick();
      if (hit !== localHover) {
        localHover = hit;
        handlers.onHover(hit);
      }
      canvas.style.cursor = hit ? "pointer" : "default";
    }

    const active = localHover ?? externalHover;
    const colorStep = 1 - Math.exp(-dt * 8);
    for (const [id, group] of groups) {
      const dimmed = selected !== null && selected !== id;
      const focused = id === active || id === selected;
      let target = dimmed
        ? group.scratch.copy(group.target).lerp(palette.base, 0.72)
        : group.target;
      if (focused && palette.focusLift > 0) {
        target = group.scratch
          .copy(target)
          .offsetHSL(0, palette.focusLift * 0.8, palette.focusLift);
      }
      if (colorDistance(group.material.color, target) > COLOR_EPSILON) {
        group.material.color.lerp(target, colorStep);
        animating = true;
      } else {
        group.material.color.copy(target);
      }
      group.material.emissive.copy(group.material.color);
      const wantedGlow = focused ? palette.focusGlow : dimmed ? 0 : 0.025;
      if (Math.abs(group.material.emissiveIntensity - wantedGlow) > 0.002) {
        group.material.emissiveIntensity +=
          (wantedGlow - group.material.emissiveIntensity) * colorStep;
        animating = true;
      } else {
        group.material.emissiveIntensity = wantedGlow;
      }
    }

    if (selected || calloutProjectionReady) {
      positionCallout();
    }

    if (animating || needsRender) {
      needsRender = false;
      renderer.render(scene, camera);
    }
    if (animating || turning) {
      frame = requestAnimationFrame(tick);
    }
  };

  function start() {
    if (frame !== 0 || !visible || document.hidden || disposed) {
      return;
    }
    last = performance.now();
    frame = requestAnimationFrame(tick);
  }

  // The body is baked (heroBody.ts): muscles grouped and mirrored, the skull
  // replaced by a clay head, her bust a mesh of its own, so building it here is
  // only handing those buffers to meshes. A body still loading for a world
  // already gone must not move the next one's progress.
  handlers.onLoadProgress(0);
  void loadHeroBody(sex, (progress) => {
    if (!disposed) {
      handlers.onLoadProgress(progress);
    }
  }).then(
    (hero) => {
      if (disposed) {
        for (const geometry of [...hero.muscles.values(), hero.connective, hero.skeleton, hero.head, hero.bust]) {
          geometry?.dispose();
        }
        return;
      }
      const bodyRoot = new Group();
      bodyRoot.name = "hero-body";

      const connective = new Mesh(hero.connective, connectiveMaterial);
      connective.name = "anatomy-connective-tissue";
      connective.renderOrder = MUSCLES.length + 1;
      geometries.add(hero.connective);
      bodyRoot.add(connective);

      const addMuscle = (muscle: MuscleId, geometry: BufferGeometry) => {
        geometries.add(geometry);
        const mesh = new Mesh(geometry, groups.get(muscle)!.material);
        mesh.name = `strength-${muscle}`;
        mesh.visible = !hiddenMuscles.has(muscle);
        mesh.userData.strengthMuscle = muscle;
        pickTargets.push(mesh);
        const meshes = muscleMeshes.get(muscle) ?? [];
        meshes.push(mesh);
        muscleMeshes.set(muscle, meshes);
        bodyRoot.add(mesh);
      };
      for (const [muscle, geometry] of hero.muscles) {
        if (groups.has(muscle)) {
          addMuscle(muscle, geometry);
        }
      }
      if (hero.bust) {
        addMuscle("chest", hero.bust);
      }

      // Bones are neutral, unpickable context behind the heat-mapped muscles.
      const skeleton = new Mesh(hero.skeleton, boneMaterial);
      skeleton.name = "anatomy-skeleton-context";
      geometries.add(hero.skeleton);
      bodyRoot.add(skeleton);

      geometries.add(hero.head);
      const head = new Mesh(hero.head, headMaterial);
      head.name = "anatomy-head";
      bodyRoot.add(head);

      const { size, scale } = fitRootToModelFrame(bodyRoot);
      modelRoot.add(bodyRoot);
      modelReady = true;
      applyLayers();
      beginPresentation(selected ? SELECT_TRANSITION_MS : 0);

      const scaledWidth = size.x * scale;
      const scaledDepth = size.z * scale;
      shadow.scale.set(
        Math.max(0.72, scaledWidth * 0.7),
        Math.max(0.34, scaledDepth * 1.7),
        1
      );
      handlers.onLoad();
      needsRender = true;
      start();
    },
    () => {
      if (!disposed) {
        handlers.onError();
      }
    }
  );

  applyPalette();
  resize();

  const world: AnatomyWorld = {
    dispose() {
      disposed = true;
      if (frame !== 0) {
        cancelAnimationFrame(frame);
      }
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("keydown", onKeyDown);
      for (const geometry of geometries) {
        geometry.dispose();
      }
      for (const material of sharedMaterials) {
        material.dispose();
      }
      shadowTexture.dispose();
      renderer.dispose();
      callout.dataset.visible = "false";
      canvas.remove();
    },
    refreshPalette: applyPalette,
    setHover(nextHovered) {
      externalHover = nextHovered;
      needsRender = true;
      start();
    },
    setHidden(nextHidden) {
      hiddenMuscles = new Set(nextHidden);
      if (localHover && hiddenMuscles.has(localHover)) {
        localHover = null;
        handlers.onHover(null);
      }
      applyLayers();
    },
    setLevels(levels) {
      for (const [id, group] of groups) {
        group.level = levels[id] ?? 0;
        group.target.copy(palette.heat[group.level] ?? palette.base);
      }
      needsRender = true;
      start();
    },
    setPresentation(nextView, nextSelected, nextRotating) {
      const previousSelected = selected;
      const previousView = presentationView;
      const wasRotating = rotating;
      selected = nextSelected;
      presentationView = nextView;
      rotating = nextRotating;

      if (nextRotating && !nextSelected && !previousSelected) {
        // Turning carries on from wherever the camera is.
        needsRender = true;
        start();
        return;
      }

      let duration = 0;
      if (previousSelected && nextSelected && previousSelected !== nextSelected) {
        duration = CHANGE_SELECTION_MS;
      } else if (!previousSelected && nextSelected) {
        duration = SELECT_TRANSITION_MS;
      } else if (previousSelected && !nextSelected) {
        duration = CLEAR_SELECTION_MS;
      } else if (previousView !== nextView || wasRotating) {
        duration = CHANGE_VIEW_MS;
      }

      beginPresentation(duration);
    }
  };

  return world;
}

export function BodyMapV2({
  view,
  viewRequest,
  rotating = false,
  facingRef,
  metric,
  muscleById,
  max,
  selected,
  hovered,
  onHover,
  onSelect,
  onViewChange,
  showLayerControls = false
}: BodyMapV2Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const calloutRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<AnatomyWorld | null>(null);
  const handlersRef = useRef({ onHover, onSelect, onViewChange, facingRef });
  handlersRef.current = { onHover, onSelect, onViewChange, facingRef };
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [hiddenLayers, setHiddenLayers] = useState(readHiddenLayers);
  const layerControlRef = useRef<HTMLDivElement | null>(null);
  // The body follows the athlete's sex on the COROS profile, a man until it
  // says otherwise, and null until the profile has answered, so a woman's
  // figure is not built as a man's first. The snapshot comes from the main
  // process's hour-long cache, so asking costs no COROS request.
  const [sex, setSex] = useState<FigureSex | null>(null);
  // The developer toolbar's Sample menu may pick the figure in its place.
  const sampleSex = useHeroSample();
  const shownSex = sampleSex ?? sex;
  // Bumped when a new body has been built, so the state below is handed to it.
  const [worldVersion, setWorldVersion] = useState(0);

  useEffect(() => {
    const api = window.heraclesRecords;
    if (!api) {
      setSex("male");
      return;
    }
    let cancelled = false;
    void api
      .getCorosProfileSnapshot()
      .then((snapshot) => {
        if (!cancelled) {
          setSex(figureSex(snapshot.profile.sex));
        }
      })
      .catch(() => {
        // No profile (signed out, offline): the default body.
        if (!cancelled) {
          setSex("male");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleLayer = (muscle: MuscleId) => {
    setHiddenLayers((current) => {
      const hidden = new Set(current);
      if (hidden.has(muscle)) {
        hidden.delete(muscle);
      } else {
        hidden.add(muscle);
      }
      return hidden;
    });
  };

  // The panel is for the whole figure, so it closes when a muscle is
  // focused (its trigger goes with the rest of the figure's controls), on
  // Escape, and on a press anywhere outside it.
  useEffect(() => {
    if (selected) {
      setLayersOpen(false);
    }
  }, [selected]);

  useEffect(() => {
    if (!layersOpen) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!layerControlRef.current?.contains(event.target as Node)) {
        setLayersOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setLayersOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [layersOpen]);

  useEffect(() => {
    const container = containerRef.current;
    const callout = calloutRef.current;
    if (!container || !callout || !shownSex) {
      return;
    }
    let world: AnatomyWorld;
    try {
      world = createWorld(
        container,
        callout,
        {
          onHover: (muscle) => handlersRef.current.onHover(muscle),
          onSelect: (muscle) => handlersRef.current.onSelect(muscle),
          onViewChange: (next) => handlersRef.current.onViewChange?.(next),
          onFacing: (next) => {
            const ref = handlersRef.current.facingRef;
            if (ref) {
              ref.current = next;
            }
          },
          onLoad: () => {
            setLoading(false);
            setFailed(false);
          },
          onLoadProgress: setProgress,
          onError: () => {
            setLoading(false);
            setFailed(true);
          }
        },
        shownSex
      );
    } catch {
      setLoading(false);
      setFailed(true);
      return;
    }
    worldRef.current = world;
    setLoading(true);
    setFailed(false);
    setWorldVersion((current) => current + 1);

    const themeObserver = new MutationObserver(() => world.refreshPalette());
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"]
    });

    return () => {
      themeObserver.disconnect();
      world.dispose();
      worldRef.current = null;
    };
  }, [shownSex]);

  useEffect(() => {
    const levels = {} as Record<MuscleId, number>;
    for (const [id, stat] of Object.entries(muscleById) as [
      MuscleId,
      MuscleStat
    ][]) {
      levels[id] = heatLevel(metricValue(stat, metric), max);
    }
    worldRef.current?.setLevels(levels);
  }, [metric, max, muscleById, worldVersion]);

  useEffect(() => {
    worldRef.current?.setHover(hovered);
  }, [hovered, worldVersion]);

  useEffect(() => {
    worldRef.current?.setPresentation(view, selected, rotating);
  }, [view, viewRequest, rotating, selected, worldVersion]);

  useEffect(() => {
    if (!selected) {
      return;
    }
    setHiddenLayers((current) => {
      if (!current.has(selected)) {
        return current;
      }
      const hidden = new Set(current);
      hidden.delete(selected);
      return hidden;
    });
  }, [selected]);

  useEffect(() => {
    worldRef.current?.setHidden(hiddenLayers);
    try {
      localStorage.setItem(
        LAYER_STORAGE_KEY,
        JSON.stringify({ hidden: [...hiddenLayers] })
      );
    } catch {
      // The renderer still works when storage is unavailable.
    }
  }, [hiddenLayers, worldVersion]);

  return (
    <div
      className={`body-map anatomy-body-map${selected ? " is-focused" : ""}`}
      ref={containerRef}
    >
      {loading ? (
        <div className="anatomy-model-status" role="status" aria-live="polite">
          <span className="anatomy-model-skeleton" aria-hidden="true" />
          <strong>{t("strength.map.loading")}</strong>
          <span>
            {progress === null ? t("strength.map.preparing") : `${Math.round(progress * 100)}%`}
          </span>
        </div>
      ) : null}
      {failed ? (
        <p className="body-map-fallback" role="alert">
          {t("strength.map.failed")}
        </p>
      ) : null}
      <div
        className="anatomy-muscle-callout"
        ref={calloutRef}
        aria-hidden="true"
      >
        <span className="anatomy-muscle-callout-line" />
        <strong>{selected ? MUSCLE_BY_ID[selected].label : ""}</strong>
      </div>
      {showLayerControls ? (
        <div
          className={`anatomy-layer-control${layersOpen ? " is-open" : ""}`}
          ref={layerControlRef}
          inert={selected !== null}
        >
          <button
            type="button"
            className="anatomy-layer-trigger"
            aria-label={t("strength.layers.title")}
            title={t("strength.layers.title")}
            aria-expanded={layersOpen}
            aria-controls="anatomy-muscle-layers"
            onClick={() => setLayersOpen((current) => !current)}
          >
            <Layers3 size={14} aria-hidden="true" />
          </button>
          {layersOpen ? (
            <section
              className="anatomy-layer-panel"
              id="anatomy-muscle-layers"
              aria-label={t("strength.layers.title")}
            >
              <header>
                <strong>{t("strength.layers.title")}</strong>
                <button
                  type="button"
                  className="anatomy-layer-show-all"
                  disabled={hiddenLayers.size === 0}
                  onClick={() => setHiddenLayers(new Set())}
                >
                  {t("strength.layers.showAll")}
                </button>
              </header>
              <ul>
                {MUSCLES.map(({ id: muscle, label }) => {
                  const hidden = hiddenLayers.has(muscle);
                  return (
                    <li key={muscle}>
                      <button
                        type="button"
                        role="switch"
                        className="anatomy-layer-row"
                        aria-checked={!hidden}
                        onClick={() => toggleLayer(muscle)}
                      >
                        <span>{label}</span>
                        {hidden ? (
                          <EyeOff size={13} aria-hidden="true" />
                        ) : (
                          <Eye size={13} aria-hidden="true" />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
      <span className="sr-only" aria-live="polite">
        {selected ? t("strength.map.selected", { muscle: MUSCLE_BY_ID[selected].label }) : ""}
      </span>
    </div>
  );
}
