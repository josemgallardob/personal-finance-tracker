CREATE TABLE `__saved_transaction_tag` (
	`transaction_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`workspace_id` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__saved_transaction_tag`("transaction_id", "tag_id", "workspace_id") SELECT "transaction_id", "tag_id", "workspace_id" FROM `transaction_tag`;--> statement-breakpoint
DROP TABLE `transaction_tag`;--> statement-breakpoint
CREATE TABLE `__new_transaction` (
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
	CONSTRAINT "transaction_type_is_supported" CHECK("__new_transaction"."type" IN ('expense', 'income')),
	CONSTRAINT "transaction_amount_minor_is_accepted" CHECK(typeof("__new_transaction"."amount_minor") = 'integer' and "__new_transaction"."amount_minor" >= 1 and "__new_transaction"."amount_minor" <= 99999999999),
	CONSTRAINT "transaction_date_is_iso_day" CHECK("__new_transaction"."date" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);
--> statement-breakpoint
INSERT INTO `__new_transaction`("id", "workspace_id", "type", "amount_minor", "date", "category_id", "concept", "note", "created_at", "updated_at") SELECT "id", "workspace_id", "type", "amount_minor", "date", "category_id", "concept", "note", "created_at", "updated_at" FROM `transaction`;--> statement-breakpoint
DROP TABLE `transaction`;--> statement-breakpoint
ALTER TABLE `__new_transaction` RENAME TO `transaction`;--> statement-breakpoint
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
INSERT INTO `transaction_tag`("transaction_id", "tag_id", "workspace_id") SELECT "transaction_id", "tag_id", "workspace_id" FROM `__saved_transaction_tag`;--> statement-breakpoint
DROP TABLE `__saved_transaction_tag`;--> statement-breakpoint
CREATE INDEX `transaction_tag_tag_transaction_idx` ON `transaction_tag` (`tag_id`,`transaction_id`);
