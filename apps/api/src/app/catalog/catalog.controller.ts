/*
 * BCE Inventory I (DIRECTIVE-055, T-037 slice 1) — the read-only CATALOG REST surface.
 *   GET /api/catalog?era=YYYY&category=...&techBase=IS|Clan|All   → era-legal, filtered rows
 *   GET /api/catalog/stats                                        → row counts (total/source/category)
 *   GET /api/catalog/:id/cost?tons=&rating=                       → flat or formula-scaled cost
 *   GET /api/catalog/:id                                          → one row
 * Read-only by design — the frontend never writes the catalog (DATA-002). Static routes are declared
 * before ':id' so they win the match.
 */
import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { Public } from '../auth/auth.types';

@Public() // DEPLOY-002 P2: the catalog is GLOBAL/shared read-only reference (not per-owner / not gated)
@Controller('catalog')
export class CatalogController {
    constructor(private readonly svc: CatalogService) {}

    @Get()
    list(@Query('era') era?: string, @Query('category') category?: string, @Query('techBase') techBase?: string) {
        return this.svc.list({ era: era != null && era !== '' ? parseInt(era, 10) : undefined, category, techBase });
    }

    @Get('stats')
    stats() {
        return this.svc.stats();
    }

    @Get(':id/cost')
    cost(@Param('id') id: string, @Query('tons') tons?: string, @Query('rating') rating?: string) {
        const r = this.svc.cost(id, {
            tons: tons != null && tons !== '' ? parseFloat(tons) : undefined,
            rating: rating != null && rating !== '' ? parseInt(rating, 10) : undefined,
        });
        if (!r) throw new NotFoundException(`catalog entry '${id}' not found`);
        return r;
    }

    @Get(':id')
    get(@Param('id') id: string) {
        const r = this.svc.get(id);
        if (!r) throw new NotFoundException(`catalog entry '${id}' not found`);
        return r;
    }
}
