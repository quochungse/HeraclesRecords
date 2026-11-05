import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type DragEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import { createPortal } from "react-dom";
import { Check, Copy, Download, ImagePlus, Loader2, RotateCcw, X } from "lucide-react";
import { remoteErrorMessage } from "../chat/remoteError";
import { OptionChips, OptionGroup, type OptionGroupOption } from "../components/OptionGroup";
import { useI18n } from "../i18n/useI18n";
import { BASE_LAYERS } from "../mapBase/constants";
import { defineSelectionPreference, useSelectionPreference } from "../preferences/selectionPreferences";
import { showToast } from "../toast";
import type { RouteMetric } from "../training/components/routeColoring";
import { ConfirmDialog } from "../training-library/ConfirmDialog";
import { ShareCard } from "./ShareCard";
import { BrandPositionIcon, MapStyleThumb, ShareRange, ShareSection, ShareSwitch, Swatch } from "./ShareControls";
import {
  SHARE_BACKGROUNDS,
  SHARE_BRAND_POSITIONS,
  SHARE_FORMAT_ORDER,
  SHARE_FORMATS,
  SHARE_LAYOUTS,
  SHARE_MAP_STYLES,
  SHARE_MAX_STATS,
  SHARE_METRICS,
  SHARE_PLAIN_COLORS,
  distanceToPolyline,
  isStoredShareOptions,
  photoCover,
  plainBackground,
  rememberShareOptions,
  resolveShareOptions,
  shownBackground,
  shownRouteStyle,
  statText,
  type StoredShareOptions
} from "./shareModel";
import type {
  ShareBrandMark,
  ShareBrandPosition,
  ShareChartKind,
  ShareEdits,
  ShareFormat,
  ShareLayout,
  ShareMapStyle,
  ShareOptions,
  SharePayload,
  SharePlaced,
  ShareRouteMode,
  ShareSession
} from "./shareTypes";

const SHARE_OPTIONS_PREFERENCE = defineSelectionPreference<StoredShareOptions>({
  key: "share.options",
  defaultValue: {},
  validate: isStoredShareOptions
});

/** A photo is kept no larger than this on its long side: plenty for a 1440 px image, and light to send. */
const PHOTO_LONG_SIDE = 2400;
/** How near, in screen pixels, a press must land to the route or the muscle map to grab it rather than the photo. */
const GRAB_PX = 28;
const PREVIEW_MAX_HEIGHT = 720;
const CENTRED = { scale: 100, dx: 0, dy: 0 };

/** Reads a picture file, shrunk to `PHOTO_LONG_SIDE`, as a JPEG data URL the share window can draw. */
async function readPhoto(file: File): Promise<{ src: string; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const fit = Math.min(1, PHOTO_LONG_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * fit);
  const height = Math.round(bitmap.height * fit);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return { src: canvas.toDataURL("image/jpeg", 0.92), width, height };
}

/** Whether a press at `point` lands on what was placed, `reach` card pixels counted as near enough. */
function grabsPlaced(placed: SharePlaced, point: [number, number], reach: number): boolean {
  if (placed.kind === "line") {
    return distanceToPolyline(point, placed.points) <= reach;
  }
  const { x, y, w, h } = placed.rect;
  return point[0] >= x - reach && point[0] <= x + w + reach && point[1] >= y - reach && point[1] <= y + h + reach;
}

type DragTarget = "placed" | "photo";

interface ShareDialogProps {
  session: ShareSession;
  onClose: () => void;
}

export function ShareDialog({ session, onClose }: ShareDialogProps) {
  const { t } = useI18n();
  const api = window.heraclesRecords;
  const [stored, setStored] = useSelectionPreference(SHARE_OPTIONS_PREFERENCE);
  const [edits, setEdits] = useState<ShareEdits>({ name: session.name, placement: CENTRED });
  const hasPhoto = Boolean(edits.photo);
  const options = useMemo(() => resolveShareOptions(session, stored[session.sport], hasPhoto), [session, stored, hasPhoto]);
  // Anything changed since the dialog opened or the image was last copied or saved.
  const [changed, setChanged] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [busy, setBusy] = useState<"copy" | "save" | null>(null);
  const [copied, setCopied] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [stageWidth, setStageWidth] = useState(0);
  const [viewHeight, setViewHeight] = useState(() => window.innerHeight);
  const [hover, setHover] = useState<DragTarget | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const placedRef = useRef<SharePlaced | null>(null);
  const dragRef = useRef<{ target: DragTarget; x: number; y: number; dx: number; dy: number; frame: number } | null>(null);
  // Bumped by every change, so a Copy or Save marks the image unchanged only if nothing moved while it was drawn.
  const revisionRef = useRef(0);

  const format = SHARE_FORMATS[options.format];
  const background = shownBackground(options, session);
  const route = session.route;
  const payload: SharePayload = useMemo(() => ({ session, options, edits }), [session, options, edits]);

  const setOptions = useCallback(
    (patch: Partial<ShareOptions>) => {
      setStored((current) => rememberShareOptions(current, session.sport, patch));
      revisionRef.current += 1;
      setChanged(true);
    },
    [setStored, session.sport]
  );
  const edit = useCallback((update: (current: ShareEdits) => ShareEdits) => {
    setEdits(update);
    revisionRef.current += 1;
    setChanged(true);
  }, []);
  /** A move made for another size or layout means nothing there, so it starts from the middle again. */
  const recentre = () => edit((state) => ({ ...state, placement: { ...state.placement, dx: 0, dy: 0 } }));

  const requestClose = useCallback(() => {
    if (changed) setConfirmingClose(true);
    else onClose();
  }, [changed, onClose]);

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      // The close question answers its own Escape, and an open menu closes first.
      if (event.key !== "Escape" || confirmingClose || document.querySelector('[role="listbox"]')) return;
      event.preventDefault();
      event.stopPropagation();
      requestClose();
    };
    document.addEventListener("keydown", close, true);
    return () => document.removeEventListener("keydown", close, true);
  }, [requestClose, confirmingClose]);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(() => setStageWidth(stage.clientWidth));
    observer.observe(stage);
    setStageWidth(stage.clientWidth);
    const resize = () => setViewHeight(window.innerHeight);
    window.addEventListener("resize", resize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, []);

  const previewScale =
    stageWidth > 0
      ? Math.min((stageWidth - 40) / format.width, Math.min(PREVIEW_MAX_HEIGHT, viewHeight * 0.72) / format.height)
      : 0.3;

  const handlePlaced = useCallback((placed: SharePlaced | null) => {
    placedRef.current = placed;
  }, []);

  const cardPoint = (event: ReactPointerEvent<HTMLDivElement>): [number, number] => {
    const rect = event.currentTarget.getBoundingClientRect();
    return [(event.clientX - rect.left) / previewScale, (event.clientY - rect.top) / previewScale];
  };

  // The route and the muscle map come first: they sit over the photo, so a press on them means them.
  const grabTarget = (point: [number, number]): DragTarget | null => {
    const placed = placedRef.current;
    if (placed && grabsPlaced(placed, point, GRAB_PX / previewScale)) return "placed";
    return background === "photo" && edits.photo ? "photo" : null;
  };


  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = grabTarget(cardPoint(event));
    if (!target) return;
    // No text selection and no picture dragged out of the window: this press moves something.
    event.preventDefault();
    dragRef.current = { target, x: event.clientX, y: event.clientY, dx: 0, dy: 0, frame: 0 };
    setDragging(true);
    // A move picks up from where the thing is drawn, which a drag past the
    // edge may have stopped short of. Read here, where the card has drawn
    // since the last move, and not on release, where it may not have.
    const placed = placedRef.current;
    if (target === "placed" && placed) {
      setEdits((state) => ({ ...state, placement: { ...state.placement, dx: placed.dx, dy: placed.dy } }));
    }
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // A pointer that is already gone has nothing to capture.
    }
  };
  /** The moves since the last frame, applied at once: a pointer reports far more often than the card can draw. */
  const applyMove = (drag: NonNullable<typeof dragRef.current>) => {
    const { dx, dy } = drag;
    drag.dx = 0;
    drag.dy = 0;
    drag.frame = 0;
    if (dx === 0 && dy === 0) return;
    edit((state) => {
      if (drag.target === "placed") {
        return { ...state, placement: { ...state.placement, dx: state.placement.dx + dx, dy: state.placement.dy + dy } };
      }
      if (!state.photo) return state;
      const moved = { ...state.photo, panX: state.photo.panX + dx, panY: state.photo.panY + dy };
      const { panX, panY } = photoCover(moved, format.width, format.height);
      return { ...state, photo: { ...moved, panX, panY } };
    });
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) {
      setHover(grabTarget(cardPoint(event)));
      return;
    }
    drag.dx += (event.clientX - drag.x) / previewScale;
    drag.dy += (event.clientY - drag.y) / previewScale;
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (!drag.frame) drag.frame = requestAnimationFrame(() => applyMove(drag));
  };
  const endDrag = () => {
    const drag = dragRef.current;
    if (drag) {
      if (drag.frame) cancelAnimationFrame(drag.frame);
      applyMove(drag);
    }
    dragRef.current = null;
    setDragging(false);
  };

  const takePhoto = async (file: File | undefined) => {
    if (!file) return;
    try {
      const photo = await readPhoto(file);
      edit((state) => ({ ...state, photo: { ...photo, zoom: 1, panX: 0, panY: 0, darken: state.photo?.darken ?? 30 } }));
      setOptions({ background: "photo" });
    } catch {
      showToast(t("share.photo.unreadable"), "error");
    }
  };

  const request = () => ({ width: format.width, height: format.height, payload });
  /** After a Copy or Save: unchanged, unless something changed while the image was drawn. */
  const markKept = (revision: number) => {
    if (revisionRef.current === revision) setChanged(false);
  };
  const copy = async () => {
    if (!api || busy) return;
    setBusy("copy");
    const revision = revisionRef.current;
    try {
      await api.copyShareImage(request());
      markKept(revision);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
      showToast(t("share.copied"), "info", { icon: Check });
    } catch (caught) {
      showToast(remoteErrorMessage(caught, t("share.failed")), "error");
    } finally {
      setBusy(null);
    }
  };
  const save = async () => {
    if (!api || busy) return;
    setBusy("save");
    const revision = revisionRef.current;
    try {
      const result = await api.saveShareImage(request(), session.fileName);
      if (result.saved && result.filePath) {
        markKept(revision);
        showToast(t("share.saved", { path: result.filePath }), "info", { icon: Check });
      }
    } catch (caught) {
      showToast(remoteErrorMessage(caught, t("share.failed")), "error");
    } finally {
      setBusy(null);
    }
  };

  const heroId = options.heroId;
  const gridCount = options.statIds.filter((id) => id !== heroId).length;
  const statOptions: OptionGroupOption<string>[] = session.stats.map((stat) => ({
    value: stat.id,
    label: stat.label,
    detail: statText(stat),
    disabled: stat.id === heroId || (!options.statIds.includes(stat.id) && gridCount >= SHARE_MAX_STATS)
  }));
  const metricLabel = (metric: RouteMetric) =>
    metric === "pace"
      ? t(route?.speed ? "activity.m.speed" : "activity.m.pace")
      : metric === "hr"
        ? t("activity.m.heartRate")
        : t("activity.m.elevation");
  const plainOptions: OptionGroupOption<string>[] = [
    { value: "sport", label: t("share.color.sport"), icon: <Swatch color={session.color} /> },
    ...SHARE_PLAIN_COLORS.map((entry) => ({
      value: entry.color,
      label: t(`share.color.${entry.id}` as const),
      icon: <Swatch color={entry.color} />
    }))
  ];
  const plainIsPreset = options.plainColor === "sport" || SHARE_PLAIN_COLORS.some((entry) => entry.color === options.plainColor);

  const routeMovable = Boolean(route) && options.routeShown && background !== "map";
  const routeStyle = route ? shownRouteStyle(options, route) : null;
  const bodyShown = !route && Boolean(session.strength) && options.graphicBody;
  const moved = edits.placement.scale !== 100 || edits.placement.dx !== 0 || edits.placement.dy !== 0;
  const hints = [
    routeMovable ? t("share.drag.route") : null,
    bodyShown ? t("share.drag.figure") : null,
    background === "photo" && edits.photo ? t("share.drag.photo") : null
  ].filter(Boolean);
  const cursor = dragging ? "grabbing" : hover === "placed" ? "move" : hover === "photo" ? "grab" : undefined;

  const placementControls = (
    <div className="share-placement">
      <ShareRange
        id="share-placement-size"
        label={t("share.route.size")}
        value={edits.placement.scale}
        min={30}
        max={160}
        onChange={(scale) => edit((state) => ({ ...state, placement: { ...state.placement, scale } }))}
      />
      <button type="button" className="share-reset" disabled={!moved} onClick={() => edit((state) => ({ ...state, placement: CENTRED }))}>
        <RotateCcw size={13} aria-hidden="true" />
        {t("share.place.reset")}
      </button>
    </div>
  );

  return createPortal(
    <div
      className="app-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <section className="panel app-modal share-dialog" role="dialog" aria-modal="true" aria-labelledby="share-dialog-title">
        <header className="app-modal-header">
          <div className="app-modal-title">
            <h2 id="share-dialog-title">{t("share.title")}</h2>
            <span className="share-dialog-subtitle">{edits.name.trim() || session.name}</span>
          </div>
          <button type="button" className="icon-button" aria-label={t("common.close")} onClick={requestClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="share-dialog-body">
          <div
            ref={stageRef}
            className="share-stage"
            onDragStart={(event: DragEvent) => event.preventDefault()}
            onDragOver={(event: DragEvent) => {
              if (Array.from(event.dataTransfer.types).includes("Files")) {
                event.preventDefault();
                setDropping(true);
              }
            }}
            onDragLeave={(event: DragEvent) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false);
            }}
            onDrop={(event: DragEvent) => {
              event.preventDefault();
              setDropping(false);
              void takePhoto(event.dataTransfer.files[0]);
            }}
          >
            <div
              className="share-preview"
              style={{ width: format.width * previewScale, height: format.height * previewScale, cursor } as CSSProperties}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onPointerLeave={() => {
                if (!dragRef.current) setHover(null);
              }}
            >
              <div className="share-preview-card" style={{ transform: `scale(${previewScale})` }}>
                <ShareCard payload={payload} onPlaced={handlePlaced} />
              </div>
            </div>
            <p className="share-stage-foot">
              <b>{t("share.size", { width: format.width, height: format.height })}</b>
              {hints.map((hint) => (
                <span key={hint}>{hint}</span>
              ))}
            </p>
            {dropping ? <div className="share-drop">{t("share.photo.dropHere")}</div> : null}
          </div>

          <div className="share-controls">
            <ShareSection title={t("share.section.format")}>
              <OptionGroup<ShareFormat>
                label={t("share.section.format")}
                value={options.format}
                fill
                onChange={(next) => {
                  recentre();
                  setOptions({ format: next });
                }}
                options={SHARE_FORMAT_ORDER.map((id) => ({
                  value: id,
                  label: SHARE_FORMATS[id].ratio,
                  title: t(`share.format.${id}` as const)
                }))}
              />
            </ShareSection>

            <ShareSection title={t("share.section.style")}>
              <OptionGroup<ShareLayout>
                label={t("share.section.style")}
                value={options.layout}
                fill
                onChange={(layout) => {
                  recentre();
                  setOptions({ layout });
                }}
                options={SHARE_LAYOUTS.map((id) => ({ value: id, label: t(`share.layout.${id}` as const) }))}
              />
            </ShareSection>

            <ShareSection title={t("share.section.background")}>
              {/* Each ground is a picture of what it gives: the map style chosen, the photo, the colour. */}
              <div className="share-bg-tiles" role="group" aria-label={t("share.section.background")}>
                {SHARE_BACKGROUNDS.map((ground) => {
                  const noMap = ground === "map" && !route;
                  return (
                    <button
                      type="button"
                      key={ground}
                      className="share-bg-tile"
                      aria-pressed={background === ground}
                      disabled={noMap}
                      title={noMap ? t("share.background.noMap") : undefined}
                      onClick={() => {
                        if (ground === "photo" && !edits.photo) {
                          fileRef.current?.click();
                          return;
                        }
                        setOptions({ background: ground });
                      }}
                    >
                      <span className="share-bg-picture" style={ground === "plain" ? { background: plainBackground(options, session) } : undefined}>
                        {ground === "map" ? <MapStyleThumb style={options.mapStyle} /> : null}
                        {ground === "photo" && edits.photo ? <img className="share-bg-fill" src={edits.photo.src} alt="" draggable={false} /> : null}
                        {ground === "photo" && !edits.photo ? <ImagePlus size={18} aria-hidden="true" /> : null}
                      </span>
                      {t(`share.background.${ground}` as const)}
                    </button>
                  );
                })}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  void takePhoto(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
              {background === "map" ? (
                <div className="share-subsection">
                  <p className="share-subsection-label" aria-hidden="true">
                    {t("share.mapStyle")}
                  </p>
                  <OptionGroup<ShareMapStyle>
                    label={t("share.mapStyle")}
                    value={options.mapStyle}
                    fill
                    tone="quiet"
                    onChange={(mapStyle) => setOptions({ mapStyle })}
                    options={SHARE_MAP_STYLES.map((id) => ({ value: id, label: BASE_LAYERS[id].label }))}
                  />
                </div>
              ) : null}
              {background === "photo" && edits.photo ? (
                <div className="share-subsection">
                  <button type="button" className="secondary-button share-photo-button" onClick={() => fileRef.current?.click()}>
                    <ImagePlus size={15} aria-hidden="true" />
                    {t("share.photo.choose")}
                  </button>
                  <ShareRange
                    id="share-photo-zoom"
                    label={t("share.photo.zoom")}
                    value={Math.round(edits.photo.zoom * 100)}
                    min={100}
                    max={250}
                    onChange={(value) =>
                      edit((state) => {
                        if (!state.photo) return state;
                        const zoomed = { ...state.photo, zoom: value / 100 };
                        const { panX, panY } = photoCover(zoomed, format.width, format.height);
                        return { ...state, photo: { ...zoomed, panX, panY } };
                      })
                    }
                  />
                  <ShareRange
                    id="share-photo-darken"
                    label={t("share.photo.darken")}
                    value={edits.photo.darken}
                    min={0}
                    max={80}
                    onChange={(value) => edit((state) => (state.photo ? { ...state, photo: { ...state.photo, darken: value } } : state))}
                  />
                  <p className="share-note">{t("share.photo.note")}</p>
                </div>
              ) : null}
              {background === "plain" ? (
                <div className="share-subsection">
                  <p className="share-subsection-label" aria-hidden="true">
                    {t("share.plain.color")}
                  </p>
                  <div className="share-colors">
                    <OptionGroup<string>
                      label={t("share.plain.color")}
                      value={plainIsPreset ? options.plainColor : ""}
                      iconOnly
                      onChange={(plainColor) => setOptions({ plainColor })}
                      options={plainOptions}
                    />
                    <label className="share-color-pick" htmlFor="share-plain-any">
                      <input
                        id="share-plain-any"
                        type="color"
                        value={options.plainColor === "sport" ? session.color : options.plainColor}
                        onChange={(event) => setOptions({ plainColor: event.target.value.toLowerCase() })}
                      />
                      {t("share.plain.any")}
                    </label>
                  </div>
                  <ShareSwitch
                    id="share-plain-gradient"
                    label={t("share.plain.gradient")}
                    hint={t("share.plain.gradientHint")}
                    checked={options.plainGradient}
                    onChange={(plainGradient) => setOptions({ plainGradient })}
                  />
                </div>
              ) : null}
            </ShareSection>

            {route ? (
              <ShareSection title={t("share.section.route")}>
                <ShareSwitch id="share-route-shown" label={t("share.route.show")} checked={options.routeShown} onChange={(routeShown) => setOptions({ routeShown })} />
                <OptionGroup<ShareRouteMode>
                  label={t("share.route.style")}
                  value={routeStyle?.mode ?? options.routeMode}
                  fill
                  disabled={!options.routeShown}
                  onChange={(routeMode) => setOptions({ routeMode })}
                  options={[
                    { value: "neon", label: t("share.route.neon") },
                    { value: "solid", label: t("share.route.solid") },
                    {
                      value: "performance",
                      label: t("share.route.performance"),
                      disabled: SHARE_METRICS.every((metric) => route.performance[metric].kind === "none")
                    }
                  ]}
                />
                {routeStyle?.mode === "performance" ? (
                  <div className="share-subsection">
                    <p className="share-subsection-label" aria-hidden="true">
                      {t("share.route.metric")}
                    </p>
                    <OptionGroup<RouteMetric>
                      label={t("share.route.metric")}
                      value={routeStyle.metric ?? options.metric}
                      fill
                      tone="quiet"
                      disabled={!options.routeShown}
                      onChange={(metric) => setOptions({ metric })}
                      options={SHARE_METRICS.map((metric) => {
                        const view = route.performance[metric];
                        return {
                          value: metric,
                          label: metricLabel(metric),
                          disabled: view.kind === "none",
                          ...(view.kind === "none" ? { title: view.reason } : {})
                        };
                      })}
                    />
                  </div>
                ) : null}
                <ShareSwitch
                  id="share-route-privacy"
                  label={t("share.route.privacy")}
                  hint={t("share.route.privacyHint")}
                  checked={options.privacy}
                  disabled={!options.routeShown}
                  onChange={(privacy) => setOptions({ privacy })}
                />
                {routeMovable ? placementControls : null}
              </ShareSection>
            ) : null}

            {!route && (session.strength || session.swim) ? (
              <ShareSection title={t("share.section.graphic")}>
                {session.strength ? (
                  <>
                    <ShareSwitch id="share-graphic-body" label={t("share.graphic.body")} checked={options.graphicBody} onChange={(graphicBody) => setOptions({ graphicBody })} />
                    {bodyShown ? placementControls : null}
                    <ShareSwitch id="share-graphic-sets" label={t("share.graphic.sets")} checked={options.graphicSets} onChange={(graphicSets) => setOptions({ graphicSets })} />
                  </>
                ) : (
                  <ShareSwitch
                    id="share-graphic-lengths"
                    label={t("share.graphic.lengths")}
                    hint={t("share.graphic.lengthsHint")}
                    checked={options.graphicLengths}
                    onChange={(graphicLengths) => setOptions({ graphicLengths })}
                  />
                )}
              </ShareSection>
            ) : null}

            <ShareSection title={t("share.section.figures")} aside={t("share.figures.count", { count: gridCount, max: SHARE_MAX_STATS })}>
              <div className="share-field">
                <span>{t("share.figures.hero")}</span>
                <OptionGroup<string>
                  label={t("share.figures.hero")}
                  mode="dropdown"
                  value={heroId}
                  onChange={(next) => setOptions({ heroId: next, statIds: options.statIds.filter((id) => id !== next) })}
                  options={[
                    { value: "", label: t("share.figures.none") },
                    ...session.stats.map((stat) => ({ value: stat.id, label: stat.label, detail: statText(stat) }))
                  ]}
                />
              </div>
              <OptionChips<string>
                label={t("share.figures.list")}
                values={heroId ? [...options.statIds, heroId] : options.statIds}
                onToggle={(id) =>
                  setOptions({
                    statIds: options.statIds.includes(id) ? options.statIds.filter((entry) => entry !== id) : [...options.statIds, id]
                  })
                }
                options={statOptions}
              />
            </ShareSection>

            {session.charts.length > 0 ? (
              <ShareSection title={t("share.section.chart")}>
                <ShareSwitch id="share-chart-shown" label={t("share.chart.show")} checked={options.chartShown} onChange={(chartShown) => setOptions({ chartShown })} />
                <OptionGroup<ShareChartKind>
                  label={t("share.section.chart")}
                  value={options.chartKind}
                  fill
                  disabled={!options.chartShown}
                  onChange={(chartKind) => setOptions({ chartKind })}
                  options={session.charts.map((chart) => ({ value: chart.kind, label: chart.title }))}
                />
              </ShareSection>
            ) : null}

            <ShareSection title={t("share.section.words")}>
              <ShareSwitch id="share-words-name" label={t("share.words.name")} checked={options.showName} onChange={(showName) => setOptions({ showName })} />
              <input
                className="share-name-input"
                type="text"
                value={edits.name}
                maxLength={80}
                disabled={!options.showName}
                aria-label={t("share.words.name")}
                onChange={(event) => {
                  const name = event.target.value;
                  edit((state) => ({ ...state, name }));
                }}
              />
              <ShareSwitch id="share-words-kind" label={t("share.words.kind")} hint={session.kind} checked={options.showKind} onChange={(showKind) => setOptions({ showKind })} />
              <ShareSwitch id="share-words-date" label={t("share.words.date")} hint={session.date} checked={options.showDate} onChange={(showDate) => setOptions({ showDate })} />
              <ShareSwitch
                id="share-words-place"
                label={t("share.words.place")}
                hint={session.place ?? t("share.words.noPlace")}
                checked={options.showPlace}
                disabled={!session.place}
                onChange={(showPlace) => setOptions({ showPlace })}
              />
              {session.trainingLabel ? (
                <ShareSwitch
                  id="share-words-label"
                  label={t("share.words.label")}
                  hint={session.trainingLabel.name}
                  checked={options.showLabel}
                  onChange={(showLabel) => setOptions({ showLabel })}
                />
              ) : null}
            </ShareSection>

            <ShareSection title={t("share.section.achievements")}>
              <ShareSwitch
                id="share-achievement-record"
                label={t("share.achievements.record")}
                hint={session.record ?? t("share.achievements.noRecord")}
                checked={options.showRecord}
                disabled={!session.record}
                onChange={(showRecord) => setOptions({ showRecord })}
              />
              <ShareSwitch
                id="share-achievement-labour"
                label={t("share.achievements.labour")}
                hint={session.labour ? `${session.labour.name} · ${session.labour.goal}` : t("share.achievements.noLabour")}
                checked={options.showLabour}
                disabled={!session.labour}
                onChange={(showLabour) => setOptions({ showLabour })}
              />
            </ShareSection>

            <ShareSection title={t("share.section.logo")}>
              <OptionGroup<ShareBrandPosition>
                label={t("share.logo.position")}
                value={options.brandPosition}
                iconOnly
                fill
                onChange={(brandPosition) => setOptions({ brandPosition })}
                options={SHARE_BRAND_POSITIONS.map((position) => ({
                  value: position,
                  label: t(`share.logo.${position}` as const),
                  icon: <BrandPositionIcon position={position} />
                }))}
              />
              <OptionGroup<ShareBrandMark>
                label={t("share.logo.mark")}
                value={options.brandMark}
                fill
                onChange={(brandMark) => setOptions({ brandMark })}
                options={[
                  { value: "gold", label: t("share.logo.gold") },
                  { value: "mono", label: t("share.logo.mono") }
                ]}
              />
              <p className="share-note">{t("share.logo.note")}</p>
            </ShareSection>
          </div>
        </div>

        <footer className="app-modal-footer share-footer">
          <p className="share-note">{t("share.footNote")}</p>
          <button type="button" className="secondary-button" disabled={!api || busy !== null} onClick={() => void save()}>
            {busy === "save" ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}
            {t("share.save")}
          </button>
          <button type="button" className="primary-button" disabled={!api || busy !== null} onClick={() => void copy()}>
            {busy === "copy" ? (
              <Loader2 size={15} className="spin" aria-hidden="true" />
            ) : copied ? (
              <Check size={15} aria-hidden="true" />
            ) : (
              <Copy size={15} aria-hidden="true" />
            )}
            {t("share.copy")}
          </button>
        </footer>
      </section>
      {confirmingClose ? (
        <ConfirmDialog
          title={t("share.discard.title")}
          description={t("share.discard.body")}
          confirmLabel={t("share.discard.confirm")}
          cancelLabel={t("share.discard.keep")}
          danger
          onConfirm={onClose}
          onCancel={() => setConfirmingClose(false)}
        />
      ) : null}
    </div>,
    document.body
  );
}
