// Renders the website's link-preview cards from og.html into site/public/og/,
// one JPEG per page. Run with `npm run site:og` (through run-electron-gui.mjs,
// which clears ELECTRON_RUN_AS_NODE) after a card's words or screenshot change;
// the output is committed, so a site build never needs Electron.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const outDir = path.join(root, "site", "public", "og");
const template = path.join(__dirname, "og.html");

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1200,
    height: 630,
    useContentSize: true,
    show: false,
    frame: false,
    webPreferences: { offscreen: { deviceScaleFactor: 1 }, backgroundThrottling: false },
  });
  fs.mkdirSync(outDir, { recursive: true });
  await win.loadFile(template);
  const pages = await win.webContents.executeJavaScript("window.OG_PAGES");
  for (const page of pages) {
    await win.loadFile(template, { search: `page=${page}` });
    await win.webContents.executeJavaScript(
      "Promise.all([document.fonts.ready, ...[...document.images].map((i) => i.decode())]).then(() => true)",
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1200, height: 630 });
    const file = path.join(outDir, `${page}.jpg`);
    fs.writeFileSync(file, image.resize({ width: 1200, height: 630 }).toJPEG(86));
    console.log(`wrote og/${page}.jpg ${Math.round(fs.statSync(file).size / 1024)} KB`);
  }
  app.quit();
});
setTimeout(() => {
  console.error("timeout");
  app.exit(1);
}, 120000);
