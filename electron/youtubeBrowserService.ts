import { app, session, type WebContents } from "electron";

export const YOUTUBE_PARTITION = "persist:heraclesrecords-youtube";

function buildChromeUserAgent(): string {
  const chromeVersion = process.versions.chrome;
  const platform =
    process.platform === "darwin"
      ? "Macintosh; Intel Mac OS X 10_15_7"
      : process.platform === "win32"
        ? "Windows NT 10.0; Win64; x64"
        : "X11; Linux x86_64";

  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
}

function isYouTubeWebContents(contents: WebContents): boolean {
  return contents.session === session.fromPartition(YOUTUBE_PARTITION);
}

export function configureYouTubeBrowserSession(): void {
  const youtubeSession = session.fromPartition(YOUTUBE_PARTITION);
  youtubeSession.setUserAgent(buildChromeUserAgent());

  youtubeSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(["media", "fullscreen", "pointerLock"].includes(permission));
  });
}

export function registerYouTubeBrowserHandlers(): void {
  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-prevent-unload", (event) => {
      event.preventDefault();
    });

    if (contents.getType() !== "webview" || !isYouTubeWebContents(contents)) {
      return;
    }

    contents.setUserAgent(buildChromeUserAgent());
  });
}

export async function resetYouTubeBrowserSession(): Promise<void> {
  const youtubeSession = session.fromPartition(YOUTUBE_PARTITION);
  await youtubeSession.clearCache();
  await youtubeSession.clearStorageData();
}
