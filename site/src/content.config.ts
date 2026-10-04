import { readFile } from "node:fs/promises";
import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

// Built from its code point: the site's source carries no em dash (test:site).
const EM_DASH = String.fromCharCode(0x2014);

// The guides: Markdown files in src/content/guide, listed in `order`.
const guide = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/guide" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    order: z.number(),
  }),
});

// One entry per released section of the repository's CHANGELOG.md, which is
// also each GitHub release's text (scripts/release-notes.mjs). [Unreleased] is
// left out here; a section written ahead of its tag is left out by the pages,
// which list only versions up to the latest published release.
const changelog = defineCollection({
  loader: {
    name: "changelog",
    load: async ({ config, store, renderMarkdown, parseData, watcher }) => {
      const file = new URL("../CHANGELOG.md", config.root);
      watcher?.add(file.pathname);
      const text = (await readFile(file, "utf8")).replace(/\r\n/g, "\n");
      store.clear();
      for (const section of text.split(/^## /m).slice(1)) {
        const [heading, ...rest] = section.split("\n");
        const match = heading.match(/^\[?(\d+\.\d+\.\d+[^\]\s]*)\]?(?:\s*-\s*(\d{4}-\d{2}-\d{2}))?/);
        if (!match) continue;
        const [, version, date] = match;
        // The README's style, kept on the site: a bullet's "**Name** - text" (an em dash)
        // reads "**Name**: text", and no em dash is drawn anywhere else.
        const body = rest
          .join("\n")
          .trim()
          .replace(new RegExp(`(\\*\\*[^*]+\\*\\*)\\s+${EM_DASH}\\s+`, "g"), "$1: ")
          .replace(new RegExp(`\\s+${EM_DASH}\\s+`, "g"), ", ");
        const data = await parseData({ id: version, data: { version, date: date ?? null } });
        store.set({ id: version, data, body, rendered: await renderMarkdown(body) });
      }
    },
  },
  schema: z.object({
    version: z.string(),
    date: z.string().nullable(),
  }),
});

export const collections = { guide, changelog };
