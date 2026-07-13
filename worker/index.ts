/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { ensureSchema } from "../lib/db";
import { isSyncDue, syncDiscord } from "../lib/discord";
import type { CommunityEnv } from "../lib/db";

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: CommunityEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    if (url.pathname === "/api/sync") {
      const supplied =
        request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
        url.searchParams.get("secret");
      if (!env.ADMIN_SYNC_SECRET || supplied !== env.ADMIN_SYNC_SECRET) {
        return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
      }
      const result = await syncDiscord(env, { force: true });
      return Response.json(result, { status: result.ok ? 200 : 502 });
    }

    if (url.pathname === "/" || url.pathname.startsWith("/thread/")) {
      ctx.waitUntil(
        (async () => {
          await ensureSchema(env.DB);
          if (await isSyncDue(env.DB, 30)) await syncDiscord(env);
        })(),
      );
    }

    return handler.fetch(request, env, ctx);
  },
  async scheduled(
    _controller: ScheduledController,
    env: CommunityEnv,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(syncDiscord(env).then(() => undefined));
  },
};

export default worker;
