// /changelog.xml: an RSS feed of the released versions, so a reader can follow
// releases without watching the repository. Same entries as /changelog.
import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { compareVersions } from "../assets";
import { latestRelease } from "../release.mjs";

const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const GET: APIRoute = async ({ site }) => {
  const release = await latestRelease();
  const entries = (await getCollection("changelog"))
    .filter((entry) => entry.data.date && (!release || compareVersions(entry.data.version, release.version) <= 0))
    .sort((a, b) => compareVersions(b.data.version, a.data.version));
  const home = new URL("/", site).href;
  const items = entries.map((entry) => {
      const link = new URL(`/changelog/#${entry.data.version}`, site).href;
      const html = entry.rendered?.html ?? "";
      return [
        "    <item>",
        `      <title>Heracles Records ${escape(entry.data.version)}</title>`,
        `      <link>${escape(link)}</link>`,
        `      <guid isPermaLink="false">heracles-records-${escape(entry.data.version)}</guid>`,
        `      <pubDate>${new Date(`${entry.data.date}T00:00:00Z`).toUTCString()}</pubDate>`,
        `      <description>${escape(html)}</description>`,
        "    </item>",
      ].join("\n");
    });
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    "  <channel>",
    "    <title>Heracles Records releases</title>",
    `    <link>${escape(home)}</link>`,
    "    <description>What changed in each release of Heracles Records.</description>",
    "    <language>en</language>",
    ...items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
  return new Response(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
};
