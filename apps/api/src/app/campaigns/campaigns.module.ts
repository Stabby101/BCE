/* BCE ENGINE slice 1 (DIRECTIVE-041) — the campaigns module (host record + REST). */
import { Module } from '@nestjs/common';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';

@Module({
    controllers: [CampaignsController],
    providers: [CampaignsService],
    exports: [CampaignsService], // DEPLOY-002 P2: the socket gateway reads ownership
})
export class CampaignsModule {}
