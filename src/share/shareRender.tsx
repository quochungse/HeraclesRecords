import ReactDOM from "react-dom/client";
import { ShareCard } from "./ShareCard";
import { SHARE_FORMATS } from "./shareModel";
import type { SharePayload } from "./shareTypes";

/**
 * The page of the window that draws a share image's file (`#share-render`,
 * see `electron/shareImage.ts`): the card at its full size and nothing else.
 * It never mounts `App`, whose ready signal and storage publisher belong to
 * the main window. The window is the file's size divided by its device scale,
 * so the card is drawn scaled down by the same and comes out in full pixels.
 *
 * Anything that goes wrong here is said at once, so the button fails now
 * rather than after the wait meant for a map that is slow to load.
 */
export function mountShareRender(root: HTMLElement): void {
  document.documentElement.classList.add("share-render-page");
  const api = window.heraclesRecords;
  if (!api) return;
  const fail = () => void api.notifyShareRendered(false);
  api
    .getShareRenderPayload()
    .then((value) => {
      const payload = value as SharePayload;
      const format = SHARE_FORMATS[payload.options.format];
      // The photo travels as a data URL; nothing else is drawn from the payload's own address.
      if (!format || (payload.edits.photo && !payload.edits.photo.src.startsWith("data:image/"))) {
        fail();
        return;
      }
      ReactDOM.createRoot(root, { onUncaughtError: fail }).render(
        <div style={{ transform: `scale(${window.innerWidth / format.width})`, transformOrigin: "0 0" }}>
          <ShareCard payload={payload} onReady={() => void api.notifyShareRendered(true)} />
        </div>
      );
    })
    .catch(fail);
}
