CREATE TABLE `category` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`type` text NOT NULL,
	`sort_order` integer NOT NULL,
	`archived_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "category_type_is_supported" CHECK("category"."type" IN ('expense', 'income')),
	CONSTRAINT "category_sort_order_is_non_negative" CHECK("category"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `category_id_workspace_unique` ON `category` (`id`,`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `category_id_type_unique` ON `category` (`id`,`type`);--> statement-breakpoint
CREATE UNIQUE INDEX `category_active_normalized_name_unique` ON `category` (`workspace_id`,`type`,`normalized_name`) WHERE "category"."archived_at" is null;--> statement-breakpoint
CREATE INDEX `category_normalized_name_idx` ON `category` (`workspace_id`,`type`,`normalized_name`);--> statement-breakpoint
CREATE TABLE `tag` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`archived_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tag_id_workspace_unique` ON `tag` (`id`,`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `tag_active_normalized_name_unique` ON `tag` (`workspace_id`,`normalized_name`) WHERE "tag"."archived_at" is null;--> statement-breakpoint
CREATE INDEX `tag_normalized_name_idx` ON `tag` (`workspace_id`,`normalized_name`);--> statement-breakpoint
CREATE TABLE `transaction` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`type` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`date` text NOT NULL,
	`category_id` text NOT NULL,
	`concept` text,
	`note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`,`workspace_id`) REFERENCES `category`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`,`type`) REFERENCES `category`(`id`,`type`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "transaction_type_is_supported" CHECK("transaction"."type" IN ('expense', 'income')),
	CONSTRAINT "transaction_amount_minor_is_accepted" CHECK("transaction"."amount_minor" >= 1 and "transaction"."amount_minor" <= 99999999999),
	CONSTRAINT "transaction_date_is_iso_day" CHECK("transaction"."date" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transaction_id_workspace_unique` ON `transaction` (`id`,`workspace_id`);--> statement-breakpoint
CREATE INDEX `transaction_workspace_date_idx` ON `transaction` (`workspace_id`,`date`);--> statement-breakpoint
CREATE INDEX `transaction_workspace_type_date_idx` ON `transaction` (`workspace_id`,`type`,`date`);--> statement-breakpoint
CREATE INDEX `transaction_category_date_idx` ON `transaction` (`category_id`,`date`);--> statement-breakpoint
CREATE TABLE `transaction_tag` (
	`transaction_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	PRIMARY KEY(`transaction_id`, `tag_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`transaction_id`,`workspace_id`) REFERENCES `transaction`(`id`,`workspace_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`,`workspace_id`) REFERENCES `tag`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `transaction_tag_tag_transaction_idx` ON `transaction_tag` (`tag_id`,`transaction_id`);