import { env } from "cloudflare:workers";

export interface CommunityEnv {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
  DISCORD_BOT_TOKEN?: string;
  DISCORD_GUILD_ID?: string;
  DISCORD_SOURCE_CHANNEL_IDS?: string;
  DISCORD_INVITE_URL?: string;
  ADMIN_SYNC_SECRET?: string;
  MAX_THREADS_PER_SYNC?: string;
}

const schemaStatements = [
  "CREATE TABLE IF NOT EXISTS threads (id TEXT PRIMARY KEY NOT NULL, guild_id TEXT NOT NULL, parent_id TEXT NOT NULL, parent_name TEXT NOT NULL DEFAULT 'Community', title TEXT NOT NULL, owner_id TEXT, creator_name TEXT NOT NULL DEFAULT 'Community member', creator_avatar TEXT, created_at TEXT NOT NULL, last_activity_at TEXT NOT NULL, last_message_id TEXT, archived INTEGER NOT NULL DEFAULT 0, locked INTEGER NOT NULL DEFAULT 0, message_count INTEGER NOT NULL DEFAULT 0, tags_json TEXT NOT NULL DEFAULT '[]', excerpt TEXT NOT NULL DEFAULT '', search_text TEXT NOT NULL DEFAULT '', discord_url TEXT NOT NULL, indexed_at TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS threads_activity_idx ON threads(last_activity_at)",
  "CREATE INDEX IF NOT EXISTS threads_parent_idx ON threads(parent_id)",
  "CREATE INDEX IF NOT EXISTS threads_archived_idx ON threads(archived)",
  "CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY NOT NULL, thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE, author_id TEXT NOT NULL, author_name TEXT NOT NULL, author_avatar TEXT, content TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, edited_at TEXT, attachments_json TEXT NOT NULL DEFAULT '[]')",
  "CREATE INDEX IF NOT EXISTS messages_thread_idx ON messages(thread_id)",
  "CREATE INDEX IF NOT EXISTS messages_created_idx ON messages(created_at)",
  "CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL)",
];

export function getBinding(): D1Database {
  const binding = (env as unknown as CommunityEnv).DB;
  if (!binding) throw new Error("The community database is not available.");
  return binding;
}

export async function ensureSchema(db: D1Database): Promise<void> {
  await db.batch(schemaStatements.map((statement) => db.prepare(statement)));
}

export function parseJsonList(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function stripDiscordMarkdown(value: string): string {
  return value
    .replace(/\x60\x60\x60[\s\S]*?\x60\x60\x60/g, " code sample ")
    .replace(/\x60([^\x60]+)\x60/g, "$1")
    .replace(/<https?:\/\/[^>]+>/g, " link ")
    .replace(/<[@#&]!?(\d+)>/g, " mention ")
    .replace(/[*_~>|#-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function relativeTime(iso: string): string {
  const value = new Date(iso).getTime();
  const seconds = Math.round((value - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return formatter.format(days, "day");
  const months = Math.round(days / 30);
  if (Math.abs(months) < 12) return formatter.format(months, "month");
  return formatter.format(Math.round(months / 12), "year");
}
