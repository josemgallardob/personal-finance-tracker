CREATE TABLE `workspace` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "workspace_kind_is_personal" CHECK("workspace"."kind" = 'personal')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_kind_unique` ON `workspace` (`kind`);
--> statement-breakpoint
CREATE TABLE `preference` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`locale` text NOT NULL,
	`currency` text NOT NULL,
	`time_zone` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "preference_locale_is_es_es" CHECK("preference"."locale" = 'es-ES'),
	CONSTRAINT "preference_currency_is_eur" CHECK("preference"."currency" = 'EUR'),
	CONSTRAINT "preference_time_zone_is_madrid" CHECK("preference"."time_zone" = 'Europe/Madrid')
);
