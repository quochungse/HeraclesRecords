// Usage: electron record.cjs  -> frames/NNN.png of the full map replaying a route
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
app.commandLine.appendSwitch("no-sandbox");
app.setPath("userData", path.join(__dirname, "userdata"));
const W = 1512, H = 982, DPR = Number(process.env.SHOT_DPR || 2);
const FPS = 25, REPLAY_MS = 4000, HIKE = process.env.HIKE || "Hàm Lợn loop";
const out = path.join(__dirname, "frames");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const P = "heraclesrecords.selection.v1.training.activityRoute.";
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: W, height: H, useContentSize: true, show: false, frame: false, enableLargerThanScreen: true,
    webPreferences: { backgroundThrottling: false, offscreen: { deviceScaleFactor: DPR } } });
  const dbg = win.webContents.debugger;
  await win.loadURL("data:text/html,<body style=background:%23000></body>");
  dbg.attach("1.3");
  const metrics = () => dbg.sendCommand("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: DPR, mobile: false });
  await metrics();
  const ls = { [P + "colorMode"]: '"performance"', [P + "metric"]: '"elevation"', [P + "baseLayer"]: '"satellite"' };
  const q = new URLSearchParams({ view: "hiking", theme: "dark", ls: JSON.stringify(ls) });
  await win.loadFile(path.join(__dirname, "dist", "index.html"), { search: q.toString() });
  await metrics();
  const js = (s) => win.webContents.executeJavaScript(s);
  await sleep(4000);
  console.log(await js(`demoClick(${JSON.stringify(HIKE)}, 'tr')`));
  await sleep(3500);
  await js("document.querySelector('[aria-label=\"Expand map\"]').click(), true");
  await sleep(10000); // tiles
  await js("demoClockStart()");
  await js("document.querySelector('.activity-route-modal [aria-label=\"Replay route\"]').click(), true");
  // move the pointer's hover off the button
  await js("document.activeElement && document.activeElement.blur(), true");
  const frames = Math.ceil((REPLAY_MS / 1000) * FPS) + 2;
  for (let i = 0; i <= frames; i++) {
    if (i > 0) await js(`demoClockStep(${1000 / FPS})`);
    await sleep(140);
    const data = (await dbg.sendCommand("Page.captureScreenshot", { format: "png" })).data;
    fs.writeFileSync(path.join(out, String(i).padStart(3, "0") + ".png"), Buffer.from(data, "base64"));
  }
  await js("demoClockStop()");
  console.log("frames", frames + 1);
  app.quit();
});
setTimeout(() => { console.log("timeout"); app.exit(1); }, 600000);
