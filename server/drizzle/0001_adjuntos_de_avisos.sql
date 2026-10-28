PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_received_attachments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`received_email_id` integer NOT NULL,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`content` blob NOT NULL,
	`classification` text,
	`extracted_cuit` text,
	`extracted_amount_cents` integer,
	`extracted_amount_raw` text,
	`error_message` text,
	FOREIGN KEY (`received_email_id`) REFERENCES `received_emails`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_received_attachments`("id", "received_email_id", "filename", "mime_type", "content", "classification", "extracted_cuit", "extracted_amount_cents", "extracted_amount_raw", "error_message") SELECT "id", "received_email_id", "filename", "mime_type", "content", "classification", "extracted_cuit", "extracted_amount_cents", "extracted_amount_raw", "error_message" FROM `received_attachments`;--> statement-breakpoint
DROP TABLE `received_attachments`;--> statement-breakpoint
ALTER TABLE `__new_received_attachments` RENAME TO `received_attachments`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `received_attachments_email_idx` ON `received_attachments` (`received_email_id`);