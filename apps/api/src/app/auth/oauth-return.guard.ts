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
