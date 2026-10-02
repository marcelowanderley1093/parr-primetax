CREATE TABLE `empresas` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cnpj` varchar(14) NOT NULL,
	`razaoSocial` varchar(255),
	`nomeFantasia` varchar(255),
	`situacaoCadastral` varchar(20),
	`regimeTributario` varchar(60),
	`porte` varchar(40),
	`cnaePrincipal` varchar(7),
	`uf` varchar(2),
	`municipio` varchar(120),
	`totalDividasCentavos` bigint,
	`qtdInscricoes` int,
	`dados` json,
	`brutoCsv` json,
	`brutoApi` json,
	`csvAtualizadoEm` timestamp,
	`apiAtualizadoEm` timestamp,
	`syncStatus` enum('pendente','ok','nao_encontrado','erro'),
	`syncErro` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `empresas_id` PRIMARY KEY(`id`),
	CONSTRAINT `empresas_cnpj_unique` UNIQUE(`cnpj`)
);
--> statement-breakpoint
CREATE TABLE `integracao_consultas` (
	`id` int AUTO_INCREMENT NOT NULL,
	`integracao` varchar(40) NOT NULL,
	`cnpj` varchar(14),
	`resultado` enum('ok','nao_encontrado','erro','limite') NOT NULL,
	`httpStatus` int,
	`userId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `integracao_consultas_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `lead_contatos` (
	`id` int AUTO_INCREMENT NOT NULL,
	`leadId` int NOT NULL,
	`pessoaNome` varchar(255),
	`pessoaCpf` varchar(11),
	`tipo` enum('telefone','email') NOT NULL,
	`valor` varchar(320) NOT NULL,
	`origem` enum('edital','manual','empresaqui','base_anterior') NOT NULL,
	`status` enum('nao_testado','atende','whatsapp','numero_errado','nao_e_o_socio') NOT NULL DEFAULT 'nao_testado',
	`observacao` text,
	`atualizadoPorUserId` int,
	`atualizadoPorNome` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `lead_contatos_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `leads` ADD `empresaId` int;--> statement-breakpoint
ALTER TABLE `leads` ADD `cpf` varchar(11);--> statement-breakpoint
CREATE INDEX `empresas_syncStatus_idx` ON `empresas` (`syncStatus`);--> statement-breakpoint
CREATE INDEX `integracao_consultas_integracao_createdAt_idx` ON `integracao_consultas` (`integracao`,`createdAt`);--> statement-breakpoint
CREATE INDEX `lead_contatos_leadId_idx` ON `lead_contatos` (`leadId`);--> statement-breakpoint
CREATE INDEX `leads_empresaId_idx` ON `leads` (`empresaId`);