// Usage: electron shoot.cjs <plan.json>
// plan: [{ out, view, theme, steps:[js | ms], wait, ls, format }]
// SHOT_DPR (default 2), SHOT_DIR, SHOT_ROUND=1 (rounded macOS corners, webp out), SHOT_ONLY
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
app.commandLine.appendSwitch("no-sandbox");
const FORCE = process.env.SHOT_MODE !== "emulate"; // native OSR scale + CDP viewport

app.setPath("userData", path.join(__dirname, "userdata"));
const W = Number(process.env.SHOT_W || 1512), H = Number(process.env.SHOT_H || 982);
const DPR = Number(process.env.SHOT_DPR || 2);
const ROUND = process.env.SHOT_ROUND === "1";
// SHOT_ONLY=05-ride,15-places shoots just those entries of the plan.
const only = (process.env.SHOT_ONLY || "").split(",").map((x) => x.trim()).filter(Boolean);
const plan = JSON.parse(fs.readFileSync(process.argv[process.argv.length - 1], "utf8"))
  .filter((shot) => only.length === 0 || only.includes(shot.out));
if (plan.length === 0) { console.error("No shot in the plan matches SHOT_ONLY=" + only.join(",")); process.exit(1); }
const outDir = process.env.SHOT_DIR || path.join(__dirname, "shots");
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ROUNDER = `async (src, dpr, dark, quality) => {
  const img = new Image();
  img.src = src;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext("2d");
  const r = 11 * dpr;
  const path = new Path2D();
  path.roundRect(0, 0, c.width, c.height, r);
  g.save(); g.clip(path); g.drawImage(img, 0, 0); g.restore();
  g.lineWidth = dpr;
  g.strokeStyle = dark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.18)";
  const edge = new Path2D();
  edge.roundRect(dpr / 2, dpr / 2, c.width - dpr, c.height - dpr, r - dpr / 2);
  g.stroke(edge);
  return c.toDataURL("image/webp", quality).split(",")[1];
}`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: W, height: H, useContentSize: true, show: false, frame: false, enableLargerThanScreen: true, backgroundColor: "#05080b",
    webPreferences: { backgroundThrottling: false, offscreen: FORCE ? { deviceScaleFactor: DPR } : true } });
  const proc = ROUND ? new BrowserWindow({ width: 200, height: 200, show: false, webPreferences: { offscreen: true } }) : null;
  if (proc) await proc.loadURL("about:blank");
  const dbg = win.webContents.debugger;
  await win.loadURL("data:text/html,<body style=background:%23000></body>");
  dbg.attach("1.3");
  await dbg.sendCommand("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: DPR, mobile: false });
  win.webContents.on("console-message", (e) => {
    const m = e.message ?? ""; const lvl = e.level;
    if (lvl === "error" || /\[demo\] renderer error/.test(m)) console.log(`[${lvl}]`, m.slice(0, 300));
  });
  for (const shot of plan) {
    const q = new URLSearchParams({ view: shot.view ?? "overview", theme: shot.theme ?? "dark", ...(shot.ls ? { ls: JSON.stringify(shot.ls) } : {}) });
    await win.loadFile(path.join(__dirname, "dist", "index.html"), { search: q.toString() });
    await dbg.sendCommand("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: DPR, mobile: false });
    await sleep(shot.wait ?? 3000);
    for (const step of shot.steps ?? []) {
      if (typeof step === "number") { await sleep(step); continue; }
      try { const r = await win.webContents.executeJavaScript(step); if (r !== undefined && r !== true) console.log("step:", shot.out, JSON.stringify(r).slice(0, 200)); }
      catch (err) { console.log("step failed:", shot.out, String(err).slice(0, 300)); }
      await sleep(shot.stepWait ?? 900);
    }
    await sleep(shot.settle ?? 1200);
    const data = (await dbg.sendCommand("Page.captureScreenshot", { format: "png", captureBeyondViewport: false })).data;
    let file;
    if (ROUND) {
      const dark = (shot.theme ?? "dark") !== "paper";
      const webp = await proc.webContents.executeJavaScript(`(${ROUNDER})("data:image/png;base64,${data}", ${DPR}, ${dark}, ${shot.quality ?? 0.88})`);
      file = path.join(outDir, `${shot.out}.webp`);
      fs.writeFileSync(file, Buffer.from(webp, "base64"));
    } else {
      file = path.join(outDir, `${shot.out}.png`);
      fs.writeFileSync(file, Buffer.from(data, "base64"));
    }
    console.log("wrote", path.basename(file), Math.round(fs.statSync(file).size / 1024) + " KB");
  }
  app.quit();
});
setTimeout(() => { console.log("timeout"); app.exit(1); }, Number(process.env.SHOT_TIMEOUT || 900000));
