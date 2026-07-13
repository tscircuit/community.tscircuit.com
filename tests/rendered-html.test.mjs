import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("ships the searchable community index instead of the starter", async () => {
  const [page, layout, css, packageJson] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
  ]);

  assert.match(page, /tscircuit Community Index/);
  assert.match(page, /name="q"/);
  assert.match(page, /Fresh from the workbench/);
  assert.match(layout, /Community Index/);
  assert.match(layout, /og\.png/);
  assert.match(css, /\.threadGrid/);
  assert.doesNotMatch(page, /SkeletonPreview|codex-preview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await access(new URL("public/og.png", root));
});

test("includes durable indexing and automatic Discord refresh", async () => {
  const [hosting, worker, discord, migration, llms, rawThread, threadPage] = await Promise.all([
    readFile(new URL(".openai/hosting.json", root), "utf8"),
    readFile(new URL("worker/index.ts", root), "utf8"),
    readFile(new URL("lib/discord.ts", root), "utf8"),
    readFile(new URL("drizzle/0000_abnormal_sabra.sql", root), "utf8"),
    readFile(new URL("app/llms.txt/route.ts", root), "utf8"),
    readFile(new URL("app/thread/[id]/raw/route.ts", root), "utf8"),
    readFile(new URL("app/thread/[id]/page.tsx", root), "utf8"),
  ]);

  assert.match(hosting, /"d1": "DB"/);
  assert.match(worker, /scheduled/);
  assert.match(worker, /getSyncIntervalMinutes/);
  assert.match(worker, /stale-while-revalidate/);
  assert.match(worker, /\/api\/sync/);
  assert.match(discord, /threads\/archived\/public/);
  assert.match(discord, /messages\?limit=100/);
  assert.match(discord, /AnswerOverflow/);
  assert.match(discord, /postBacklink/);
  assert.match(discord, /DISCORD_SOURCE_CHANNEL_NAMES/);
  assert.match(discord, /THREAD_MAX_AGE_DAYS/);
  assert.match(discord, /fetchOriginalMessage/);
  assert.match(discord, /content:v2:/);
  assert.match(threadPage, /original post/);
  assert.match(llms, /Server-rendered discussions/);
  assert.match(rawThread, /text\/plain/);
  assert.match(migration, /CREATE TABLE .threads./);
  assert.match(migration, /CREATE TABLE .messages./);
});
