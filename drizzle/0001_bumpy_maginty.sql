CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`username_key` text NOT NULL,
	`email` text NOT NULL,
	`email_key` text NOT NULL,
	`salt` text NOT NULL,
	`password_hash` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_username_key_unique` ON `accounts` (`username_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_email_key_unique` ON `accounts` (`email_key`);--> statement-breakpoint
CREATE TABLE `auth_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`hits` integer NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`hash` text PRIMARY KEY NOT NULL,
	`user` text NOT NULL,
	`expires` integer NOT NULL,
	FOREIGN KEY (`user`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_auth_sessions_user` ON `auth_sessions` (`user`);--> statement-breakpoint
CREATE TABLE `call_locks` (
	`user` text PRIMARY KEY NOT NULL,
	`call` text NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `calls` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation` text NOT NULL,
	`caller` text NOT NULL,
	`callee` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`offer` text,
	`answer` text,
	`created` integer NOT NULL,
	`updated` integer NOT NULL,
	`caller_seen` integer NOT NULL,
	`callee_seen` integer NOT NULL,
	`reason` text,
	FOREIGN KEY (`conversation`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_calls_callee_status` ON `calls` (`callee`,`status`);--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`first` text NOT NULL,
	`second` text NOT NULL,
	`created` integer NOT NULL,
	`updated` integer NOT NULL,
	`pair` text NOT NULL,
	FOREIGN KEY (`first`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`second`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conversations_pair_unique` ON `conversations` (`pair`);--> statement-breakpoint
CREATE INDEX `idx_conversations_first` ON `conversations` (`first`);--> statement-breakpoint
CREATE INDEX `idx_conversations_second` ON `conversations` (`second`);--> statement-breakpoint
CREATE TABLE `direct_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation` text NOT NULL,
	`sender` text NOT NULL,
	`body` text NOT NULL,
	`created` integer NOT NULL,
	FOREIGN KEY (`conversation`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sender`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_dm_conversation_created` ON `direct_messages` (`conversation`,`created`);