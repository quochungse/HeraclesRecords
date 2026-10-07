import type { APIRoute } from "astro";
import { faviconIco } from "../siteIcon";

export const GET: APIRoute = async () =>
  new Response(new Uint8Array(await faviconIco()), { headers: { "Content-Type": "image/x-icon" } });
