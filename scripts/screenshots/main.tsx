import { installDemoApi } from "./demoApi";

const params = new URLSearchParams(location.search);
try {
  const keep = params.get("keep") === "1";
  if (!keep) localStorage.clear();
  localStorage.setItem("coros-theme", params.get("theme") ?? "dark");
  localStorage.setItem("heraclesrecords.startupView", params.get("view") ?? "overview");
  const extra = params.get("ls");
  if (extra) for (const [k, v] of Object.entries(JSON.parse(extra) as Record<string, string>)) localStorage.setItem(k, v);
} catch {}
document.documentElement.dataset.demo = "1";
installDemoApi();
// Screenshots read the WebGL canvases back after they were drawn: keep the buffer.
const nativeGetContext = HTMLCanvasElement.prototype.getContext;
(HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext = function (this: HTMLCanvasElement, type: string, attrs?: Record<string, unknown>) {
  if (type === "webgl" || type === "webgl2" || type === "experimental-webgl") attrs = { ...(attrs ?? {}), preserveDrawingBuffer: true };
  return (nativeGetContext as (...a: unknown[]) => unknown).call(this, type, attrs);
};
const style = document.createElement("style");
style.textContent = `::-webkit-scrollbar { width: 0 !important; height: 0 !important; } .demo-traffic { position: fixed; top: 18px; left: 18px; display: flex; gap: 8px; z-index: 2147483647; pointer-events: none; } .demo-traffic i { width: 12px; height: 12px; border-radius: 50%; display: block; box-shadow: inset 0 0 0 0.5px rgba(0,0,0,0.22); } `;
document.head.appendChild(style);
const lights = document.createElement("div");
lights.className = "demo-traffic";
lights.innerHTML = "<i style=\"background:#ff5f57\"></i><i style=\"background:#febc2e\"></i><i style=\"background:#28c840\"></i>";
document.body.appendChild(lights);
const w = window as unknown as Record<string, unknown>;
w.demoClick = (text: string, sel = "button, [role=button], [role=tab], [role=radio], a, li, tr, [tabindex]", nth = 0) => {
  const els = [...document.querySelectorAll<HTMLElement>(sel)].filter((e) => (e.textContent ?? "").includes(text) && e.offsetParent !== null);
  els.sort((a, b) => (a.textContent ?? "").length - (b.textContent ?? "").length);
  const el = els[nth];
  if (!el) return "not found: " + text;
  el.scrollIntoView({ block: "center" });
  el.click();
  return "clicked " + el.tagName + " " + (el.textContent ?? "").trim().slice(0, 50);
};
w.demoScroll = (sel: string, top: number) => {
  const el = document.querySelector<HTMLElement>(sel);
  if (!el) return "no " + sel;
  el.scrollTop = top;
  return [el.scrollTop, el.scrollHeight];
};
w.demoScrollables = () => [...document.querySelectorAll<HTMLElement>("*")].filter((e) => e.scrollHeight > e.clientHeight + 20 && /auto|scroll/.test(getComputedStyle(e).overflowY)).map((e) => (e.className || e.tagName).toString().slice(0, 60) + " " + e.scrollHeight + "/" + e.clientHeight);
// A clock the screenshot script can step, so an animation is recorded frame by frame.
{
  const nativeRaf = window.requestAnimationFrame.bind(window);
  const nativeCaf = window.cancelAnimationFrame.bind(window);
  let manual = false; let vnow = 0; let seq = 0;
  let queue: Array<[number, FrameRequestCallback]> = [];
  window.requestAnimationFrame = (cb: FrameRequestCallback) => { if (!manual) return nativeRaf(cb); const id = 1e9 + ++seq; queue.push([id, cb]); return id; };
  window.cancelAnimationFrame = (id: number) => { if (id > 1e9) queue = queue.filter((q) => q[0] !== id); else nativeCaf(id); };
  const cw = window as unknown as Record<string, unknown>;
  cw.demoClockStart = () => { manual = true; vnow = performance.now(); return true; };
  cw.demoClockStep = (ms: number) => { vnow += ms; const run = queue; queue = []; for (const [, cb] of run) cb(vnow); return true; };
  cw.demoClockStop = () => { manual = false; const run = queue; queue = []; for (const [, cb] of run) nativeRaf(cb); return true; };
}
void import("../../src/main");
