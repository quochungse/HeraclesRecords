// /sitemap.xml: every page a search engine should find, at the address GitHub
// Pages serves it from (/coach, not /coach.html). The 404 page is left out.
// test:site checks that each address here is a page in the build.
import type { APIRoute } from "astro";
import { getCollection } from "astro:content";

const PAGES = ["/", "/download", "/activities", "/plan", "/coach", "/labours", "/guide/", "/changelog/", "/about", "/privacy.html"];

export const GET: APIRoute = async ({ site }) => {
  const guides = (await getCollection("guide")).sort((a, b) => a.data.order - b.data.order);
  const paths = [...PAGES, ...guides.map((guide) => `/guide/${guide.id}`)];
  const urls = paths.map((path) => `  <url><loc>${new URL(path, site).href}</loc></url>`);
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
};
