import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Public } from './auth/auth.types';
import { buildCommit } from './version';

@Public() // DEPLOY-002 P1: health/root is open
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getData() {
    return this.appService.getData();
  }

  /** HOTFIX-028 — the deployed build commit for the client version handshake (open; no secrets). */
  @Get('version')
  getVersion(): { commit: string } {
    return { commit: buildCommit() };
  }
}
