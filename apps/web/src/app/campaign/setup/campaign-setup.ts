import { Component, ChangeDetectionStrategy, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { NewCampaignState } from '../new-campaign-state';
import { GameSystem } from '../../models/common.model';
import { CHAOS_CAMPAIGNS, type ChaosCampaign } from './chaos-campaigns';
import { eraCardByName, toCampaignEra } from '../era/eras';

/**
 * DIRECTIVE-108 — Campaign Setup card. The new FIRST wizard step (route /campaign/new/setup), shown after
 * Create Campaign OR Quick Mission, before Era. Three control groups: Game System (relocated D-083),
 * Campaign System (Traditional | Hot Spots), and — only under Hot Spots — the data-driven Hot Spot campaign
 * list. Proceed → /campaign/new/era (the existing flow continues unchanged for both choices this phase).
 */
@Component({
    selector: 'bce-campaign-setup',
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './campaign-setup.html',
    styleUrl: './campaign-setup.scss',
})
export class CampaignSetupComponent {
    private readonly router = inject(Router);
    private readonly state = inject(NewCampaignState);

    protected readonly GameSystem = GameSystem;
    protected readonly campaigns = CHAOS_CAMPAIGNS;

    protected readonly gameSystem = this.state.gameSystem;
    protected readonly campaignSystem = this.state.campaignSystem;
    protected readonly hotSpotCampaign = this.state.hotSpotCampaign;
    protected readonly quick = this.state.quickMission; // D-067 — crumb reflects Quick Mission vs Create campaign
    protected readonly gmSession = this.state.gmSession; // GM-1 P1 — a GM session IS a Hot Spots campaign; the choice locks

    constructor() {
        // GM-1 P1 — the GM door pre-commits the system: a Game Master session is a Hot Spots campaign by
        // definition (the directive's "everything a HS campaign has, it has"). Pre-select + lock; a plain
        // Create (gmSession false) is byte-identical to before.
        if (this.state.gmSession()) this.state.setCampaignSystem('hotspots');
    }

    protected setGameSystem(gs: GameSystem): void {
        this.state.setGameSystem(gs);
    }
    protected setCampaignSystem(m: 'traditional' | 'hotspots'): void {
        if (this.state.gmSession() && m !== 'hotspots') return; // GM-1 — locked to Hot Spots in a GM session
        this.state.setCampaignSystem(m);
    }
    protected pickCampaign(c: ChaosCampaign): void {
        if (c.available) this.state.setHotSpotCampaign(c.id);
    }

    /** The currently-selected Hot Spot campaign object (null under Traditional or none picked). */
    protected readonly selectedCampaign = computed<ChaosCampaign | null>(() => {
        if (this.campaignSystem() !== 'hotspots') return null;
        return this.campaigns.find((c) => c.id === this.hotSpotCampaign()) ?? null;
    });

    /** The era name a selected era-locked campaign pins the campaign to (resolved against the canonical era
     *  list), else null — drives the "… era — set by this campaign" chip. */
    protected readonly lockedEra = computed<string | null>(() => {
        const c = this.selectedCampaign();
        if (!c || !c.eraLocked || !c.era) return null;
        return eraCardByName(c.era)?.name ?? null;
    });

    /** Proceed enabled once a Campaign System is chosen; if Hot Spots, an AVAILABLE campaign must also be chosen. */
    protected readonly canProceed = computed(() => {
        const m = this.campaignSystem();
        if (!m) return false;
        if (m === 'hotspots') {
            const id = this.hotSpotCampaign();
            return !!id && this.campaigns.some((c) => c.id === id && c.available);
        }
        return true;
    });

    protected back(): void {
        void this.router.navigate(['/']);
    }
    protected proceed(): void {
        if (!this.canProceed()) return;
        // D-108b — an era-locked Hot Spot campaign seeds its era and SKIPS the Era step (date-force's guard
        // passes because era is now set). Generic Hot Spots + Traditional still pick the era on the Era step.
        const c = this.selectedCampaign();
        if (c?.eraLocked && c.era) {
            const eraCard = eraCardByName(c.era);
            if (eraCard) {
                this.state.setEra(toCampaignEra(eraCard));
                // D-113 — a full Hot Spots campaign (not Quick Mission) forks to the Mercenary Command step; the
                // era-locked campaign already skipped the Era step (era is set above), so route straight there.
                const fullHotspots = this.state.campaignSystem() === 'hotspots' && !this.state.quickMission();
                void this.router.navigate([fullHotspots ? '/campaign/new/merc-command' : '/campaign/new/date-force']);
                return;
            }
        }
        void this.router.navigate(['/campaign/new/era']);
    }
}
