import { Injectable, effect, inject } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { CampaignSaveStore } from '../campaign-save-store';
import { ClaimRealtimeService } from '../claims/claim-realtime.service';
import { engagementKeyOf } from '../claims/engagement-key';

@Injectable({ providedIn: 'root' })
export class ForceImportService {
    private readonly state = inject(NewCampaignState);
    private readonly store = inject(CampaignSaveStore);
    private readonly rt = inject(ClaimRealtimeService);

    constructor() {
        // A gmSession GM device must be IN the room from dashboard load (the battle-force ensure pattern):
        // the import-request fan can only reach a joined socket — without this, a GM who never opened the
        // GM/Lobby tab would silently never receive a player's join-with-force.
        effect(() => {
            if (!this.state.gmSession()) return;
            const id = this.store.campaignId();
            const key = engagementKeyOf(this.state.missionTree());
            if (id) this.rt.ensure(id, key);
        });
        effect(() => {
            if (!this.rt.importRequests().length) return;
            if (!this.state.gmSession()) return; // GM sessions only — the fan is GM-scoped, this is the belt
            const req = this.rt.consumeImportRequest();
            if (!req) return;
            // idempotence: the server re-mints unique imp- ids, but a socket replay must not double-merge
            const existing = new Set((this.state.startingForce() ?? []).map((i) => i.instanceId));
            const fresh = req.units.filter((u) => !existing.has(u.instanceId));
            if (!fresh.length) return;
            this.state.setStartingForce([...(this.state.startingForce() ?? []), ...fresh]);
            const freshIds = new Set(fresh.map((u) => u.instanceId));
            const pilots = (req.pilots ?? []).filter((p) => !p.assignedInstanceId || freshIds.has(p.assignedInstanceId));
            if (pilots.length) this.state.setPilots([...(this.state.pilots() ?? []), ...pilots]);
            const today = this.state.currentDate() ?? this.state.startDate() ?? { y: 3151, m: 0, d: 1 };
            this.state.setCampaignLog([...(this.state.campaignLog() ?? []), {
                date: today,
                text: `Join-with-force — ${req.name || 'Player'} brought ${fresh.length} unit${fresh.length === 1 ? '' : 's'} (pre-claimed on the board)`,
                kind: 'admin' as const,
            }]);
            void this.store.persistCurrent(); // → the fan confirms to the importing player
        });
    }
}
