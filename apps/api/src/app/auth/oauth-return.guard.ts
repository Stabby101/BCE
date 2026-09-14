/*
 * DIRECTIVE-GM-1c — the OAuth START guards. Each is the bare AuthGuard(provider) plus ONE thing: a `?returnTo=` on the
 * start route rides through the provider as the OAuth `state` (passport-oauth2 sends a string `state` verbatim and the
 * callback reads it back from `req.query.state` — no session store involved), so `completeOAuth` can land the browser
 * back where the sign-in began: the join page WITH its `campaign` + `engine` query string. A `returnTo` that the
 * open-redirect gate rejects becomes NO state (and the callback re-validates anyway — defence at both ends). With no
 * `returnTo` the request is byte-identical to the bare guard.
 */
import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard, type IAuthModuleOptions } from '@nestjs/passport';
import type { Request } from 'express';
import { frontendOrigins, safeReturnTo } from './return-to';

function returnState(ctx: ExecutionContext): IAuthModuleOptions | undefined {
    const req = ctx.switchToHttp().getRequest<Request>();
    const raw = (req.query as Record<string, unknown> | undefined)?.returnTo;
    if (typeof raw !== 'string' || !raw) return undefined;
    return safeReturnTo(raw, frontendOrigins(process.env.BCE_WEB_ORIGIN)) ? { state: raw } : undefined;
}

@Injectable()
export class GoogleReturnGuard extends AuthGuard('google') {
    override getAuthenticateOptions(ctx: ExecutionContext): IAuthModuleOptions | undefined {
        return returnState(ctx);
    }
}

@Injectable()
export class GitHubReturnGuard extends AuthGuard('github') {
    override getAuthenticateOptions(ctx: ExecutionContext): IAuthModuleOptions | undefined {
        return returnState(ctx);
    }
}
