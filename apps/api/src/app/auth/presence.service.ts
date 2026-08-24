/*
 * BCE multi-tenant (DEPLOY-010) — live PRESENCE: an in-memory, ref-counted set of AUTHED userIds currently
 * holding at least one socket connection (the claims gateway calls connect/disconnect). Ref-counted so a
 * user with 2 tabs counts as ONE online (onlineCount = distinct users). Ephemeral by design — it is NOT
 * persisted (a process restart resets it; lastSeen on the user row is the durable "last active"). Account-
 * less players (no token → no userId) are never counted.
 */
import { Injectable } from '@nestjs/common';

@Injectable()
export class PresenceService {
    private readonly refs = new Map<string, number>(); // userId -> live connection count

    connect(userId: string | null | undefined): void {
        if (!userId) return;
        this.refs.set(userId, (this.refs.get(userId) ?? 0) + 1);
    }
    disconnect(userId: string | null | undefined): void {
        if (!userId) return;
        const n = (this.refs.get(userId) ?? 0) - 1;
        if (n <= 0) this.refs.delete(userId);
        else this.refs.set(userId, n);
    }
    /** Distinct users online right now (2 tabs of one user = 1). */
    onlineCount(): number {
        return this.refs.size;
    }
    onlineIds(): string[] {
        return [...this.refs.keys()];
    }
}
