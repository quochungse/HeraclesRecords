import type { APIRoute } from "astro";
import { iconPng } from "../siteIcon";

export const GET: APIRoute = async () =>
  new Response(new Uint8Array(await iconPng(180)), { headers: { "Content-Type": "image/png" } });
