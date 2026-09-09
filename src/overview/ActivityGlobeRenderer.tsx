import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import {
  ACCENT_PALETTE_DETAILS,
  type AccentPalette
} from "../theme/accentPalette";
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  HemisphereLight,
  MeshStandardMaterial,
  type Light,
  NormalBlending,
  Points,
  ShaderMaterial,
  SRGBColorSpace,
} from "three";
import type { GeoHeatBucket, GlobePoint } from "./activityVisitHeatmap";
import {
  FIT_MIN_ALTITUDE,
  SINGLE_PLACE_ALTITUDE,
  clampLatitude,
  computeFitView,
  focusLatitudeOffset,
  labelSeparationDegrees,
  pickSpacedPlaces,
  type GlobeCameraView,
} from "./globeFraming";

/** #rrggbb -> rgba(), for the globe point colours which need an alpha. */
function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}


interface ActivityGlobeRendererProps {
  frameKey: string;
  locations: GeoHeatBucket[];
  routePoints: GlobePoint[];
  selectedLocation: GeoHeatBucket | null;
  /** City name per location key, for the labels pinned on the globe. */
  labels: Record<string, string>;
  streetMode: boolean;
  onError: (error: boolean) => void;
  onHoverChange: (hovering: boolean) => void;
  onRequestStreet: (focus: { lat: number; lon: number }) => void;
  onSelectLocation: (bucket: GeoHeatBucket) => void;
  onViewChange: (changed: boolean) => void;
}

export interface ActivityGlobeRendererHandle {
  resetView: (duration?: number) => void;
  zoomToLocation: (
    focus: { lat: number; lon: number },
    duration?: number,
  ) => number;
}

type GlobeView = GlobeCameraView;

interface ActivityPoint extends GeoHeatBucket {
  intensity: number;
}

interface LandLayerData {
  kind: "geography";
  object: Points<BufferGeometry, ShaderMaterial>;
}

interface LandGeometryData {
  positions: Float32Array;
  strengths: Float32Array;
}

interface LandGeometryMessage {
  positions: ArrayBuffer;
  strengths: ArrayBuffer;
}

interface RouteLayerData {
  points: GlobePoint[];
}

const GLOBE_RADIUS = 100;
const DEFAULT_VIEW: GlobeView = { lat: 18, lng: -20, altitude: 2.2 };
const FRAMING_VERSION = "fit-all-places-v1";
const CAMERA_FOCUS_MS = 600;
const STREET_VIEW_ALTITUDE = 0.42;
const STREET_TRANSITION_ALTITUDE = 0.36;
const IDLE_DELAY_MS = 4_200;
const IDLE_ROTATION_SPEED = 0.08;
/** Above this the globe reads as a globe and an idle spin is decorative;
 *  below it the spin would slide the framed places out of view. */
const IDLE_ROTATION_MIN_ALTITUDE = 1.6;
/** Rings animate per datum, so the pulsing highlight is capped. */
const MAX_HIGHLIGHT_RINGS = 18;
/** More than a handful of pinned names turns the globe into a word cloud. */
const MAX_HIGHLIGHT_LABELS = 6;

let landGeometryCache: LandGeometryData | null = null;
let landGeometryPromise: Promise<LandGeometryData> | null = null;

function loadLandGeometry(): Promise<LandGeometryData> {
  if (landGeometryCache) {
    return Promise.resolve(landGeometryCache);
  }
  if (landGeometryPromise) {
    return landGeometryPromise;
  }

  landGeometryPromise = new Promise<LandGeometryData>((resolve, reject) => {
    const worker = new Worker(
      new URL("./activityGlobeLand.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.onmessage = (event: MessageEvent<LandGeometryMessage>) => {
      landGeometryCache = {
        positions: new Float32Array(event.data.positions),
        strengths: new Float32Array(event.data.strengths),
      };
      worker.terminate();
      resolve(landGeometryCache);
    };
    worker.onerror = (event) => {
      landGeometryPromise = null;
      worker.terminate();
      reject(new Error(event.message || "Unable to prepare globe geography."));
    };
  });
  return landGeometryPromise;
}

function createGeographyPoints(
  paperTheme: boolean,
  landGeometry: LandGeometryData,
): LandLayerData {

  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(landGeometry.positions, 3),
  );
  geometry.setAttribute(
    "aStrength",
    new BufferAttribute(landGeometry.strengths, 1),
  );

  const material = new ShaderMaterial({
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: NormalBlending,
    uniforms: {
      uColor: {
        value: new Color(paperTheme ? "#667179" : "#c4d5e1"),
      },
      uOpacity: { value: paperTheme ? 0.5 : 0.32 },
      uPointSize: { value: paperTheme ? 1.9 : 1.78 },
      uPixelRatio: {
        value: Math.min(window.devicePixelRatio || 1, 2),
      },
    },
    vertexShader: `
      attribute float aStrength;
      uniform float uPointSize;
      uniform float uPixelRatio;
      varying float vAlpha;

      void main() {
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        vec3 viewNormal = normalize(normalMatrix * normalize(position));
        float facing = clamp(viewNormal.z, 0.0, 1.0);
        vAlpha = aStrength * smoothstep(0.03, 0.72, facing);
        gl_PointSize = uPointSize * uPixelRatio * (220.0 / max(1.0, -viewPosition.z));
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vAlpha;

      void main() {
        vec2 point = gl_PointCoord - vec2(0.5);
        float radius = dot(point, point);
        if (radius > 0.25) discard;
        float edge = 1.0 - smoothstep(0.16, 0.25, radius);
        gl_FragColor = vec4(uColor, uOpacity * vAlpha * edge);
      }
    `,
  });
  const object = new Points(geometry, material);
  object.frustumCulled = false;
  object.renderOrder = 2;
  return { kind: "geography", object };
}

function viewChanged(current: GlobeView, baseline: GlobeView): boolean {
  const longitudeDelta = Math.abs(
    ((current.lng - baseline.lng + 540) % 360) - 180,
  );
  return (
    Math.abs(current.lat - baseline.lat) > 2 ||
    longitudeDelta > 2 ||
    Math.abs(current.altitude - baseline.altitude) > 0.05
  );
}

const ActivityGlobeRendererComponent = forwardRef<
  ActivityGlobeRendererHandle,
  ActivityGlobeRendererProps
>(function ActivityGlobeRenderer(
  {
    frameKey,
    locations,
    routePoints,
    selectedLocation,
    labels,
    streetMode,
    onError,
    onHoverChange,
    onRequestStreet,
    onSelectLocation,
    onViewChange,
  },
  forwardedRef,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const baselineRef = useRef<GlobeView>(DEFAULT_VIEW);
  const framedKeyRef = useRef<string | null>(null);
  const framedViewRef = useRef<GlobeView | null>(null);
  const interactionRef = useRef(false);
  const userAdjustedRef = useRef(false);
  const streetRequestedRef = useRef(false);
  const idleTimerRef = useRef<number | null>(null);
  const [ready, setReady] = useState(false);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [paperTheme, setPaperTheme] = useState(
    () => document.documentElement.dataset.theme === "paper",
  );
  // WebGL cannot read CSS custom properties, so the palette is mirrored from
  // the same root attribute the stylesheet keys off.
  const [accent, setAccent] = useState<AccentPalette>(
    () => (document.documentElement.dataset.accent as AccentPalette) ?? "gold",
  );
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [landGeometry, setLandGeometry] = useState<LandGeometryData | null>(
    landGeometryCache,
  );
  /** Read by the mount effect, which must not re-run when the theme changes. */
  const lightsRef = useRef<Light[]>([]);

  const globeMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: paperTheme ? "#cfd7dc" : "#121e28",
        roughness: paperTheme ? 0.78 : 0.8,
        metalness: paperTheme ? 0.12 : 0.18,
        emissive: new Color(paperTheme ? "#000000" : "#061018"),
        emissiveIntensity: paperTheme ? 0 : 0.08,
        dithering: true,
      }),
    [paperTheme],
  );

  const lights = useMemo(() => {
    const hemisphere = new HemisphereLight(
      paperTheme ? "#ffffff" : "#a9c6db",
      paperTheme ? "#687681" : "#03080c",
      paperTheme ? 0.96 : 0.72,
    );
    const directional = new DirectionalLight(
      paperTheme ? "#f8fbff" : "#d7e7f2",
      paperTheme ? 0.58 : 0.62,
    );
    directional.position.set(-3.5, 4.5, 5.5);
    return [hemisphere, directional];
  }, [paperTheme]);

  const landLayer = useMemo(
    () =>
      landGeometry
        ? createGeographyPoints(paperTheme, landGeometry)
        : null,
    [landGeometry, paperTheme],
  );
  const landLayerData = useMemo(
    () => (landLayer ? [landLayer] : []),
    [landLayer],
  );

  const activityPoints = useMemo<ActivityPoint[]>(() => {
    const maxCount = Math.max(1, ...locations.map((location) => location.count));
    return locations.map((location) => ({
      ...location,
      intensity: Math.sqrt(location.count / maxCount),
    }));
  }, [locations]);

  const pathsData = useMemo<RouteLayerData[]>(
    () => (routePoints.length >= 2 ? [{ points: routePoints }] : []),
    [routePoints],
  );
  /**
   * With nothing picked yet, every place is the highlight — the globe should
   * arrive showing where the training happened, not waiting to be clicked.
   */
  const highlightAll = !selectedLocation && !streetMode;

  /**
   * The view that holds every place at once. Falls back to the latest GPS track
   * before visit centroids have been bucketed, and to the whole globe when
   * there is nothing to frame at all.
   */
  const baselineView = useMemo<GlobeView>(
    () =>
      computeFitView(
        locations.length > 0 ? locations : routePoints,
        size.width / size.height,
        DEFAULT_VIEW.altitude,
      ) ?? DEFAULT_VIEW,
    [locations, routePoints, size.height, size.width],
  );

  const ringData = useMemo(() => {
    if (reducedMotion) {
      return [];
    }
    if (selectedLocation) {
      return [selectedLocation];
    }
    return highlightAll ? locations.slice(0, MAX_HIGHLIGHT_RINGS) : [];
  }, [highlightAll, locations, reducedMotion, selectedLocation]);

  /**
   * Markers and rings are sized in degrees of globe surface, and a degree covers
   * roughly `10 / altitude` pixels of the panel — so a fixed degree size shrinks
   * to nothing as the framing widens. Scaling by altitude holds them at a
   * constant size on screen; the constants below are the sizes at the tightest
   * framing (`FIT_MIN_ALTITUDE`), where a place fills a handful of pixels.
   */
  const frameAltitude = selectedLocation
    ? Math.min(baselineView.altitude, SINGLE_PLACE_ALTITUDE)
    : baselineView.altitude;
  const markerScale = frameAltitude / FIT_MIN_ALTITUDE;

  const labelData = useMemo(() => {
    if (selectedLocation) {
      return [selectedLocation];
    }
    if (!highlightAll) {
      return [];
    }
    return pickSpacedPlaces(
      locations.filter((location) => Boolean(labels[location.key])),
      MAX_HIGHLIGHT_LABELS,
      labelSeparationDegrees(baselineView.altitude),
    );
  }, [baselineView.altitude, highlightAll, labels, locations, selectedLocation]);

  const stopIdleRotation = useCallback(() => {
    if (idleTimerRef.current !== null) {
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    const controls = globeRef.current?.controls();
    if (controls) {
      controls.autoRotate = false;
    }
  }, []);

  const scheduleIdleRotation = useCallback(() => {
    stopIdleRotation();
    if (
      reducedMotion ||
      selectedLocation ||
      streetMode ||
      baselineRef.current.altitude < IDLE_ROTATION_MIN_ALTITUDE
    ) {
      return;
    }
    idleTimerRef.current = window.setTimeout(() => {
      const controls = globeRef.current?.controls();
      if (controls && !interactionRef.current) {
        controls.autoRotate = true;
        controls.autoRotateSpeed = IDLE_ROTATION_SPEED;
      }
    }, IDLE_DELAY_MS);
  }, [reducedMotion, selectedLocation, stopIdleRotation, streetMode]);

  const resetView = useCallback(
    (duration = 600) => {
      streetRequestedRef.current = false;
      userAdjustedRef.current = false;
      stopIdleRotation();
      globeRef.current?.pointOfView(
        baselineRef.current,
        reducedMotion ? 0 : duration,
      );
      onViewChange(false);
      scheduleIdleRotation();
    },
    [onViewChange, reducedMotion, scheduleIdleRotation, stopIdleRotation],
  );

  const zoomToLocation = useCallback(
    (focus: { lat: number; lon: number }, duration = 1_100) => {
      const globe = globeRef.current;
      const animationDuration = reducedMotion ? 0 : duration;
      if (!globe) {
        return 0;
      }
      streetRequestedRef.current = true;
      stopIdleRotation();
      globe.pointOfView(
        {
          lat: clampLatitude(focus.lat),
          lng: focus.lon,
          altitude: STREET_TRANSITION_ALTITUDE,
        },
        animationDuration,
      );
      onViewChange(true);
      return animationDuration;
    },
    [onViewChange, reducedMotion, stopIdleRotation],
  );

  useImperativeHandle(
    forwardedRef,
    () => ({ resetView, zoomToLocation }),
    [resetView, zoomToLocation],
  );

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) {
        return;
      }
      const width = Math.max(1, Math.round(entry.contentRect.width));
      const height = Math.max(1, Math.round(entry.contentRect.height));
      setSize((current) =>
        current.width === width && current.height === height
          ? current
          : { width, height },
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setPaperTheme(document.documentElement.dataset.theme === "paper");
      setAccent(
        (document.documentElement.dataset.accent as AccentPalette) ?? "gold",
      );
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-accent"],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleChange = () => setReducedMotion(query.matches);
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    if (landGeometry) {
      return;
    }
    let active = true;
    void loadLandGeometry()
      .then((geometry) => {
        if (active) {
          setLandGeometry(geometry);
        }
      })
      .catch(() => {
        // Geography is decorative. Keep the interactive globe usable if the
        // worker is unavailable on an older WebView.
      });
    return () => {
      active = false;
    };
  }, [landGeometry]);

  /**
   * globe.gl fires `onGlobeReady` from inside react-kapsule's mount, before its
   * `useImperativeHandle` has filled `globeRef` — so that callback arrives with
   * no instance to configure and readiness never lands (which left the camera
   * parked at globe.gl's own default view, framing code and all). A child's
   * layout effects commit before the parent's, so this is the first moment the
   * instance is guaranteed to exist.
   */
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) {
      onError(true);
      return;
    }
    const renderer = globe.renderer();
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearAlpha(0);
    globe.lights(lightsRef.current);
    // The framing effect owns the camera, first view included: pointing it here
    // would fight it, and StrictMode's second mount pass would snap a framed
    // globe back to the default view mid-animation.
    framedKeyRef.current = null;
    framedViewRef.current = null;
    onError(false);
    setReady(true);
    // Mount only: the theme's lights and the framing have their own effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    lightsRef.current = lights;
    if (!ready || !globeRef.current) {
      return;
    }
    globeRef.current.lights(lights);
  }, [lights, ready]);

  // Frames every place at once. Visit centroids stream in after mount, so this
  // re-frames as they land — until the person moves the camera themselves.
  useEffect(() => {
    if (!ready) {
      return;
    }
    const framingKey = `${frameKey}:${FRAMING_VERSION}`;
    const newFraming = framedKeyRef.current !== framingKey;
    if (newFraming) {
      framedKeyRef.current = framingKey;
      userAdjustedRef.current = false;
    }
    const previous = framedViewRef.current;
    baselineRef.current = baselineView;
    if (selectedLocation || streetMode) {
      return;
    }
    if (
      !newFraming &&
      previous &&
      (userAdjustedRef.current || !viewChanged(baselineView, previous))
    ) {
      return;
    }
    framedViewRef.current = baselineView;
    globeRef.current?.pointOfView(
      baselineView,
      reducedMotion ? 0 : newFraming ? 720 : 420,
    );
    onViewChange(false);
  }, [
    baselineView,
    frameKey,
    onViewChange,
    ready,
    reducedMotion,
    selectedLocation,
    streetMode,
  ]);

  useEffect(() => {
    if (!ready) {
      return;
    }
    if (!selectedLocation) {
      scheduleIdleRotation();
      return;
    }

    stopIdleRotation();
    // Never further out than the overview: picking a place should close in on
    // it, and the fitted overview can already be closer than globe scale.
    // `baselineRef` is current here — the framing effect above runs first.
    const altitude = Math.min(
      baselineRef.current.altitude,
      SINGLE_PLACE_ALTITUDE,
    );
    globeRef.current?.pointOfView(
      {
        lat: clampLatitude(
          selectedLocation.lat + focusLatitudeOffset(altitude),
        ),
        lng: selectedLocation.lon,
        altitude,
      },
      reducedMotion ? 0 : CAMERA_FOCUS_MS,
    );
    onViewChange(true);
  }, [
    onViewChange,
    ready,
    reducedMotion,
    scheduleIdleRotation,
    selectedLocation?.key,
    stopIdleRotation,
  ]);

  useEffect(() => {
    if (!ready || !globeRef.current) {
      return;
    }
    const controls = globeRef.current.controls();
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.enablePan = false;
    controls.enableRotate = true;
    controls.enableZoom = true;
    controls.rotateSpeed = 0.42;
    controls.zoomSpeed = 0.72;
    controls.minDistance = GLOBE_RADIUS * 1.32;
    controls.maxDistance = GLOBE_RADIUS * 5.2;
    controls.autoRotate = false;
    controls.autoRotateSpeed = IDLE_ROTATION_SPEED;

    const handleStart = () => {
      interactionRef.current = true;
      userAdjustedRef.current = true;
      stopIdleRotation();
    };
    const handleEnd = () => {
      interactionRef.current = false;
      scheduleIdleRotation();
    };
    controls.addEventListener("start", handleStart);
    controls.addEventListener("end", handleEnd);
    scheduleIdleRotation();
    return () => {
      controls.removeEventListener("start", handleStart);
      controls.removeEventListener("end", handleEnd);
      controls.autoRotate = false;
    };
  }, [ready, scheduleIdleRotation, stopIdleRotation]);

  useEffect(() => {
    if (streetMode) {
      stopIdleRotation();
    } else {
      streetRequestedRef.current = false;
      scheduleIdleRotation();
    }
  }, [scheduleIdleRotation, stopIdleRotation, streetMode]);

  useEffect(
    () => () => {
      globeMaterial.dispose();
    },
    [globeMaterial],
  );

  useEffect(
    () => () => {
      if (!landLayer) {
        return;
      }
      landLayer.object.geometry.dispose();
      landLayer.object.material.dispose();
    },
    [landLayer],
  );

  useEffect(
    () => () => {
      stopIdleRotation();
    },
    [stopIdleRotation],
  );

  const handleZoom = useCallback(
    (view: GlobeView) => {
      onViewChange(viewChanged(view, baselineRef.current));
      if (
        interactionRef.current &&
        !streetMode &&
        !streetRequestedRef.current &&
        view.altitude <= STREET_VIEW_ALTITUDE &&
        (locations.length > 0 || routePoints.length > 0)
      ) {
        streetRequestedRef.current = true;
        stopIdleRotation();
        onRequestStreet({ lat: view.lat, lon: view.lng });
      }
    },
    [
      locations.length,
      onRequestStreet,
      onViewChange,
      routePoints.length,
      stopIdleRotation,
      streetMode,
    ],
  );

  const handlePointClick = useCallback(
    (point: object) => onSelectLocation(point as GeoHeatBucket),
    [onSelectLocation],
  );

  const handlePointHover = useCallback(
    (point: object | null) => onHoverChange(Boolean(point)),
    [onHoverChange],
  );

  const makeHtmlLabel = useCallback(
    (datum: object) => {
      const location = datum as GeoHeatBucket;
      const anchor = document.createElement("div");
      anchor.className = "training-map-globe-label-anchor";
      anchor.dataset.locationKey = location.key;
      const label = document.createElement("span");
      const selected = location.key === selectedLocation?.key;
      label.className = selected
        ? "training-map-globe-label"
        : "training-map-globe-label is-secondary";
      label.textContent = labels[location.key] ?? "";
      anchor.append(label);
      return anchor;
    },
    [labels, selectedLocation?.key],
  );

  const modifyHtmlLabelVisibility = useCallback(
    (element: HTMLElement, visible: boolean) => {
      element.classList.toggle("is-hidden", !visible);
      element.setAttribute("aria-hidden", visible ? "false" : "true");
    },
    [],
  );

  const customThreeObject = useCallback(
    (datum: object) => (datum as LandLayerData).object,
    [],
  );

  const pointerEventsFilter = useCallback(
    (_object: unknown, data?: object) =>
      Boolean(data && "key" in data && "count" in data),
    [],
  );

  return (
    <div
      ref={containerRef}
      className={`activity-globe-webgl${streetMode ? " is-street-hidden" : ""}`}
      onPointerEnter={stopIdleRotation}
      onPointerLeave={scheduleIdleRotation}
    >
      <Globe
        ref={globeRef}
        width={size.width}
        height={size.height}
        backgroundColor="rgba(0, 0, 0, 0)"
        rendererConfig={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        animateIn={false}
        waitForGlobeReady={false}
        globeOffset={[0, 8]}
        globeMaterial={globeMaterial}
        globeCurvatureResolution={3}
        showAtmosphere
        atmosphereColor={paperTheme ? "#477f9f" : "#73b4e2"}
        atmosphereAltitude={0.08}
        customLayerData={landLayerData}
        customThreeObject={customThreeObject}
        pointsData={activityPoints}
        pointLat={(point) => (point as ActivityPoint).lat}
        pointLng={(point) => (point as ActivityPoint).lon}
        pointAltitude={(point) => {
          const activity = point as ActivityPoint;
          const base =
            activity.key === selectedLocation?.key
              ? 0.008
              : highlightAll
                ? 0.006
                : 0.0035;
          // Scaled like the radius, but never below the land dots (0.0025) —
          // a pin that sinks under the geography stops reading as a marker.
          return Math.max(0.003, base * markerScale);
        }}
        pointRadius={(point) => {
          const activity = point as ActivityPoint;
          if (activity.key === selectedLocation?.key) {
            return 0.28 * markerScale;
          }
          return (
            (highlightAll
              ? 0.17 + activity.intensity * 0.11
              : 0.1 + activity.intensity * 0.1) * markerScale
          );
        }}
        pointColor={(point) => {
          const activity = point as ActivityPoint;
          const tone = ACCENT_PALETTE_DETAILS[accent][
            paperTheme ? "paper" : "dark"
          ];
          if (activity.key === selectedLocation?.key) {
            return tone.strong;
          }
          if (highlightAll) {
            return withAlpha(tone.strong, paperTheme ? 0.94 : 0.88);
          }
          return withAlpha(tone.accent, paperTheme ? 0.76 : 0.55);
        }}
        pointResolution={12}
        pointsMerge={false}
        pointsTransitionDuration={0}
        pointLabel={() => ""}
        onPointClick={handlePointClick}
        onPointHover={handlePointHover}
        pathsData={pathsData}
        pathPoints={(path) => (path as RouteLayerData).points}
        pathPointLat={(point) => (point as GlobePoint).lat}
        pathPointLng={(point) => (point as GlobePoint).lon}
        pathPointAlt={0.006}
        pathResolution={0.7}
        pathColor={() =>
          ACCENT_PALETTE_DETAILS[accent][paperTheme ? "paper" : "dark"].strong
        }
        pathStroke={0.13}
        pathTransitionDuration={0}
        ringsData={ringData}
        ringLat={(point) => (point as GeoHeatBucket).lat}
        ringLng={(point) => (point as GeoHeatBucket).lon}
        ringAltitude={0.007}
        ringColor={() =>
          paperTheme
            ? [
                "rgba(8, 123, 91, 0.62)",
                "rgba(8, 123, 91, 0.22)",
                "rgba(8, 123, 91, 0)",
              ]
            : [
                "rgba(131, 243, 206, 0.7)",
                "rgba(73, 207, 163, 0.24)",
                "rgba(73, 207, 163, 0)",
              ]
        }
        ringMaxRadius={frameAltitude * (selectedLocation ? 4 : 2.4)}
        ringPropagationSpeed={frameAltitude * (selectedLocation ? 3.3 : 1.9)}
        ringRepeatPeriod={selectedLocation ? 820 : 1_500}
        ringResolution={selectedLocation ? 64 : 48}
        htmlElementsData={labelData}
        htmlLat={(point) => (point as GeoHeatBucket).lat}
        htmlLng={(point) => (point as GeoHeatBucket).lon}
        htmlAltitude={0.012}
        htmlElement={makeHtmlLabel}
        htmlElementVisibilityModifier={modifyHtmlLabelVisibility}
        htmlTransitionDuration={0}
        enablePointerInteraction
        pointerEventsFilter={pointerEventsFilter}
        showPointerCursor={(type) => type === "point"}
        onZoom={handleZoom}
      />
    </div>
  );
});

export const ActivityGlobeRenderer = memo(ActivityGlobeRendererComponent);
