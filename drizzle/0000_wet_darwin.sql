CREATE TABLE `channels` (
	`id` text PRIMARY KEY NOT NULL,
	`server` text NOT NULL,
	`name` text NOT NULL,
	`created` integer NOT NULL,
	FOREIGN KEY (`server`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_channels_server` ON `channels` (`server`);--> statement-breakpoint
CREATE TABLE `invites` (
	`code` text PRIMARY KEY NOT NULL,
	`server` text NOT NULL,
	`expires` integer NOT NULL,
	FOREIGN KEY (`server`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `members` (
	`server` text NOT NULL,
	`user` text NOT NULL,
	`joined` integer NOT NULL,
	PRIMARY KEY(`server`, `user`),
	FOREIGN KEY (`server`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_members_user` ON `members` (`user`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`channel` text NOT NULL,
	`user` text NOT NULL,
	`body` text NOT NULL,
	`created` integer NOT NULL,
	FOREIGN KEY (`channel`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_messages_channel_created` ON `messages` (`channel`,`created`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `servers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`owner` text NOT NULL,
	`created` integer NOT NULL
);
