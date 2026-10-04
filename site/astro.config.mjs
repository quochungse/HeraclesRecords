import { defineConfig } from "astro/config";

// The site is built here and published to heraclesrecords/heraclesrecords.github.io
// by .github/workflows/site.yml: an organisation's root Pages site can only be
// served from a repository of that name. See docs/website-plan.md.
export default defineConfig({
  site: "https://heraclesrecords.github.io",
  // `preserve` writes src/pages/privacy.astro to privacy.html. That exact URL is
  // the privacy policy Google's OAuth consent screen links to, so it must not
  // become privacy/index.html.
  build: { format: "preserve" },
  // Compression drops the line break before an inline element ("the<code>…"),
  // which runs words together in prose wrapped across lines.
  compressHTML: false,
  vite: {
    // Fonts, icons, screenshots and labour emblems are read straight from the
    // app (../src, ../build, ../docs) so the site cannot drift from it.
    server: { fs: { allow: [".."] } },
  },
});
