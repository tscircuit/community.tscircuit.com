import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const threads = sqliteTable(
  "threads",
  {
    id: text("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    parentId: text("parent_id").notNull(),
    parentName: text("parent_name").notNull().default("Community"),
    title: text("title").notNull(),
    ownerId: text("owner_id"),
    creatorName: text("creator_name").notNull().default("Community member"),
    creatorAvatar: text("creator_avatar"),
    createdAt: text("created_at").notNull(),
    lastActivityAt: text("last_activity_at").notNull(),
    lastMessageId: text("last_message_id"),
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
    locked: integer("locked", { mode: "boolean" }).notNull().default(false),
    messageCount: integer("message_count").notNull().default(0),
    tagsJson: text("tags_json").notNull().default("[]"),
    excerpt: text("excerpt").notNull().default(""),
    searchText: text("search_text").notNull().default(""),
    discordUrl: text("discord_url").notNull(),
    indexedAt: text("indexed_at").notNull(),
  },
  (table) => [
    index("threads_activity_idx").on(table.lastActivityAt),
    index("threads_parent_idx").on(table.parentId),
    index("threads_archived_idx").on(table.archived),
  ],
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    authorId: text("author_id").notNull(),
    authorName: text("author_name").notNull(),
    authorAvatar: text("author_avatar"),
    content: text("content").notNull().default(""),
    createdAt: text("created_at").notNull(),
    editedAt: text("edited_at"),
    attachmentsJson: text("attachments_json").notNull().default("[]"),
  },
  (table) => [
    index("messages_thread_idx").on(table.threadId),
    index("messages_created_idx").on(table.createdAt),
  ],
);

export const syncState = sqliteTable("sync_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});
