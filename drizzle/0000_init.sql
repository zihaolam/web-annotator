CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`body` text NOT NULL,
	`author_id` text NOT NULL,
	`author_name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `comments_thread_idx` ON `comments` (`thread_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`allowed_origins` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
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
	`author_id` text NOT NULL,
	`author_name` text NOT NULL,
	`resolved_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `threads_project_page_idx` ON `threads` (`project_id`,`page_url`);