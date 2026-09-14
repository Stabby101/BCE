/*
 * BCE PLAYER routes (DIRECTIVE-048, phase A) — the hard-isolation boundary.
 * This table is the ONLY route map the player bundle ships. It imports the join screen and the
 * side roster and NOTHING from the GM dashboard, the campaign wizard, or MekBay's App. That is the
 * isolation: there is no route to the dashboard because the component is not in this graph (not a
 * guard that could be bypassed). grep this file for "dashboard" / "CampaignDashboard" — zero hits is
 * the proof (MERGE-002 + the directive's port-isolation). Phase B explodes the roster into the
 * single-screen live sheet; phases stay additive here.
 */
import type { Routes } from '@angular/router';
import { PlayerJoinComponent } from './player-join';
import { PlayerRosterComponent } from './player-roster';
import { PlayerSheetComponent } from './player-sheet';
import { PlayerCompanyComponent } from './player-company'; // ODM-18 P1
import { LegalPageComponent } from '../shared/legal-page'; // COMPLIANCE-1 — /legal (standalone, no GM imports — isolation preserved)

export const playerRoutes: Routes = [
    { path: '', component: PlayerJoinComponent },
    { path: 'roster', component: PlayerRosterComponent },
    { path: 'sheet', component: PlayerSheetComponent }, // D-048 phase B — the single-screen battle surface
    { path: 'company', component: PlayerCompanyComponent }, // ODM-18 P1 — the ODM company console
    { path: 'legal', component: LegalPageComponent }, // COMPLIANCE-1 — the Legal & Attribution page (player bundle)
    { path: '**', redirectTo: '' },
];
