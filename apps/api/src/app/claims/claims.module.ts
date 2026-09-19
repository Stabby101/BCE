import { Module } from '@nestjs/common';
import { ClaimsService } from './claims.service';
import { LobbyService } from './lobby.service';
import { BattleStateService } from './battle-state.service';
import { FavoritesService } from './favorites.service';
import { SeatLedgerService } from './seat-ledger.service'; // ORDER-13 — the server-written seat ledger
import { ClaimsGateway } from './claims.gateway';
import { AuthModule } from '../auth/auth.module';
import { CampaignsModule } from '../campaigns/campaigns.module';

@Module({
    imports: [AuthModule, CampaignsModule], // DEPLOY-002 P2: AuthService + CampaignsService for the gateway ownership gate
    providers: [ClaimsService, LobbyService, BattleStateService, FavoritesService, SeatLedgerService, ClaimsGateway],
})
export class ClaimsModule {}
