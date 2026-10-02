CREATE TABLE `carteiras` (
	`id` int AUTO_INCREMENT NOT NULL,
	`responsavelId` int NOT NULL,
	`filtros` json NOT NULL,
	`atualizadoPorId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `carteiras_id` PRIMARY KEY(`id`),
	CONSTRAINT `carteiras_responsavelId_unique` UNIQUE(`responsavelId`)
);
--> statement-breakpoint
CREATE TABLE `lead_eventos` (
	`id` int AUTO_INCREMENT NOT NULL,
	`leadId` int NOT NULL,
	`tipo` enum('atribuido','devolvido','transferido','arquivado','reaberto') NOT NULL,
	`deResponsavelId` int,
	`paraResponsavelId` int,
	`motivo` varchar(500),
	`usuarioId` int,
	`usuarioNome` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `lead_eventos_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `lead_eventos_leadId_idx` ON `lead_eventos` (`leadId`);