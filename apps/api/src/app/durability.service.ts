import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { UsersService } from './auth/users.service';
import { AuthService } from './auth/auth.service';
import { CampaignsService } from './campaigns/campaigns.service';

const WAS_POPULATED = 'durability.was_populated';
const SECRET_FP = 'durability.secret_fp';

@Injectable()
export class DurabilityService implements OnApplicationBootstrap {
    private readonly log = new Logger('Durability');

    constructor(
        private readonly users: UsersService,
        private readonly campaigns: CampaignsService,
    ) {}

    onApplicationBootstrap(): void {
        this.checkWipe();
        this.checkSecretFingerprint();
    }

    /** A3 — the DB-wiped smoke alarm. */
    private checkWipe(): void {
        const empty = this.users.total() === 0 && this.campaigns.totalCount() === 0;
        const wasPopulated = this.campaigns.getMeta(WAS_POPULATED) === '1';
        if (!empty) {
            if (!wasPopulated) this.campaigns.setMeta(WAS_POPULATED, '1'); // first non-empty boot — set the sentinel once
            return;
        }
        if (wasPopulated) {
            this.log.error('CRITICAL: DB appears WIPED — users + campaigns are both empty but this DB was previously populated. Check BCE_DB_PATH points at the persistent volume, or restore from a Railway backup.');
        }
    }

    /** B1 — the session-secret fingerprint alarm (stored fingerprint, never the secret). */
    private checkSecretFingerprint(): void {
        const fp = createHash('sha256').update(AuthService.sessionSecret()).digest('hex').slice(0, 12);
        const stored = this.campaigns.getMeta(SECRET_FP);
        if (!stored) {
            this.campaigns.setMeta(SECRET_FP, fp); // first boot — record the fingerprint
            return;
        }
        if (stored !== fp) {
            this.log.error('CRITICAL: SESSION SECRET CHANGED — the BCE_SESSION_SECRET fingerprint differs from the last boot. Every guest recovery code and all existing sessions are now INVALID. If this was not intentional, restore the previous secret; NEVER rotate BCE_SESSION_SECRET on a live deploy.');
            // update the stored fingerprint so the alarm fires ONCE per change, not every boot thereafter
            this.campaigns.setMeta(SECRET_FP, fp);
        }
    }
}
