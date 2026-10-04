// Renders README.md the way GitHub does, into a preview page with review notes.
// node scripts/screenshots/build-preview.mjs  ->  .work/readme-preview/index.html
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { micromark } from "micromark";
import { gfm, gfmHtml } from "micromark-extension-gfm";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const out = path.join(repo, ".work", "readme-preview");
fs.mkdirSync(out, { recursive: true });

const md = fs.readFileSync(path.join(repo, "README.md"), "utf8");
let html = micromark(md, { allowDangerousHtml: true, extensions: [gfm()], htmlExtensions: [gfmHtml()] });

// GitHub alerts: > [!NOTE]
html = html.replace(/<blockquote>\s*<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/g, (_m, kind) =>
  `<blockquote class="gh-alert gh-alert-${kind.toLowerCase()}"><p class="gh-alert-title"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"></path></svg>${kind.charAt(0) + kind.slice(1).toLowerCase()}</p><p>`);

// Badges: the artifact cannot load images from shields.io, so embed what it serves today.
const badgeUrls = [...new Set([...html.matchAll(/src="(https:\/\/img\.shields\.io\/[^"]+)"/g)].map((m) => m[1]))];
for (const url of badgeUrls) {
  const res = await fetch(url.replace(/&amp;/g, "&"));
  const svg = await res.text();
  const data = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  html = html.split(`src="${url}"`).join(`src="${data}"`);
}

// Headings get GitHub's anchors.
const slug = (t) => t.toLowerCase().replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, "").replace(/[^\p{L}\p{N}\s-]/gu, "").trim().replace(/\s+/g, "-");
html = html.replace(/<h([23])>(.*?)<\/h\1>/g, (_m, level, text) => `<h${level} id="${slug(text)}">${text}</h${level}>`);

const SHOTS = [
  ["01", "Overview", "Màn hình Overview (hero đầu README)", "Overview"],
  ["02", "Activities", "Danh sách mọi buổi tập + panel chi tiết (trail run Hàm Lợn)", "Activities"],
  ["03", "Running", "Màn hình Running: tuần, load ratio, VO₂max, volume", "Running"],
  ["04", "Run page", "Trang 1 buổi chạy: 6 × 1 km intervals quanh Hồ Tây", "Running → buổi chạy"],
  ["05", "Ride page", "Trang 1 buổi đạp: Tam Đảo climb, panel Power", "Cycling → buổi đạp"],
  ["06", "Hike page", "Trang 1 buổi hike: Fansipan, Terrain", "Hiking → buổi hike"],
  ["07", "Strength", "Strength + bản đồ cơ 3D", "Strength"],
  ["08", "Sleep", "Sleep: giai đoạn ngủ, HRV & stress cả đêm", "Sleep"],
  ["09", "Calendar", "Calendar tháng: kế hoạch & đã tập", "Calendar"],
  ["10", "Training Library", "Plan reader: Hanoi Marathon · 12 weeks", "Training Library → Plans"],
  ["11", "Coach · chat", "Coach phân tích buổi interval, kèm biểu đồ", "Coach"],
  ["12", "Coach · plan", "Coach + Workbench: giáo án marathon", "Coach → Workbench"],
  ["13", "Twelve Labours", "Hall of Records: Twelve Labours", "Hall of Records"],
  ["14", "Timeline", "Hall of Records: timeline milestone", "Hall of Records"],
  ["15", "Where you've been", "Globe + chọn Hà Nội", "Where you've been"]
];

const shotList = SHOTS.map(([n, name, what, where]) => `
      <li>
        <a class="shot" href="#fig-${n}">
          <span class="shot-n">${Number(n)}</span>
          <img class="shot-thumb" data-light="docs/readme/${n}-${fileOf(n)}-light.webp" data-dark="docs/readme/${n}-${fileOf(n)}.webp" alt="" loading="lazy" />
          <span class="shot-text"><strong>${name}</strong><span>${what}</span><code>${where}</code></span>
        </a>
      </li>`).join("");

function fileOf(n) {
  return { "01": "overview", "02": "activities", "03": "running", "04": "run", "05": "ride", "06": "hike", "07": "strength", "08": "sleep", "09": "calendar", "10": "library", "11": "coach", "12": "coach-plan", "13": "labours", "14": "timeline", "15": "places" }[n];
}

const template = fs.readFileSync(path.join(here, "preview-template.html"), "utf8");
const page = template.replace("<!--README-->", html).replace("<!--SHOTS-->", shotList);
fs.writeFileSync(path.join(out, "index.html"), page);
console.log("preview written", Math.round(page.length / 1024) + " KB,", badgeUrls.length, "badges embedded");
