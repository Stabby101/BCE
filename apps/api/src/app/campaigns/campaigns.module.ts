import { Module } from '@nestjs/common';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { WriterTokenService } from './writer-token.service';

@Module({
    controllers: [CampaignsController],
    providers: [CampaignsService, WriterTokenService],
    exports: [CampaignsService, WriterTokenService],
})
export class CampaignsModule {}
