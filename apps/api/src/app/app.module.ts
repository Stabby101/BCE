import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CampaignsModule } from './campaigns/campaigns.module';
import { ClaimsModule } from './claims/claims.module';
import { CatalogModule } from './catalog/catalog.module';
import { AuthModule } from './auth/auth.module';
import { DurabilityService } from './durability.service';

@Module({
  imports: [CampaignsModule, ClaimsModule, CatalogModule, AuthModule], // + DEPLOY-002 P1 GM auth/approval gate
  controllers: [AppController],
  providers: [AppService, DurabilityService],
})
export class AppModule {}
