# Website: work process và nội dung

Bản kế hoạch, 2026-10-04. Các quyết định đã chốt ở mục 8.

## 1. Hiện trạng

- `heraclesrecords.github.io` đang phục vụ từ repo `heraclesrecords/heraclesrecords.github.io`, ba file viết tay: `index.html`, `privacy.html`, `icon.png`.
- `index.html` đã lỗi thời: meta description vẫn nói "music for the watch", tính năng đã bỏ ngày 2026-10-02.
- **`/privacy.html` là URL mà Google OAuth consent screen trỏ tới.** Nó phải tiếp tục trả 200 ở đúng đường dẫn đó, nếu không Drive sync có thể bị Google gắn cờ.
- Trong app, `WEBSITE_URL` nằm ở [SettingsView.tsx:69](../src/settings/SettingsView.tsx) (Settings → About → Website). README cũng link tới site.
- README có khối tải về **ghim cứng** vào v1.0.0: 4 badge, bảng 4 dòng kèm dung lượng, dòng "Version 1.0.0". Commit `e08584e` là ví dụ phải sửa tay khi build lại.
- Ảnh chụp màn hình nằm ở `docs/readme/01..18.webp` (chỉ dark). Harness chụp ảnh ở `.work/readme-demo/` và đang bị git-ignore.

## 2. Ràng buộc kỹ thuật quyết định kiến trúc

**Site gốc của organization (`<org>.github.io`) chỉ có thể được phục vụ từ repo tên `heraclesrecords.github.io` trong org đó.** Bật Pages trên `quochungse/HeraclesRecords` sẽ ra `quochungse.github.io/HeraclesRecords/`, không phải domain mong muốn. Đổi tên repo app hoặc chuyển nó sang org thì làm gãy `build.publish` và các URL tải về tự dựng trong `updaterService.ts`.

Vì vậy: **viết và build site trong repo này, còn repo của org chỉ là đích deploy.** Một GitHub Action trong repo này push bản build sang repo org. Không ai sửa tay repo org nữa. Từ góc nhìn của bạn, mọi thứ diễn ra trong repo này.

`GITHUB_TOKEN` không push được sang repo khác, nên cần một **deploy key** (SSH, chỉ có quyền ghi vào đúng một repo, an toàn hơn PAT):

1. `ssh-keygen -t ed25519 -C "site-deploy" -f site_deploy -N ""`
2. `heraclesrecords/heraclesrecords.github.io` → Settings → Deploy keys → thêm `site_deploy.pub`, tick **Allow write access**.
3. `quochungse/HeraclesRecords` → Settings → Secrets → Actions → `SITE_DEPLOY_KEY` = nội dung `site_deploy` (private key). Sau đó xoá file key trên máy.
4. Repo org → Settings → Pages → Source: *Deploy from a branch*, branch `main`, `/ (root)`.

Bước này bạn tự làm (key và secret không đi qua tôi).

## 3. Cấu trúc trong repo

```
site/                       ← Astro project riêng, package.json + lockfile riêng
  astro.config.mjs
  package.json
  src/
    pages/                  ← index, download, features/*, labours, coach, changelog/*, guide/*, privacy, 404
    content/
      guide/*.md            ← hướng dẫn, FAQ (Markdown)
    components/
    styles/                 ← token màu/typography lấy theo app
  public/                   ← file tĩnh (favicon, sau này là CNAME)
scripts/
  lib/release-data.mjs      ← đọc release mới nhất (version, ngày, file, size, sha256) và sinh khối README
  update-readme-release.mjs ← viết lại khối giữa <!-- release:start --> và <!-- release:end --> trong README
.github/workflows/
  site.yml                  ← build + deploy; chạy khi push vào site/**, docs/readme/**, CHANGELOG.md; workflow_call; workflow_dispatch
  release.yml               ← thêm 2 job cuối: readme, site
```

**Astro (đề xuất)** thay vì HTML viết tay: nhiều trang dùng chung layout, Markdown cho guide/changelog, tối ưu ảnh, i18n khi cần tiếng Việt, xuất HTML tĩnh thuần, không có JS mặc định. Phương án thay thế là HTML tay + một script Node nhỏ, chỉ hợp lý nếu site dừng ở 2-3 trang.

Vì sao `site/` có **package.json riêng**, không thêm dependency vào app:
- `scripts/collect-licenses.mjs` đọc mọi package non-dev trong `package-lock.json` gốc để viết `THIRD_PARTY_LICENSES.txt` đi kèm installer. Dependency của site lọt vào đó là sai.
- `npm ci` của ba job build installer không phải tải Astro.

**Một nguồn sự thật, không chép lại:**

| Thứ | Nguồn | Site đọc bằng cách |
|---|---|---|
| Version, file tải, size, sha256 | GitHub Release mới nhất (API `releases/latest`) | `scripts/lib/release-data.mjs` lúc build |
| Release notes | `CHANGELOG.md` | cùng parser với `scripts/release-notes.mjs` |
| Ảnh chụp màn hình | `docs/readme/*.webp` | import thẳng, README cũng dùng chính file này |
| 12 Labours: tên, mô tả, mốc | `src/records/labours.ts` (không có import nào, node-free) | import thẳng |
| Emblem vàng | `src/assets/labours/*.webp` | import thẳng |
| Font | `src/assets/fonts/*.woff2` (Inter, Space Grotesk, Source Serif 4, có tiếng Việt) | import thẳng |
| Icon | `build/icon.png` | import thẳng |

Quy tắc đặt tên file tải về (`HeraclesRecords-${version}-${arch}.${ext}`…) đã bị `test:release-artifacts` giữ chặt cùng `updaterService.ts`. Script sinh link cho README và site phải đọc tên file thật từ release, không tự dựng lại từ pattern.

`/privacy.html`: đặt `build.format: "file"` trong Astro để `src/pages/privacy.astro` ra đúng `privacy.html`. Một test nhỏ (`test:site`) kiểm tra `site/dist/privacy.html` tồn tại sau build.

## 4. Quy trình mỗi lần release

```
feature PR ──► main ──► (site.yml tự deploy nếu đụng site/**)
                │
 npm run release:prepare -- v1.1.0
 git push origin v1.1.0
                │
 release.yml:  preflight → mac / linux / windows → release (GitHub Release)
                                                      │
                                         ┌────────────┴────────────┐
                                     job readme                job site (needs: readme)
                       update-readme-release.mjs        uses: ./.github/workflows/site.yml
                       commit "README: v1.1.0" vào main  build với release-data mới
                                                         push dist sang repo org
```

Các điểm phải đúng:

1. **Dung lượng chỉ biết sau khi build xong**, nên README chỉ cập nhật được sau job `release`. Job `readme` lấy size và sha512 từ chính artifact vừa tải về (hoặc từ API), sinh lại khối giữa hai marker, commit bằng `github-actions[bot]` lên `main`.
2. **Sự kiện do `GITHUB_TOKEN` tạo ra không kích hoạt workflow khác.** Release do `softprops/action-gh-release` tạo bằng `GITHUB_TOKEN`, nên một workflow `on: release` sẽ không bao giờ chạy; commit README của bot cũng không kích hoạt `site.yml`. Vì vậy `release.yml` phải **gọi trực tiếp** `site.yml` (`workflow_call`), không trông vào trigger.
3. Deploy giữa hai lần release (sửa copy, thêm guide) chỉ hiển thị **release đã publish**: `lib/release-data.mjs` đọc release mới nhất từ GitHub, không đọc `package.json`, và bỏ qua mục `[Unreleased]` của CHANGELOG. Bỏ qua cả pre-release.
4. Nếu sau này bật branch protection cho `main`, job `readme` đổi sang mở PR thay vì push thẳng.
5. Thêm vào lời nhắc của `release:prepare`: CHANGELOG đã có mục version chưa, ảnh chụp có cần chụp lại không, có trang tính năng nào cần thêm không.

Quy ước khi làm tính năng (đưa vào CLAUDE.md):
- Tính năng người dùng nhìn thấy: cùng commit sửa `CHANGELOG.md [Unreleased]`, và trang tính năng tương ứng trong `site/` nếu có.
- UI thay đổi rõ: chụp lại ảnh liên quan bằng harness. **Đề xuất đưa harness từ `.work/readme-demo/` vào repo** (`scripts/screenshots/`) để việc chụp lại tái lập được. Không chạy trong CI: cần Electron có GUI và WebGL.
- CLAUDE.md đang ghi "There is no website in this repository": sửa lại khi P0 xong.

## 5. Nội dung

Giọng văn: theo README hiện tại. Tiếng Anh, câu ngắn, cụ thể, **không dùng em dash**, không link tới CorosLink, luôn có dòng "not made, endorsed or supported by COROS". Ảnh dark-only như README.

### Sitemap

| Trang | Nội dung |
|---|---|
| `/` | Trang chủ (chi tiết dưới) |
| `/download` | Nút theo OS, size, sha512, yêu cầu hệ thống, hướng dẫn lần mở đầu (Gatekeeper, SmartScreen, `chmod +x`), auto-update, link các bản cũ |
| `/features/sessions` | Activities, Running (kể cả Trail), Cycling, Hiking, Strength, route replay |
| `/features/planning` | Calendar, Training Library, lưu thẳng lên COROS nên đồng hồ có ngay |
| `/coach` | Coach đọc gì, AI nào dùng được, chi phí, quyền riêng tư theo từng cuộc trò chuyện, "không bao giờ đổi lịch khi bạn chưa đồng ý" |
| `/labours` | **Trang đặc trưng**: 12 emblem vàng, mỗi labour một câu thần thoại + 3 mốc, sinh từ `labours.ts` |
| `/features/sleep`, `/features/places` | Có thể gộp vào trang chủ ở bản đầu |
| `/changelog`, `/changelog/1.0.0` | Sinh từ CHANGELOG.md, kèm feed Atom |
| `/guide/*` | Getting started, Connect COROS (vùng, 2FA), Set up Coach (từng provider), Sync qua Google Drive, Backup & restore, Hevy, Troubleshooting, FAQ |
| `/privacy.html` | Giữ URL; rà lại danh sách dịch vụ (Hevy, OpenRouter, Nominatim/Photon, OpenFreeMap, CDN locale của COROS) |
| `/about` | Câu chuyện "From CorosLink to Heracles Records", vì sao tên Heracles, Buy me a coffee |
| `/404` | |

### Trang chủ, từ trên xuống

1. **Hero.** Icon, "Heracles Records", tagline *Every session a record. Every record a labour.*, một câu: *Your COROS training, read in depth, with an AI coach that has read all of it.* Nút chính tự nhận OS ("Download for Windows · 162 MB"), dòng phụ "Other platforms". Bên phải là `16-route.webp` (route tự vẽ) hoặc `01-overview.webp`.
2. **Dải tin cậy.** Free & open source (MIT) · macOS, Windows, Linux · Works with every COROS watch · Not made by COROS.
3. **Today at a glance.** Overview + Sleep.
4. **Every session, read in depth.** Một ảnh lớn (run) + lưới 4 ô Running / Rides / Hikes / Strength, đúng như README.
5. **Plan it, and your watch has it.** Calendar + Library.
6. **A coach that has read your training.** Hai ảnh Coach, danh sách AI dùng được, câu chốt "Coach proposes. You decide."
7. **The Twelve Labours.** Lưới 12 emblem, hover hiện tên và 3 mốc, link sang `/labours`. Đây là thứ không app nào khác có, nên đáng chiếm diện tích.
8. **Your data stays yours.** *No account. No server. Your training stays on your computer.* Sync qua Google Drive của chính bạn, backup ra một file.
9. **How it works.** 1 Download · 2 Sign in with COROS · 3 Pick an AI for Coach (optional).
10. **FAQ ngắn**: Is it official? Which watches? Is it free? (app free, AI có thể tốn phí theo provider) Can I use it without AI? Where is my data? macOS says the app is damaged?
11. **Footer.** Version hiện tại + ngày, Changelog, GitHub, Report an issue, Privacy, Buy me a coffee, dòng trademark COROS.

### Kỹ thuật cho nội dung

- Mỗi trang có OG image (cắt từ screenshot) để chia sẻ lên Facebook/Strava club đẹp.
- `sitemap.xml`, `robots.txt`, canonical, JSON-LD `SoftwareApplication` (version, OS, giá 0).
- Analytics: **không dùng (đề xuất)**, khớp với lời hứa trong privacy policy. Nếu cần số liệu, số lượt tải trên GitHub Releases đã đủ dùng; muốn hơn thì GoatCounter (không cookie) và phải thêm vào privacy policy.
- Giao diện: dark mặc định, accent vàng (`#c8952f`), Source Serif 4 cho tiêu đề, cùng bộ font với app. Nếu hỗ trợ light thì theo palette "paper" của app.

## 6. Lộ trình

| Phase | Nội dung | Xong khi |
|---|---|---|
| **P0 Nền móng** (code xong 2026-10-04, chờ deploy key) | Deploy key + secret; `site/` Astro; chuyển `index` và `privacy` hiện có sang (sửa meta description); `site.yml` deploy sang repo org | `heraclesrecords.github.io` và `/privacy.html` phục vụ từ bản build của repo này; repo org chỉ còn commit của bot |
| **P1 Release tự động** (code xong 2026-10-04) | `lib/release-data.mjs`, `update-readme-release.mjs` + marker trong README, job `readme` và `site` trong `release.yml`, `test:site` | Chạy thử bằng `workflow_dispatch` trên v1.0.0: README không đổi gì, site hiện đúng 1.0.0 |
| **P2 Nội dung** | Trang chủ đầy đủ, Download, Labours, Coach, Features, Changelog, Guide, FAQ | Mọi trang trong sitemap có nội dung thật |
| **P3 Hoàn thiện** | OG images, sitemap, JSON-LD, Lighthouse ≥ 95, kiểm tra a11y, đưa harness chụp ảnh vào repo, (tuỳ chọn) bản tiếng Việt `/vi/` | |
| **P4 Domain riêng** | Xem mục 7 | |

## 7. Khi mua domain riêng

Giữ nguyên pipeline, chỉ thêm:

1. File `CNAME` trong bản build (`site/public/CNAME`) chứa domain.
2. DNS: apex → A `185.199.108.153`, `.109`, `.110`, `.111` (+ AAAA nếu muốn); `www` → CNAME `heraclesrecords.github.io`.
3. Repo org → Pages → Custom domain, bật **Enforce HTTPS**. Nên verify domain ở cấp org (Settings → Pages → Verified domains) để tránh bị chiếm.
4. GitHub tự redirect `heraclesrecords.github.io/*` sang domain mới, kể cả `/privacy.html`, nên link cũ không gãy.
5. Google Cloud Console → OAuth consent screen: đổi homepage, privacy URL, thêm authorized domain, verify domain trong Search Console.
6. Đổi `WEBSITE_URL` trong `SettingsView.tsx`, link trong README, `site` trong `astro.config.mjs`, và mục trong CLAUDE.md. Lần release tiếp theo mang link mới vào app.

## 8. Đã chốt (2026-10-04)

1. **Astro.**
2. **Bản tiếng Việt để sau**, không nằm trong P0 đến P2.
3. **Ảnh minh hoạ chỉ dark.** Riêng phần giới thiệu Appearance có cặp ảnh dark và light đặt cạnh nhau.
4. **Không analytics.** Privacy policy tiếp tục ghi "no analytics, tracking or crash reporting", và câu đó phải đúng cho cả site.
