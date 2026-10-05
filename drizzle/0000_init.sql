CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`body` text NOT NULL,
	`author_type` text NOT NULL,
	`author_id` text NOT NULL,
	`author_name` text NOT NULL,
	`author_avatar_url` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `comments_thread_idx` ON `comments` (`thread_id`);--> statement-breakpoint
CREATE INDEX `comments_workspace_created_idx` ON `comments` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`public_key` text NOT NULL,
	`identity_secret` text NOT NULL,
	`comment_mode` text DEFAULT 'guests' NOT NULL,
	`allowed_origins` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_public_key_idx` ON `projects` (`public_key`);--> statement-breakpoint
CREATE INDEX `projects_workspace_idx` ON `projects` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `threads` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`page_url` text NOT NULL,
	`page_title` text,
	`selector` text NOT NULL,
	`dom_path` text NOT NULL,
	`tag_name` text NOT NULL,
	`text_snippet` text,
	`offset_x` real DEFAULT 1 NOT NULL,
	`offset_y` real DEFAULT 0 NOT NULL,
	`viewport_width` integer,
	`status` text DEFAULT 'open' NOT NULL,
	`author_type` text NOT NULL,
	`author_id` text NOT NULL,
	`author_name` text NOT NULL,
	`author_avatar_url` text,
	`resolved_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `threads_project_page_idx` ON `threads` (`project_id`,`page_url`);--> statement-breakpoint
CREATE INDEX `threads_project_idx` ON `threads` (`project_id`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`plan` text DEFAULT 'free' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
