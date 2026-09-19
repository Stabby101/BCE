import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app/app.module';
import { AuthService, DEV_FALLBACK_SECRET } from './app/auth/auth.service';

// DEPLOY-002 P1: fail fast if the gate is required but the session secret is missing — never run a
// gated server signing sessions with the insecure dev fallback. Secrets are read from env ONLY.
function checkAuthConfig(): void {
  const required = process.env.BCE_AUTH_REQUIRED === '1';
  if (required && !process.env.BCE_SESSION_SECRET) {
    Logger.error('BCE_AUTH_REQUIRED=1 but BCE_SESSION_SECRET is not set — refusing to start a gated server.');
    process.exit(1);
  }
  // BCE_SESSION_SECRET permanently invalidates every guest recovery code (HMAC'd under it) + logs everyone
  // out. A hosted deploy running without a real secret (or on the insecure dev fallback) is CRITICAL even if
  // the gate happens to be off. The fingerprint-change alarm (fires when the value differs from the last boot)
  // lives in DurabilityService, which has the DB. Log-only — never abort a running server on this.
  if (AuthService.isHosted() && (!process.env.BCE_SESSION_SECRET || process.env.BCE_SESSION_SECRET === DEV_FALLBACK_SECRET)) {
    Logger.error('CRITICAL: hosted deploy with no BCE_SESSION_SECRET (or the insecure dev fallback) — all guest recovery codes + sessions depend on a stable secret; set a strong, PERMANENT BCE_SESSION_SECRET.');
  }
  Logger.log(`auth: ${required ? 'REQUIRED (multi-tenant gate ON)' : 'open (single-tenant/dev)'} · google=${process.env.BCE_GOOGLE_CLIENT_ID ? 'configured' : 'off'} · github=${process.env.BCE_GITHUB_CLIENT_ID ? 'configured' : 'off'}`);
  if (process.env.BCE_ALLOW_DEV_LOGIN === '1') Logger.warn('BCE_ALLOW_DEV_LOGIN=1 — the dev-login test seam is ENABLED (never enable in production).');
}

async function bootstrap() {
  checkAuthConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);

  // client IP from X-Forwarded-For, not the edge address. The /api/auth/recover + regenerate throttles key
  // on req.ip, so without this they'd rate-limit per-EDGE (all clients share one bucket) instead of per-client.
  app.set('trust proxy', 1);

  app.use(cookieParser()); // DEPLOY-002 P1: read the bce_session JWT cookie

  // a deep campaign blob (pilots + mission tree + bays + intel) can exceed the 100kb default
  app.useBodyParser('json', { limit: '25mb' });

  const lan = process.env.BCE_HOST === '0.0.0.0' || process.env.BCE_LAN === '1';
  const localOrigins = [/^https?:\/\/localhost(:\d+)?$/, /^https?:\/\/127\.0\.0\.1(:\d+)?$/];
  // HOSTED: an explicit frontend origin (comma-separated) → allow it + localhost (not reflect-all).
  // Dev default unchanged: no BCE_WEB_ORIGIN + no LAN → localhost-only; LAN → reflect the origin.
  const webOrigins = (process.env.BCE_WEB_ORIGIN ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  app.enableCors({
    origin: webOrigins.length ? [...localOrigins, ...webOrigins] : lan ? true : localOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true, // DEPLOY-002: the session cookie flows cross-origin (Pages ↔ Railway)
  });

  const port = process.env.PORT || 3000;
  const host = process.env.BCE_HOST || '127.0.0.1'; // localhost-first; BCE_HOST=0.0.0.0 for LAN
  await app.listen(port, host);
  Logger.log(`🚀 BCE host record on http://${host}:${port}/${globalPrefix}${lan ? ' (LAN-exposed)' : ''}`);
}

bootstrap();
