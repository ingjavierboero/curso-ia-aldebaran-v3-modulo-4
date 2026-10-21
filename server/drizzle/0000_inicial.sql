CREATE TABLE `arca_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`service` text NOT NULL,
	`token` text NOT NULL,
	`sign` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `arca_tokens_service_unique` ON `arca_tokens` (`service`);--> statement-breakpoint
CREATE TABLE `billing_periods` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`period` text NOT NULL,
	`status` text NOT NULL,
	`triggered_by` text,
	`started_at` text,
	`completed_at` text,
	`cancelled_by_user_id` integer,
	`cancelled_at` text,
	`reactivated_by_user_id` integer,
	`reactivated_at` text,
	FOREIGN KEY (`cancelled_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reactivated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_periods_period_unique` ON `billing_periods` (`period`);--> statement-breakpoint
CREATE TABLE `client_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`actor_type` text NOT NULL,
	`user_id` integer,
	`occurred_at` text NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `client_events_client_idx` ON `client_events` (`client_id`);--> statement-breakpoint
CREATE TABLE `client_products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`product_id` integer NOT NULL,
	`assigned_at` text NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `client_products_client_product_unique` ON `client_products` (`client_id`,`product_id`);--> statement-breakpoint
CREATE TABLE `clients` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`business_name` text NOT NULL,
	`cuit` text NOT NULL,
	`address` text NOT NULL,
	`billing_email` text NOT NULL,
	`billing_email_normalized` text NOT NULL,
	`iva_condition` integer,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clients_cuit_unique` ON `clients` (`cuit`);--> statement-breakpoint
CREATE UNIQUE INDEX `clients_billing_email_normalized_unique` ON `clients` (`billing_email_normalized`);--> statement-breakpoint
CREATE TABLE `exchange_rates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rate_cents` integer NOT NULL,
	`source` text NOT NULL,
	`read_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `fallback_alerts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`exchange_rate_id` integer NOT NULL,
	`used_at` text NOT NULL,
	`confirmed_by_user_id` integer,
	`confirmed_at` text,
	FOREIGN KEY (`exchange_rate_id`) REFERENCES `exchange_rates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`confirmed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `invoice_emails` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL,
	`received_email_id` integer NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`received_email_id`) REFERENCES `received_emails`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_emails_invoice_email_unique` ON `invoice_emails` (`invoice_id`,`received_email_id`);--> statement-breakpoint
CREATE TABLE `invoice_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL,
	`product_id` integer,
	`description` text NOT NULL,
	`original_price_cents` integer NOT NULL,
	`original_currency` text NOT NULL,
	`amount_cents` integer NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `invoice_items_invoice_idx` ON `invoice_items` (`invoice_id`);--> statement-breakpoint
CREATE TABLE `invoice_status_changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL,
	`from_status` text NOT NULL,
	`to_status` text NOT NULL,
	`previous_reason` text,
	`reason` text,
	`actor_type` text NOT NULL,
	`user_id` integer,
	`received_email_id` integer,
	`changed_at` text NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`received_email_id`) REFERENCES `received_emails`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `invoice_status_changes_invoice_idx` ON `invoice_status_changes` (`invoice_id`);--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`period` text NOT NULL,
	`point_of_sale` integer NOT NULL,
	`voucher_type` integer DEFAULT 11 NOT NULL,
	`number` integer,
	`issue_date` text NOT NULL,
	`service_from` text NOT NULL,
	`service_to` text NOT NULL,
	`due_date` text NOT NULL,
	`total_cents` integer NOT NULL,
	`cae` text,
	`cae_due_date` text,
	`iva_condition` integer NOT NULL,
	`exchange_rate_id` integer,
	`client_snapshot` text NOT NULL,
	`issuer_snapshot` text NOT NULL,
	`status` text NOT NULL,
	`manual_review_reason` text,
	`arca_attempt_at` text,
	`arca_request` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`exchange_rate_id`) REFERENCES `exchange_rates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_client_period_unique` ON `invoices` (`client_id`,`period`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_point_of_sale_number_unique` ON `invoices` (`point_of_sale`,`number`);--> statement-breakpoint
CREATE INDEX `invoices_status_idx` ON `invoices` (`status`);--> statement-breakpoint
CREATE TABLE `mailbox_checks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`success` integer,
	`emails_detected` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`received_email_id` integer NOT NULL,
	`status` text NOT NULL,
	`reviewed_by_user_id` integer,
	`reviewed_at` text,
	FOREIGN KEY (`received_email_id`) REFERENCES `received_emails`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notices_received_email_id_unique` ON `notices` (`received_email_id`);--> statement-breakpoint
CREATE TABLE `password_reset_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token_hash` text NOT NULL,
	`user_id` integer NOT NULL,
	`sent_at` text NOT NULL,
	`used_at` text,
	`invalidated_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `password_reset_tokens_token_hash_unique` ON `password_reset_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `password_reset_tokens_user_idx` ON `password_reset_tokens` (`user_id`);--> statement-breakpoint
CREATE TABLE `process_errors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`operation` text NOT NULL,
	`client_id` integer,
	`period` text,
	`invoice_id` integer,
	`payload` text,
	`attempts` integer NOT NULL,
	`last_error_message` text NOT NULL,
	`status` text NOT NULL,
	`resolved_by` text,
	`resolved_by_user_id` integer,
	`resolved_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resolved_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `process_errors_status_idx` ON `process_errors` (`status`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`price_cents` integer NOT NULL,
	`currency` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `received_attachments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`received_email_id` integer NOT NULL,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`content` blob NOT NULL,
	`classification` text NOT NULL,
	`extracted_cuit` text,
	`extracted_amount_cents` integer,
	`extracted_amount_raw` text,
	`error_message` text,
	FOREIGN KEY (`received_email_id`) REFERENCES `received_emails`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `received_attachments_email_idx` ON `received_attachments` (`received_email_id`);--> statement-breakpoint
CREATE TABLE `received_emails` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`message_id` text NOT NULL,
	`from_address` text NOT NULL,
	`from_normalized` text NOT NULL,
	`subject` text NOT NULL,
	`body_text` text NOT NULL,
	`received_at` text NOT NULL,
	`client_id` integer,
	`classification` text,
	`applied_rule` text,
	`processed_at` text NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `received_emails_message_id_unique` ON `received_emails` (`message_id`);--> statement-breakpoint
CREATE INDEX `received_emails_client_idx` ON `received_emails` (`client_id`);--> statement-breakpoint
CREATE TABLE `reminder_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`month` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reminder_runs_month_unique` ON `reminder_runs` (`month`);--> statement-breakpoint
CREATE TABLE `retry_queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`operation` text NOT NULL,
	`client_id` integer,
	`period` text,
	`invoice_id` integer,
	`payload` text,
	`attempt` integer NOT NULL,
	`next_attempt_at` text NOT NULL,
	`last_error` text NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `retry_queue_next_attempt_idx` ON `retry_queue` (`next_attempt_at`);--> statement-breakpoint
CREATE TABLE `sent_emails` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`trigger` text NOT NULL,
	`client_id` integer,
	`invoice_id` integer,
	`reminder_month` text,
	`to_address` text NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`sent_at` text NOT NULL,
	`sent_by_user_id` integer,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sent_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sent_emails_client_idx` ON `sent_emails` (`client_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token_hash` text NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` text NOT NULL,
	`last_activity_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`mailbox_interval_minutes` integer DEFAULT 15 NOT NULL,
	`billing_time` text DEFAULT '11:00' NOT NULL,
	`reminders_time` text DEFAULT '11:00' NOT NULL,
	`retry_count` integer DEFAULT 3 NOT NULL,
	`retry_wait_minutes` integer DEFAULT 5 NOT NULL,
	`point_of_sale` integer,
	`issuer_business_name` text,
	`issuer_address` text,
	`issuer_iva_condition` text,
	`issuer_gross_income_number` text,
	`issuer_activity_start_date` text,
	`issuer_trade_name` text
);
--> statement-breakpoint
CREATE TABLE `simulated_attachments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`simulated_email_id` integer NOT NULL,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`content` blob NOT NULL,
	FOREIGN KEY (`simulated_email_id`) REFERENCES `simulated_emails`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `simulated_attachments_email_idx` ON `simulated_attachments` (`simulated_email_id`);--> statement-breakpoint
CREATE TABLE `simulated_emails` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`direction` text NOT NULL,
	`message_id` text NOT NULL,
	`from_address` text NOT NULL,
	`from_name` text,
	`to_address` text NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	`loaded_by_user_id` integer,
	FOREIGN KEY (`loaded_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `simulated_emails_message_id_unique` ON `simulated_emails` (`message_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_normalized` text NOT NULL,
	`role` text NOT NULL,
	`status` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_normalized_unique` ON `users` (`email_normalized`);