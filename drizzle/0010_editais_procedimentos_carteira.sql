CREATE TABLE `editais` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ano` int NOT NULL,
	`numero` varchar(20) NOT NULL,
	`dataPublicacao` date NOT NULL,
	`arquivoOrigem` varchar(255),
	`qtdRegistros` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `editais_id` PRIMARY KEY(`id`),
	CONSTRAINT `editais_ano_numero_unique` UNIQUE(`ano`,`numero`)
);
--> statement-breakpoint
CREATE TABLE `lead_procedimentos` (
	`id` int AUTO_INCREMENT NOT NULL,
	`leadId` int NOT NULL,
	`editalId` int NOT NULL,
	`numeroProcedimento` varchar(20) NOT NULL,
	`cpfParcial` varchar(20),
	`pagina` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `lead_procedimentos_id` PRIMARY KEY(`id`),
	CONSTRAINT `lead_procedimentos_numeroProcedimento_unique` UNIQUE(`numeroProcedimento`)
);
--> statement-breakpoint
ALTER TABLE `leads` ADD `cpfParcial` varchar(20);--> statement-breakpoint
ALTER TABLE `leads` ADD `grupoId` int;--> statement-breakpoint
ALTER TABLE `leads` ADD `primeiraPublicacao` date;--> statement-breakpoint
ALTER TABLE `leads` ADD `ultimaPublicacao` date;--> statement-breakpoint
ALTER TABLE `leads` ADD `responsavelId` int;--> statement-breakpoint
ALTER TABLE `leads` ADD `atribuidoEm` timestamp;--> statement-breakpoint
ALTER TABLE `leads` ADD `arquivadoEm` timestamp;--> statement-breakpoint
ALTER TABLE `leads` ADD `arquivadoMotivo` varchar(60);--> statement-breakpoint
ALTER TABLE `leads` ADD `arquivadoPorId` int;--> statement-breakpoint
CREATE INDEX `lead_procedimentos_leadId_idx` ON `lead_procedimentos` (`leadId`);--> statement-breakpoint
CREATE INDEX `lead_procedimentos_editalId_idx` ON `lead_procedimentos` (`editalId`);--> statement-breakpoint
CREATE INDEX `leads_status_idx` ON `leads` (`status`);--> statement-breakpoint
CREATE INDEX `leads_responsavelId_idx` ON `leads` (`responsavelId`);--> statement-breakpoint
CREATE INDEX `leads_grupoId_idx` ON `leads` (`grupoId`);--> statement-breakpoint
CREATE INDEX `leads_ultimaPublicacao_idx` ON `leads` (`ultimaPublicacao`);--> statement-breakpoint
CREATE INDEX `leads_cnpj_idx` ON `leads` (`cnpj`);--> statement-breakpoint
CREATE INDEX `leads_nome_idx` ON `leads` (`nome`);