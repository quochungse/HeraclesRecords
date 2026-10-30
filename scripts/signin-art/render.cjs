// Renders the sign-in screen's artwork from contours.html into
// src/assets/signin/contours.webp. Run with `npm run signin-art:generate`
// (through run-electron-gui.mjs, which clears ELECTRON_RUN_AS_NODE); the output
// is committed, so a build never needs Electron. The drawing is seeded: the
// same script draws the same massif.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const out = path.join(root, "src", "assets", "signin", "contours.webp");

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true, backgroundThrottling: false } });
  await win.loadFile(path.join(__dirname, "contours.html"));
  const data = await win.webContents.executeJavaScript("render()");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(data.split(",")[1], "base64"));
  console.log(`wrote ${path.relative(root, out)} (${Math.round(fs.statSync(out).size / 1024)} KB)`);
  app.quit();
});
