/* BCE Inventory I (DIRECTIVE-055, T-037 slice 1) — the catalog module (read-only component catalog). */
import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';

@Module({
    controllers: [CatalogController],
    providers: [CatalogService],
})
export class CatalogModule {}
