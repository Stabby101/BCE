/*
 * BCE multi-tenant (DEPLOY-002 P1) — auth types + the @Public route marker.
 * GM accounts only; players stay account-less (ROLE-002). No passwords — OAuth/JWT only.
 */
import { SetMetadata } from '@nestjs/common';
import type { Request } from 'express';

// DEPLOY-009: 'guest' joins the role set — a login-free GM tier (the "+ guest" lane). A guest flows through
// the SAME ApprovedGmGuard + owner-scoping as a gm (the guard checks status only), differing solely in how it
// authenticates (a minted JWT + a recovery code) vs OAuth. Never an admin.
export type UserRole = 'admin' | 'gm' | 'guest';
// DEPLOY-003: 'banned' joins 'rejected' as a guard-blocked status (distinct cause; reinstate → 'approved').
export type UserStatus = 'pending' | 'approved' | 'rejected' | 'banned';
// DEPLOY-009: 'guest' provider for the login-free tier (no OAuth identity — providerUserId = the user id).
export type OAuthProvider = 'google' | 'github' | 'dev' | 'guest';

export interface User {
    id: string;
    provider: OAuthProvider;
    providerUserId: string;
    email: string | null;
    displayName: string | null;
    role: UserRole;
    status: UserStatus;
    createdAt: number;
    lastSeen?: number; // DEPLOY-003: last authenticated request (the directory's "last seen")
    linkedTo?: string | null; // LINK-1: set on a GUEST retired by an upgrade → the durable account id it merged into (dormant, not deleted; recovery no longer resolves)
}

// ── DEPLOY-003 (T-039) — append-only governance audit ──
// DEPLOY-009: 'recover' = a guest re-binding a new device. DEPLOY-010: 'campaign_created' = an operational
// event in the activity feed (guest mint = 'register'/guest, recovery = 'recover' are already audited).
// LINK-1: 'link' = a guest upgraded to a durable (OAuth) account; their campaigns were re-owned to it.
export type AuditAction = 'login' | 'register' | 'approve' | 'reject' | 'ban' | 'unban' | 'role_change' | 'remove' | 'recover' | 'campaign_created' | 'link' | 'grant' | 'revoke'; // ODM-1: feature-grant governance

// DEPLOY-010 — the admin dashboard's at-a-glance metrics (GET /api/admin/stats, AdminGuard).
export interface AdminStats {
    totalUsers: number;
    byStatus: Record<UserStatus, number>;
    byRole: Record<UserRole, number>; // incl. guest
    activeNow: number; // distinct authed users with a live socket (ephemeral presence)
    activeToday: number; // lastSeen within 24h
    active7d: number; // lastSeen within 7d
    newToday: number; // registered within 24h
    new7d: number; // registered within 7d
    totalCampaigns: number;
}
export interface AuditEntry {
    id: string;
    ts: number;
    actorUserId: string | null; // who did it (the admin, or the user themselves for login/register)
    action: AuditAction;
    targetUserId: string | null; // who it was done to
    detail: string | null; // e.g. provider, or 'gm→admin'
    ip: string | null;
}
export interface AuditFilter {
    user?: string; // matches actor OR target
    action?: AuditAction;
    from?: number;
    to?: number;
    limit?: number;
}

/** A normalized identity from an OAuth callback (or the flag-gated dev-login). */
export interface OAuthProfile {
    provider: OAuthProvider;
    providerUserId: string;
    email: string | null;
    displayName: string | null;
}

export interface JwtPayload {
    sub: string; // the user id
}

/** Routes marked @Public() skip the global ApprovedGmGuard (login flow, /me, catalog, health). */
export const IS_PUBLIC_KEY = 'bce:isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export interface AuthedRequest extends Request {
    user?: User;
}
