CREATE TABLE `recurring_occurrence` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`recurring_rule_id` text NOT NULL,
	`scheduled_for` text NOT NULL,
	`transaction_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recurring_rule_id`,`workspace_id`) REFERENCES `recurring_rule`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`transaction_id`) REFERENCES `transaction`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "recurring_occurrence_scheduled_for_is_iso_day" CHECK("recurring_occurrence"."scheduled_for" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recurring_occurrence_rule_scheduled_for_unique` ON `recurring_occurrence` (`recurring_rule_id`,`scheduled_for`);--> statement-breakpoint
CREATE UNIQUE INDEX `recurring_occurrence_transaction_unique` ON `recurring_occurrence` (`transaction_id`) WHERE "recurring_occurrence"."transaction_id" is not null;--> statement-breakpoint
CREATE INDEX `recurring_occurrence_workspace_scheduled_for_idx` ON `recurring_occurrence` (`workspace_id`,`scheduled_for`);--> statement-breakpoint
CREATE TABLE `recurring_rule` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`source_transaction_id` text,
	`type` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`category_id` text NOT NULL,
	`concept` text,
	`note` text,
	`monthly_day` integer NOT NULL,
	`next_due_date` text NOT NULL,
	`template_version` integer NOT NULL,
	`deactivated_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_transaction_id`) REFERENCES `transaction`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`category_id`,`workspace_id`) REFERENCES `category`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`,`type`) REFERENCES `category`(`id`,`type`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "recurring_rule_type_is_supported" CHECK("recurring_rule"."type" IN ('expense', 'income')),
	CONSTRAINT "recurring_rule_amount_minor_is_accepted" CHECK(typeof("recurring_rule"."amount_minor") = 'integer' and "recurring_rule"."amount_minor" >= 1 and "recurring_rule"."amount_minor" <= 99999999999),
	CONSTRAINT "recurring_rule_monthly_day_is_accepted" CHECK(typeof("recurring_rule"."monthly_day") = 'integer' and "recurring_rule"."monthly_day" >= 1 and "recurring_rule"."monthly_day" <= 31),
	CONSTRAINT "recurring_rule_next_due_date_is_iso_day" CHECK("recurring_rule"."next_due_date" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "recurring_rule_template_version_is_accepted" CHECK(typeof("recurring_rule"."template_version") = 'integer' and "recurring_rule"."template_version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recurring_rule_id_workspace_unique` ON `recurring_rule` (`id`,`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `recurring_rule_active_source_unique` ON `recurring_rule` (`source_transaction_id`) WHERE "recurring_rule"."deactivated_at" is null;--> statement-breakpoint
CREATE INDEX `recurring_rule_active_due_idx` ON `recurring_rule` (`workspace_id`,`next_due_date`) WHERE "recurring_rule"."deactivated_at" is null;--> statement-breakpoint
CREATE TABLE `recurring_rule_tag` (
	`recurring_rule_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	PRIMARY KEY(`recurring_rule_id`, `tag_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recurring_rule_id`,`workspace_id`) REFERENCES `recurring_rule`(`id`,`workspace_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`,`workspace_id`) REFERENCES `tag`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `recurring_rule_tag_tag_rule_idx` ON `recurring_rule_tag` (`tag_id`,`recurring_rule_id`);