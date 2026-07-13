import { ensureSchema, stripDiscordMarkdown, type CommunityEnv } from "./db";

interface DiscordChannel {
  id: string;
  guild_id?: string;
  parent_id?: string | null;
  owner_id?: string;
  name?: string;
  type: number;
  last_message_id?: string | null;
  message_count?: number;
  total_message_sent?: number;
  applied_tags?: string[];
  available_tags?: Array<{ id: string; name: string }>;
  thread_metadata?: {
    archived: boolean;
    locked: boolean;
    archive_timestamp: string;
    create_timestamp?: string | null;
  };
}

interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
}

interface DiscordGuild {
  id: string;
  name: string;
}

interface DiscordMessage {
  id: string;
  type?: number;
  content: string;
  timestamp: string;
  edited_timestamp?: string | null;
  webhook_id?: string;
  message_reference?: {
    message_id?: string;
    channel_id?: string;
  };
  referenced_message?: DiscordMessage | null;
  author: DiscordUser & {
    avatar?: string | null;
    bot?: boolean;
  };
  attachments?: Array<{
    id: string;
    filename: string;
    url: string;
    content_type?: string;
  }>;
}

interface ArchivedThreadsResponse {
  threads: DiscordChannel[];
  has_more: boolean;
}

export interface SyncResult {
  ok: boolean;
  configured: boolean;
  indexed: number;
  discovered: number;
  backlinks: number;
  message?: string;
}

const DISCORD_API = "https://discord.com/api/v10";
const DISCORD_EPOCH = 1420070400000n;
const CONTENT_FORMAT_STATE_PREFIX = "content:v3:";

function avatarUrl(message: DiscordMessage): string | null {
  if (!message.author.avatar) return null;
  return (
    "https://cdn.discordapp.com/avatars/" +
    message.author.id +
    "/" +
    message.author.avatar +
    ".png?size=80"
  );
}

function snowflakeDate(id: string): string {
  try {
    const timestamp = (BigInt(id) >> 22n) + DISCORD_EPOCH;
    return new Date(Number(timestamp)).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function isRecentArchivedThread(thread: DiscordChannel, cutoffMs: number): boolean {
  const activity =
    thread.last_message_id ? snowflakeDate(thread.last_message_id) :
    thread.thread_metadata?.archive_timestamp ?? snowflakeDate(thread.id);
  return new Date(activity).getTime() >= cutoffMs;
}

async function discordFetch<T>(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(DISCORD_API + path, {
      ...init,
      headers: {
        authorization: "Bot " + token,
        "content-type": "application/json",
        "user-agent": "tscircuit-community-index/2.0",
        ...(init.headers ?? {}),
      },
    });

    if (response.status === 429) {
      const rateLimit = (await response.json().catch(() => ({}))) as {
        retry_after?: number;
      };
      const waitMs = Math.min(4000, Math.max(250, (rateLimit.retry_after ?? 1) * 1000));
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      continue;
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        "Discord API " + response.status + " for " + path + (detail ? ": " + detail.slice(0, 160) : ""),
      );
    }

    const body = await response.text();
    return (body ? JSON.parse(body) : undefined) as T;
  }

  throw new Error("Discord API rate limit did not clear.");
}

async function discordFetchOptional<T>(
  path: string,
  token: string,
): Promise<T | null> {
  try {
    return await discordFetch<T>(path, token);
  } catch (error) {
    if (error instanceof Error && error.message.includes("Discord API 404")) {
      return null;
    }
    throw error;
  }
}

async function fetchOriginalMessage(
  thread: DiscordChannel,
  token: string,
  recentMessages: DiscordMessage[],
): Promise<DiscordMessage | null> {
  let starter =
    recentMessages.find((message) => message.id === thread.id || message.type === 21) ??
    (await discordFetchOptional<DiscordMessage>(
      "/channels/" + thread.id + "/messages/" + thread.id,
      token,
    ));

  if (!starter) return null;
  if (starter.type !== 21) return starter;
  if (starter.referenced_message) return starter.referenced_message;

  const parentChannelId =
    starter.message_reference?.channel_id ?? thread.parent_id;
  const originalMessageId =
    starter.message_reference?.message_id ?? thread.id;
  if (!parentChannelId) return null;
  return discordFetchOptional<DiscordMessage>(
    "/channels/" + parentChannelId + "/messages/" + originalMessageId,
    token,
  );
}

function splitSetting(value: string | undefined, defaults: string[] = []): string[] {
  const values = value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return values?.length ? values : defaults;
}

function selectedParentIds(
  channels: DiscordChannel[],
  configuredIds?: string,
  configuredNames?: string,
): string[] {
  const explicit = splitSetting(configuredIds);
  if (explicit.length) return explicit;

  const nameFragments = splitSetting(configuredNames, ["support", "contributor"])
    .map((name) => name.toLowerCase());
  return channels
    .filter((channel) => {
      if (![0, 5, 15].includes(channel.type)) return false;
      const name = channel.name?.toLowerCase() ?? "";
      return nameFragments.some((fragment) => name.includes(fragment));
    })
    .map((channel) => channel.id);
}

function shouldIgnoreMessage(
  message: DiscordMessage,
  ignoredNames: string[],
  currentBotId: string,
): boolean {
  if (message.author.id === currentBotId) return true;
  const normalizeName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const names = [message.author.username, message.author.global_name ?? ""]
    .map(normalizeName);
  return ignoredNames.some((ignored) => {
    const normalizedIgnored = normalizeName(ignored);
    return normalizedIgnored && names.some((name) => name.includes(normalizedIgnored));
  });
}

async function setState(db: D1Database, key: string, value: string): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      "INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .bind(key, value, now)
    .run();
}

async function resolveGuildId(
  token: string,
  configuredGuildId?: string,
): Promise<{ guildId: string; bot: DiscordUser }> {
  const [bot, guilds] = await Promise.all([
    discordFetch<DiscordUser>("/users/@me", token),
    discordFetch<DiscordGuild[]>("/users/@me/guilds", token),
  ]);
  const configured = configuredGuildId?.trim();

  if (configured) {
    if (!guilds.some((guild) => guild.id === configured)) {
      throw new Error("The bot is not installed in the configured Discord server.");
    }
    return { guildId: configured, bot };
  }

  if (guilds.length === 0) {
    throw new Error("The bot is not installed in any Discord server yet.");
  }
  if (guilds.length > 1) {
    throw new Error("The bot is installed in multiple servers; set DISCORD_GUILD_ID explicitly.");
  }
  return { guildId: guilds[0].id, bot };
}

export function getSyncIntervalMinutes(env: CommunityEnv): number {
  const parsed = Number.parseInt(env.SYNC_INTERVAL_MINUTES ?? "15", 10);
  return Number.isFinite(parsed) ? Math.min(60, Math.max(5, parsed)) : 15;
}

export async function isSyncDue(db: D1Database, minutes = 15): Promise<boolean> {
  await ensureSchema(db);
  const row = await db
    .prepare("SELECT value FROM sync_state WHERE key = 'last_success'")
    .first<{ value: string }>();
  if (!row?.value) return true;
  return Date.now() - new Date(row.value).getTime() >= minutes * 60 * 1000;
}

async function postBacklink(args: {
  db: D1Database;
  token: string;
  thread: DiscordChannel;
  siteUrl: string;
  existingMessages: DiscordMessage[];
  botId: string;
}): Promise<string | null> {
  const { db, token, thread, siteUrl, existingMessages, botId } = args;
  const stateKey = "backlink:" + thread.id;
  const existingState = await db
    .prepare("SELECT value FROM sync_state WHERE key = ?")
    .bind(stateKey)
    .first<{ value: string }>();
  if (existingState?.value) return null;

  const pageUrl = siteUrl.replace(/\/+$/, "") + "/thread/" + thread.id;
  const existingPost = existingMessages.find(
    (message) => message.author.id === botId && message.content.includes(pageUrl),
  );
  if (existingPost) {
    await setState(db, stateKey, existingPost.id);
    return null;
  }

  const posted = await discordFetch<DiscordMessage>(
    "/channels/" + thread.id + "/messages",
    token,
    {
      method: "POST",
      body: JSON.stringify({
        content:
          "This conversation is indexed at " +
          pageUrl +
          "\n\nThe page is server-rendered and refreshed regularly for search and AI tools.",
        allowed_mentions: { parse: [] },
        flags: 4096,
      }),
    },
  );
  await setState(db, stateKey, posted.id);
  await db
    .prepare("UPDATE threads SET last_message_id = ? WHERE id = ?")
    .bind(posted.id, thread.id)
    .run();
  return posted.id;
}

export async function syncDiscord(
  env: CommunityEnv,
  options: { force?: boolean } = {},
): Promise<SyncResult> {
  const db = env.DB;
  await ensureSchema(db);

  const token = env.DISCORD_BOT_TOKEN?.trim();
  if (!token) {
    await setState(db, "configuration", "needed");
    return {
      ok: false,
      configured: false,
      indexed: 0,
      discovered: 0,
      backlinks: 0,
      message: "Discord connection has not been configured yet.",
    };
  }

  if (!options.force && !(await isSyncDue(db, getSyncIntervalMinutes(env)))) {
    return {
      ok: true,
      configured: true,
      indexed: 0,
      discovered: 0,
      backlinks: 0,
      message: "Index is fresh.",
    };
  }

  const recentAttempt = await db
    .prepare("SELECT value FROM sync_state WHERE key = 'last_attempt'")
    .first<{ value: string }>();
  if (
    !options.force &&
    recentAttempt?.value &&
    Date.now() - new Date(recentAttempt.value).getTime() < 4 * 60 * 1000
  ) {
    return {
      ok: true,
      configured: true,
      indexed: 0,
      discovered: 0,
      backlinks: 0,
      message: "A refresh is already underway.",
    };
  }

  await setState(db, "last_attempt", new Date().toISOString());
  await setState(db, "status", "syncing");

  try {
    const { guildId, bot } = await resolveGuildId(token, env.DISCORD_GUILD_ID);
    const channels = await discordFetch<DiscordChannel[]>("/guilds/" + guildId + "/channels", token);
    const sourceIds = selectedParentIds(
      channels,
      env.DISCORD_SOURCE_CHANNEL_IDS,
      env.DISCORD_SOURCE_CHANNEL_NAMES,
    );
    if (!sourceIds.length) {
      throw new Error("No visible support or contributor channels matched the index configuration.");
    }

    const sourceSet = new Set(sourceIds);
    const sourceMap = new Map(channels.map((channel) => [channel.id, channel]));
    const activeResponse = await discordFetch<{ threads: DiscordChannel[] }>(
      "/guilds/" + guildId + "/threads/active",
      token,
    );
    const discovered = new Map<string, DiscordChannel>();
    const parsedMaxAge = Number.parseInt(env.THREAD_MAX_AGE_DAYS ?? "30", 10);
    const maxAgeDays = Number.isFinite(parsedMaxAge)
      ? Math.min(365, Math.max(1, parsedMaxAge))
      : 30;
    const archivedCutoffMs = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

    for (const thread of activeResponse.threads) {
      if (thread.parent_id && sourceSet.has(thread.parent_id)) discovered.set(thread.id, thread);
    }

    for (const parentId of sourceIds) {
      const parent = sourceMap.get(parentId);
      if (!parent || ![0, 5, 15].includes(parent.type)) continue;
      const archived = await discordFetch<ArchivedThreadsResponse>(
        "/channels/" + parentId + "/threads/archived/public?limit=100",
        token,
      );
      for (const thread of archived.threads) {
        if (isRecentArchivedThread(thread, archivedCutoffMs)) {
          discovered.set(thread.id, thread);
        }
      }
    }

    const shouldPost = env.DISCORD_POST_BACKLINKS?.toLowerCase() === "true";
    const [existingRows, backlinkRows, contentFormatRows] = await Promise.all([
      db
        .prepare("SELECT id, last_message_id FROM threads")
        .all<{ id: string; last_message_id: string | null }>(),
      db
        .prepare("SELECT key FROM sync_state WHERE key LIKE 'backlink:%'")
        .all<{ key: string }>(),
      db
        .prepare("SELECT key FROM sync_state WHERE key LIKE ?")
        .bind(CONTENT_FORMAT_STATE_PREFIX + "%")
        .all<{ key: string }>(),
    ]);
    const existing = new Map(existingRows.results.map((row) => [row.id, row.last_message_id]));
    const linked = new Set(
      backlinkRows.results.map((row) => row.key.slice("backlink:".length)),
    );
    const currentFormat = new Set(
      contentFormatRows.results.map((row) =>
        row.key.slice(CONTENT_FORMAT_STATE_PREFIX.length),
      ),
    );
    const candidates = [...discovered.values()]
      .filter(
        (thread) =>
          !existing.has(thread.id) ||
          existing.get(thread.id) !== thread.last_message_id ||
          !currentFormat.has(thread.id) ||
          (shouldPost && !thread.thread_metadata?.archived && !linked.has(thread.id)),
      )
      .sort((a, b) => (b.last_message_id ?? b.id).localeCompare(a.last_message_id ?? a.id));
    const parsedLimit = Number.parseInt(env.MAX_THREADS_PER_SYNC ?? "48", 10);
    const maxThreads = Number.isFinite(parsedLimit) ? Math.min(48, Math.max(1, parsedLimit)) : 48;
    const selected = candidates.slice(0, maxThreads);
    const ignoredNames = splitSetting(env.DISCORD_IGNORED_AUTHORS, ["AnswerOverflow"])
      .map((name) => name.toLowerCase());
    const siteUrl =
      env.PUBLIC_SITE_URL?.replace(/\/+$/, "") ??
      "https://tscircuit-community-index.seveibar.chatgpt.site";
    let indexed = 0;
    let backlinks = 0;

    for (const thread of selected) {
      if (!thread.parent_id) continue;
      const rawMessages = await discordFetch<DiscordMessage[]>(
        "/channels/" + thread.id + "/messages?limit=100",
        token,
      );
      const originalMessage = await fetchOriginalMessage(thread, token, rawMessages);
      const messageMap = new Map<string, DiscordMessage>();
      for (const message of rawMessages) {
        if (message.type === 21 && !message.content && message.referenced_message) {
          messageMap.set(message.referenced_message.id, message.referenced_message);
        } else if (message.type !== 21 || message.content) {
          messageMap.set(message.id, message);
        }
      }
      if (originalMessage) messageMap.set(originalMessage.id, originalMessage);
      const chronological = [...messageMap.values()]
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
        .filter((message) => !shouldIgnoreMessage(message, ignoredNames, bot.id));

      if (!chronological.length) {
        await db.prepare("DELETE FROM threads WHERE id = ?").bind(thread.id).run();
        continue;
      }

      const starter = chronological[0];
      const newest = chronological[chronological.length - 1];
      const parent = sourceMap.get(thread.parent_id);
      const tagNames = (thread.applied_tags ?? [])
        .map((tagId) => parent?.available_tags?.find((tag) => tag.id === tagId)?.name)
        .filter((name): name is string => Boolean(name));
      const createdAt = thread.thread_metadata?.create_timestamp ?? snowflakeDate(thread.id);
      const lastActivityAt =
        newest?.timestamp ??
        thread.thread_metadata?.archive_timestamp ??
        createdAt;
      const contentText = chronological
        .map((message) => stripDiscordMarkdown(message.content))
        .filter(Boolean)
        .join(" ");
      const excerpt = stripDiscordMarkdown(starter.content || contentText).slice(0, 280);
      const searchText = (
        (thread.name ?? "Untitled discussion") +
        " " +
        tagNames.join(" ") +
        " " +
        contentText
      )
        .slice(0, 30000)
        .toLowerCase();
      const creatorName =
        starter.author.global_name || starter.author.username || "Community member";
      const now = new Date().toISOString();

      await db
        .prepare(
          "INSERT INTO threads (id, guild_id, parent_id, parent_name, title, owner_id, creator_name, creator_avatar, created_at, last_activity_at, last_message_id, archived, locked, message_count, tags_json, excerpt, search_text, discord_url, indexed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET parent_id = excluded.parent_id, parent_name = excluded.parent_name, title = excluded.title, owner_id = excluded.owner_id, creator_name = excluded.creator_name, creator_avatar = excluded.creator_avatar, last_activity_at = excluded.last_activity_at, last_message_id = excluded.last_message_id, archived = excluded.archived, locked = excluded.locked, message_count = excluded.message_count, tags_json = excluded.tags_json, excerpt = excluded.excerpt, search_text = excluded.search_text, discord_url = excluded.discord_url, indexed_at = excluded.indexed_at",
        )
        .bind(
          thread.id,
          guildId,
          thread.parent_id,
          parent?.name ?? "Community",
          thread.name ?? "Untitled discussion",
          thread.owner_id ?? starter.author.id,
          creatorName,
          avatarUrl(starter),
          createdAt,
          lastActivityAt,
          thread.last_message_id ?? newest.id,
          thread.thread_metadata?.archived ? 1 : 0,
          thread.thread_metadata?.locked ? 1 : 0,
          chronological.length,
          JSON.stringify(tagNames),
          excerpt,
          searchText,
          "https://discord.com/channels/" + guildId + "/" + thread.id,
          now,
        )
        .run();

      await db.prepare("DELETE FROM messages WHERE thread_id = ?").bind(thread.id).run();
      await db.batch(
        chronological.map((message) =>
          db
            .prepare(
              "INSERT INTO messages (id, thread_id, author_id, author_name, author_avatar, content, created_at, edited_at, attachments_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(
              message.id,
              thread.id,
              message.author.id,
              message.author.global_name || message.author.username,
              avatarUrl(message),
              message.content,
              message.timestamp,
              message.edited_timestamp ?? null,
              JSON.stringify(message.attachments ?? []),
            ),
        ),
      );
      await setState(db, CONTENT_FORMAT_STATE_PREFIX + thread.id, now);
      indexed += 1;

      if (
        shouldPost &&
        !thread.thread_metadata?.archived &&
        !thread.thread_metadata?.locked
      ) {
        try {
          const posted = await postBacklink({
            db,
            token,
            thread,
            siteUrl,
            existingMessages: rawMessages,
            botId: bot.id,
          });
          if (posted) backlinks += 1;
        } catch (error) {
          const detail = error instanceof Error ? error.message : "Unknown backlink error";
          await setState(db, "backlink_error:" + thread.id, detail.slice(0, 500));
        }
      }
    }

    const completedAt = new Date().toISOString();
    await setState(db, "last_success", completedAt);
    await setState(db, "status", "ready");
    await setState(db, "configuration", "connected");
    await setState(db, "guild_id", guildId);
    await setState(db, "source_channel_ids", sourceIds.join(","));
    await setState(
      db,
      "last_result",
      JSON.stringify({ indexed, discovered: discovered.size, backlinks }),
    );
    return {
      ok: true,
      configured: true,
      indexed,
      discovered: discovered.size,
      backlinks,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Discord sync error";
    await setState(db, "status", "error");
    await setState(db, "last_error", message.slice(0, 500));
    return {
      ok: false,
      configured: true,
      indexed: 0,
      discovered: 0,
      backlinks: 0,
      message,
    };
  }
}
