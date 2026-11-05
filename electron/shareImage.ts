import { BrowserWindow, screen, type NativeImage, type WebContents } from "electron";
import { ScreenError } from "./screenText";
import type { ShareImageRequest } from "./types";

/**
 * The share image is drawn by the renderer's own card, at the file's exact
 * size, in a window nobody sees, and captured from there. The page in the
 * dialog is a scaled preview of the same card; drawing the file from it would
 * mean drawing it at the preview's size.
 *
 * The window loads the app's page with `#share-render`, which mounts the card
 * and nothing else — never `App`, whose ready signal and storage publisher
 * belong to the main window. It asks for its payload, draws it, waits for the
 * map tiles, fonts and pictures, and says it is ready, or that it cannot. The
 * window is destroyed as soon as it is captured, so it never keeps the app
 * alive on the Mac. While it lives it is the newest window, which is the one
 * `BrowserWindow.getAllWindows()` lists first: code that sends to "any window"
 * skips offscreen ones (`coachAnalysisService`'s `emitToAnyWindow`).
 *
 * A window is never taller than the screen, offscreen or not (measured on
 * Linux: a 1080 × 1920 window came back 1080 × 1080, and the story was cut and
 * stretched). So the window is the file's size divided by a whole device scale
 * that makes it fit, and the page draws the card scaled down by the same: the
 * capture comes back in the file's own pixels, and nothing is resampled.
 */

export interface ShareRenderHost {
  preload: string;
  /** Loads the app's page into the window with the given hash. */
  load: (window: BrowserWindow, hash: string) => Promise<void>;
  isAppPageUrl: (url: string) => boolean;
}

export const SHARE_RENDER_HASH = "share-render";
/** A map whose tiles never arrive should fail the image, not hang the button. */
const RENDER_TIMEOUT_MS = 30_000;
/** One more frame after the card says it is ready, so the last paint is the captured one. */
const SETTLE_MS = 150;
const MAX_SIDE = 4096;
/** Whole scales that divide every format's sides, so the window is a whole number of pixels. */
const RENDER_SCALES = [1, 2, 3, 6] as const;
/** What a work area keeps clear of a window, for the panels around it. */
const SCREEN_MARGIN = 40;

/** The least device scale at which a window of `width` × `height` file pixels fits the screen. */
function renderScale(width: number, height: number): number {
  const area = screen.getPrimaryDisplay().workAreaSize;
  return (
    RENDER_SCALES.find(
      (scale) => width / scale <= area.width - SCREEN_MARGIN && height / scale <= area.height - SCREEN_MARGIN
    ) ?? RENDER_SCALES[RENDER_SCALES.length - 1]
  );
}

interface PendingRender {
  payload: unknown;
  ready: () => void;
  failed: () => void;
}

const pending = new Map<number, PendingRender>();

/** The payload of the share window asking for it; refused to any other page. */
export function sharePayloadFor(sender: WebContents): unknown {
  const render = pending.get(sender.id);
  if (!render) {
    throw new ScreenError("main.share.renderFailed");
  }
  return render.payload;
}

/** The share window's word that its card is drawn, or that it cannot be. */
export function markShareRendered(sender: WebContents, drawn: boolean): void {
  const render = pending.get(sender.id);
  if (drawn) render?.ready();
  else render?.failed();
}

/** Whether two images hold the same pixels: what the clipboard gives back against what was written. */
export function sameImage(a: NativeImage, b: NativeImage): boolean {
  const sizeA = a.getSize();
  const sizeB = b.getSize();
  return !a.isEmpty() && sizeA.width === sizeB.width && sizeA.height === sizeB.height && a.toBitmap().equals(b.toBitmap());
}

function validSide(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > MAX_SIDE) {
    throw new ScreenError("main.share.renderFailed");
  }
  return value;
}

export async function renderShareImage(request: ShareImageRequest, host: ShareRenderHost): Promise<NativeImage> {
  const width = validSide(request?.width);
  const height = validSide(request?.height);
  const scale = renderScale(width, height);
  const windowWidth = Math.ceil(width / scale);
  const windowHeight = Math.ceil(height / scale);
  const window = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    useContentSize: true,
    show: false,
    frame: false,
    enableLargerThanScreen: true,
    webPreferences: {
      preload: host.preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      offscreen: { deviceScaleFactor: scale }
    }
  });
  const contents = window.webContents;
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event, url) => {
    if (!host.isAppPageUrl(url)) event.preventDefault();
  });

  let timer: NodeJS.Timeout | undefined;
  try {
    const ready = new Promise<void>((resolve, reject) => {
      pending.set(contents.id, {
        payload: request.payload,
        ready: resolve,
        failed: () => reject(new ScreenError("main.share.renderFailed"))
      });
      timer = setTimeout(() => reject(new ScreenError("main.share.renderTimeout")), RENDER_TIMEOUT_MS);
      contents.once("render-process-gone", () => reject(new ScreenError("main.share.renderFailed")));
    });
    // A failure while the page still loads is read by the `await` below, not left unhandled.
    ready.catch(() => undefined);
    await host.load(window, SHARE_RENDER_HASH);
    await ready;
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    const image = await contents.capturePage({ x: 0, y: 0, width: windowWidth, height: windowHeight });
    if (image.isEmpty()) {
      throw new ScreenError("main.share.renderFailed");
    }
    const size = image.getSize();
    return size.width === width && size.height === height ? image : image.resize({ width, height, quality: "best" });
  } finally {
    clearTimeout(timer);
    pending.delete(contents.id);
    if (!window.isDestroyed()) {
      window.destroy();
    }
  }
}
