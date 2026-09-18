ALTER TABLE `local_users` MODIFY COLUMN `passwordHash` varchar(255);--> statement-breakpoint
ALTER TABLE `local_users` MODIFY COLUMN `role` enum('comercial','admin') NOT NULL DEFAULT 'comercial';--> statement-breakpoint
ALTER TABLE `local_users` MODIFY COLUMN `active` int NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE `local_users` ADD `activationToken` varchar(255);--> statement-breakpoint
ALTER TABLE `local_users` ADD `activationTokenExpiry` timestamp;