import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { IS_PUBLIC_KEY, type AuthedRequest } from './auth.types';
import { SESSION_COOKIE, setSessionCookie } from './session-cookie';

// active user never hits the cliff (and a guest keeps a live handle to regenerate its recovery code).
const REFRESH_WHEN_WITHIN_MS = 2 * 24 * 60 * 60 * 1000;

export function extractToken(req: AuthedRequest): string | undefined {
    const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies;
    if (cookies?.[SESSION_COOKIE]) return cookies[SESSION_COOKIE];
    const header = req.headers['authorization'];
    if (typeof header === 'string' && header.startsWith('Bearer ')) return header.slice(7);
    return undefined;
}

@Injectable()
export class ApprovedGmGuard implements CanActivate {
    constructor(
        private readonly auth: AuthService,
        private readonly reflector: Reflector,
    ) {}

    canActivate(ctx: ExecutionContext): boolean {
        if (ctx.getType() !== 'http') return true; // P1 gates HTTP only; sockets are P3
        if (!AuthService.authRequired()) return true; // local/dev/LAN — open, behavior unchanged
        const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()]);
        if (isPublic) return true;

        const req = ctx.switchToHttp().getRequest<AuthedRequest>();
        const token = extractToken(req);
        const user = this.auth.userFromToken(token);
        if (!user) throw new UnauthorizedException('sign in required');
        // DEPLOY-003: the per-request status check IS the live ban — a user banned mid-session is blocked on
        // their very next HTTP request (banned !== approved → 403), no re-login needed.
        if (user.status !== 'approved') {
            throw new ForbiddenException({ message: 'account not approved', status: user.status });
        }
        req.user = user;
        this.auth.touchSeen(user.id); // refresh lastSeen (throttled in the store)
        // 7-day cookie (same secret, same {sub}). Only near expiry → not on every request; idempotent (after a
        // refresh the token is >2d out, so it won't re-fire until it nears the new expiry). Cookie-session only.
        const exp = this.auth.tokenExpiryMs(token);
        if (exp != null && exp - Date.now() < REFRESH_WHEN_WITHIN_MS) {
            setSessionCookie(ctx.switchToHttp().getResponse<Response>(), this.auth.issueToken(user));
        }
        return true;
    }
}

@Injectable()
export class AdminGuard implements CanActivate {
    constructor(private readonly auth: AuthService) {}

    canActivate(ctx: ExecutionContext): boolean {
        const req = ctx.switchToHttp().getRequest<AuthedRequest>();
        const user = req.user ?? this.auth.userFromToken(extractToken(req));
        if (!user) throw new UnauthorizedException('sign in required');
        if (user.role !== 'admin') throw new ForbiddenException('admin only');
        if (user.status !== 'approved') throw new ForbiddenException('admin access revoked'); // DEPLOY-003: a banned admin is locked out too
        req.user = user;
        this.auth.touchSeen(user.id);
        return true;
    }
}
