CREATE TABLE `carteira_historico` (
	`id` int AUTO_INCREMENT NOT NULL,
	`responsavelId` int NOT NULL,
	`acao` enum('filtro_salvo','atribuicao','redistribuicao') NOT NULL,
	`filtros` json NOT NULL,
	`saiuGrupos` int,
	`saiuLeads` int,
	`entrouGrupos` int,
	`entrouLeads` int,
	`usuarioId` int,
	`usuarioNome` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `carteira_historico_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `carteira_historico_responsavel_idx` ON `carteira_historico` (`responsavelId`,`createdAt`);