import { ensureSchema, getBinding, parseJsonList } from "./db";

export interface ThreadSummary {
  id: string;
  parent_name: string;
  title: string;
  creator_name: string;
  creator_avatar: string | null;
  created_at: string;
  last_activity_at: string;
  archived: number;
  locked: number;
  message_count: number;
  tags_json: string;
  excerpt: string;
  discord_url: string;
}

export interface ThreadMessage {
  id: string;
  author_name: string;
  author_avatar: string | null;
  content: string;
  created_at: string;
  edited_at: string | null;
  attachments_json: string;
}

export interface IndexData {
  threads: ThreadSummary[];
  total: number;
  messageTotal: number;
  contributors: number;
  tags: Array<{ name: string; count: number }>;
  parents: Array<{ name: string; count: number }>;
  lastSync: string | null;
  configuration: string | null;
}

export async function getIndexData(filters: {
  query?: string;
  tag?: string;
  parent?: string;
}): Promise<IndexData> {
  const db = getBinding();
  await ensureSchema(db);
  const where: string[] = [];
  const bindings: string[] = [];
  const query = filters.query?.trim().toLowerCase();
  if (query) {
    where.push("(LOWER(title) LIKE ? OR search_text LIKE ? OR LOWER(excerpt) LIKE ?)");
    const pattern = "%" + query.replace(/[%_]/g, "") + "%";
    bindings.push(pattern, pattern, pattern);
  }
  if (filters.tag) {
    where.push("LOWER(tags_json) LIKE ?");
    bindings.push("%" + filters.tag.toLowerCase().replace(/[%_]/g, "") + "%");
  }
  if (filters.parent) {
    where.push("parent_name = ?");
    bindings.push(filters.parent);
  }
  const whereSql = where.length ? " WHERE " + where.join(" AND ") : "";
  const [threadsResult, totals, messages, contributors, allTags, parents, sync, configuration] =
    await Promise.all([
      db
        .prepare(
          "SELECT id, parent_name, title, creator_name, creator_avatar, created_at, last_activity_at, archived, locked, message_count, tags_json, excerpt, discord_url FROM threads" +
            whereSql +
            " ORDER BY last_activity_at DESC LIMIT 48",
        )
        .bind(...bindings)
        .all<ThreadSummary>(),
      db.prepare("SELECT COUNT(*) AS count FROM threads").first<{ count: number }>(),
      db.prepare("SELECT COUNT(*) AS count FROM messages").first<{ count: number }>(),
      db
        .prepare("SELECT COUNT(DISTINCT author_id) AS count FROM messages")
        .first<{ count: number }>(),
      db.prepare("SELECT tags_json FROM threads").all<{ tags_json: string }>(),
      db
        .prepare(
          "SELECT parent_name AS name, COUNT(*) AS count FROM threads GROUP BY parent_name ORDER BY count DESC",
        )
        .all<{ name: string; count: number }>(),
      db
        .prepare("SELECT value FROM sync_state WHERE key = 'last_success'")
        .first<{ value: string }>(),
      db
        .prepare("SELECT value FROM sync_state WHERE key = 'configuration'")
        .first<{ value: string }>(),
    ]);

  const counts = new Map<string, number>();
  for (const row of allTags.results) {
    for (const tag of parseJsonList(row.tags_json)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }

  return {
    threads: threadsResult.results,
    total: Number(totals?.count ?? 0),
    messageTotal: Number(messages?.count ?? 0),
    contributors: Number(contributors?.count ?? 0),
    tags: [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 12),
    parents: parents.results,
    lastSync: sync?.value ?? null,
    configuration: configuration?.value ?? null,
  };
}

export async function getThread(id: string): Promise<{
  thread: ThreadSummary | null;
  messages: ThreadMessage[];
}> {
  const db = getBinding();
  await ensureSchema(db);
  const [thread, messages] = await Promise.all([
    db
      .prepare(
        "SELECT id, parent_name, title, creator_name, creator_avatar, created_at, last_activity_at, archived, locked, message_count, tags_json, excerpt, discord_url FROM threads WHERE id = ?",
      )
      .bind(id)
      .first<ThreadSummary>(),
    db
      .prepare(
        "SELECT id, author_name, author_avatar, content, created_at, edited_at, attachments_json FROM messages WHERE thread_id = ? ORDER BY created_at ASC LIMIT 200",
      )
      .bind(id)
      .all<ThreadMessage>(),
  ]);
  return { thread: thread ?? null, messages: messages.results };
}

export async function getPublicIndexEntries(
  limit = 1000,
): Promise<Array<{
  id: string;
  title: string;
  excerpt: string;
  parent_name: string;
  last_activity_at: string;
}>> {
  const db = getBinding();
  await ensureSchema(db);
  const safeLimit = Math.min(5000, Math.max(1, Math.trunc(limit)));
  const result = await db
    .prepare(
      "SELECT id, title, excerpt, parent_name, last_activity_at FROM threads ORDER BY last_activity_at DESC LIMIT ?",
    )
    .bind(safeLimit)
    .all<{
      id: string;
      title: string;
      excerpt: string;
      parent_name: string;
      last_activity_at: string;
    }>();
  return result.results;
}
