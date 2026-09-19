import type { Routes } from '@angular/router';
import { PlayerJoinComponent } from './player-join';
import { PlayerRosterComponent } from './player-roster';
import { PlayerSheetComponent } from './player-sheet';
import { PlayerCompanyComponent } from './player-company';
import { LegalPageComponent } from '../shared/legal-page'; // COMPLIANCE-1 — /legal (standalone, no GM imports — isolation preserved)

export const playerRoutes: Routes = [
    { path: '', component: PlayerJoinComponent },
    { path: 'roster', component: PlayerRosterComponent },
    { path: 'sheet', component: PlayerSheetComponent },
    { path: 'company', component: PlayerCompanyComponent },
    { path: 'legal', component: LegalPageComponent }, // COMPLIANCE-1 — the Legal & Attribution page (player bundle)
    { path: '**', redirectTo: '' },
];
