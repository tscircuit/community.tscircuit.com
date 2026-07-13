CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`author_id` text NOT NULL,
	`author_name` text NOT NULL,
	`author_avatar` text,
	`content` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`edited_at` text,
	`attachments_json` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `messages_thread_idx` ON `messages` (`thread_id`);--> statement-breakpoint
CREATE INDEX `messages_created_idx` ON `messages` (`created_at`);--> statement-breakpoint
CREATE TABLE `sync_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `threads` (
	`id` text PRIMARY KEY NOT NULL,
	`guild_id` text NOT NULL,
	`parent_id` text NOT NULL,
	`parent_name` text DEFAULT 'Community' NOT NULL,
	`title` text NOT NULL,
	`owner_id` text,
	`creator_name` text DEFAULT 'Community member' NOT NULL,
	`creator_avatar` text,
	`created_at` text NOT NULL,
	`last_activity_at` text NOT NULL,
	`last_message_id` text,
	`archived` integer DEFAULT false NOT NULL,
	`locked` integer DEFAULT false NOT NULL,
	`message_count` integer DEFAULT 0 NOT NULL,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`excerpt` text DEFAULT '' NOT NULL,
	`search_text` text DEFAULT '' NOT NULL,
	`discord_url` text NOT NULL,
	`indexed_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `threads_activity_idx` ON `threads` (`last_activity_at`);--> statement-breakpoint
CREATE INDEX `threads_parent_idx` ON `threads` (`parent_id`);--> statement-breakpoint
CREATE INDEX `threads_archived_idx` ON `threads` (`archived`);