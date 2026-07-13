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

interface DiscordMessage {
  id: string;
  content: string;
  timestamp: string;
  edited_timestamp?: string | null;
  author: {
    id: string;
    username: string;
    global_name?: string | null;
    avatar?: string | null;
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
  message?: string;
}

const DISCORD_API = "https://discord.com/api/v10";
const DISCORD_EPOCH = 1420070400000n;

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

async function discordFetch<T>(path: string, token: string): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(DISCORD_API + path, {
      headers: {
        authorization: "Bot " + token,
        "user-agent": "tscircuit-community-index/1.0",
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

    return (await response.json()) as T;
  }

  throw new Error("Discord API rate limit did not clear.");
}

function selectedParentIds(channels: DiscordChannel[], configuredIds?: string): string[] {
  const explicit = configuredIds
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (explicit?.length) return explicit;
  return channels
    .filter((channel) => channel.type === 0 || channel.type === 5 || channel.type === 15)
    .map((channel) => channel.id);
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

export async function isSyncDue(db: D1Database, minutes = 30): Promise<boolean> {
  await ensureSchema(db);
  const row = await db
    .prepare("SELECT value FROM sync_state WHERE key = 'last_success'")
    .first<{ value: string }>();
  if (!row?.value) return true;
  return Date.now() - new Date(row.value).getTime() >= minutes * 60 * 1000;
}

export async function syncDiscord(
  env: CommunityEnv,
  options: { force?: boolean } = {},
): Promise<SyncResult> {
  const db = env.DB;
  await ensureSchema(db);

  const token = env.DISCORD_BOT_TOKEN?.trim();
  const guildId = env.DISCORD_GUILD_ID?.trim();
  if (!token || !guildId) {
    await setState(db, "configuration", "needed");
    return {
      ok: false,
      configured: false,
      indexed: 0,
      discovered: 0,
      message: "Discord connection has not been configured yet.",
    };
  }

  if (!options.force && !(await isSyncDue(db))) {
    return { ok: true, configured: true, indexed: 0, discovered: 0, message: "Index is fresh." };
  }

  const recentAttempt = await db
    .prepare("SELECT value FROM sync_state WHERE key = 'last_attempt'")
    .first<{ value: string }>();
  if (
    !options.force &&
    recentAttempt?.value &&
    Date.now() - new Date(recentAttempt.value).getTime() < 4 * 60 * 1000
  ) {
    return { ok: true, configured: true, indexed: 0, discovered: 0, message: "A refresh is already underway." };
  }

  await setState(db, "last_attempt", new Date().toISOString());
  await setState(db, "status", "syncing");

  try {
    const channels = await discordFetch<DiscordChannel[]>("/guilds/" + guildId + "/channels", token);
    const sourceIds = selectedParentIds(channels, env.DISCORD_SOURCE_CHANNEL_IDS);
    const sourceSet = new Set(sourceIds);
    const sourceMap = new Map(channels.map((channel) => [channel.id, channel]));
    const activeResponse = await discordFetch<{ threads: DiscordChannel[] }>(
      "/guilds/" + guildId + "/threads/active",
      token,
    );
    const discovered = new Map<string, DiscordChannel>();

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
      for (const thread of archived.threads) discovered.set(thread.id, thread);
    }

    const existingRows = await db
      .prepare("SELECT id, last_message_id FROM threads")
      .all<{ id: string; last_message_id: string | null }>();
    const existing = new Map(existingRows.results.map((row) => [row.id, row.last_message_id]));
    const candidates = [...discovered.values()]
      .filter((thread) => !existing.has(thread.id) || existing.get(thread.id) !== thread.last_message_id)
      .sort((a, b) => (b.last_message_id ?? b.id).localeCompare(a.last_message_id ?? a.id));
    const parsedLimit = Number.parseInt(env.MAX_THREADS_PER_SYNC ?? "24", 10);
    const maxThreads = Number.isFinite(parsedLimit) ? Math.min(48, Math.max(1, parsedLimit)) : 24;
    const selected = candidates.slice(0, maxThreads);
    let indexed = 0;

    for (const thread of selected) {
      if (!thread.parent_id) continue;
      const messages = await discordFetch<DiscordMessage[]>(
        "/channels/" + thread.id + "/messages?limit=100",
        token,
      );
      const chronological = [...messages].reverse();
      const starter = chronological[0];
      const parent = sourceMap.get(thread.parent_id);
      const tagNames = (thread.applied_tags ?? [])
        .map((tagId) => parent?.available_tags?.find((tag) => tag.id === tagId)?.name)
        .filter((name): name is string => Boolean(name));
      const createdAt =
        thread.thread_metadata?.create_timestamp ?? snowflakeDate(thread.id);
      const lastActivityAt =
        messages[0]?.timestamp ??
        thread.thread_metadata?.archive_timestamp ??
        createdAt;
      const contentText = chronological
        .map((message) => stripDiscordMarkdown(message.content))
        .filter(Boolean)
        .join(" ");
      const excerpt = stripDiscordMarkdown(starter?.content ?? contentText).slice(0, 280);
      const searchText = ((thread.name ?? "Untitled discussion") + " " + tagNames.join(" ") + " " + contentText)
        .slice(0, 30000)
        .toLowerCase();
      const creatorName =
        starter?.author.global_name || starter?.author.username || "Community member";
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
          thread.owner_id ?? starter?.author.id ?? null,
          creatorName,
          starter ? avatarUrl(starter) : null,
          createdAt,
          lastActivityAt,
          thread.last_message_id ?? messages[0]?.id ?? null,
          thread.thread_metadata?.archived ? 1 : 0,
          thread.thread_metadata?.locked ? 1 : 0,
          thread.total_message_sent ?? thread.message_count ?? messages.length,
          JSON.stringify(tagNames),
          excerpt,
          searchText,
          "https://discord.com/channels/" + guildId + "/" + thread.id,
          now,
        )
        .run();

      if (chronological.length) {
        await db.batch(
          chronological.map((message) =>
            db
              .prepare(
                "INSERT INTO messages (id, thread_id, author_id, author_name, author_avatar, content, created_at, edited_at, attachments_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET author_name = excluded.author_name, author_avatar = excluded.author_avatar, content = excluded.content, edited_at = excluded.edited_at, attachments_json = excluded.attachments_json",
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
      }
      indexed += 1;
    }

    const completedAt = new Date().toISOString();
    await setState(db, "last_success", completedAt);
    await setState(db, "status", "ready");
    await setState(db, "configuration", "connected");
    await setState(db, "last_result", JSON.stringify({ indexed, discovered: discovered.size }));
    return { ok: true, configured: true, indexed, discovered: discovered.size };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Discord sync error";
    await setState(db, "status", "error");
    await setState(db, "last_error", message.slice(0, 500));
    return { ok: false, configured: true, indexed: 0, discovered: 0, message };
  }
}
