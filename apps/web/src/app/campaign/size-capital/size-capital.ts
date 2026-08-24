/*
 * BCE retool — New Campaign, step 4: unit size + starting capital + resource level
 * (SCAFFOLD). DIRECTIVE-006 (size + capital) + DIRECTIVE-007 (resource level).
 * Pick a unit size (Single 'Mech → Regiment); capital presets scale with the size's
 * 'Mech count (+ write-in custom); the resource level (Lean / Normal / Established)
 * provides a DropShip scaled to the size. "Begin campaign" needs size + capital +
 * resources, then writes all three to the wizard state and advances to the campaign
 * dashboard. No persistence yet — that is a later directive; this only assembles the choice.
 */
import { Component, ChangeDetectionStrategy, computed, signal, inject } from '@angular/core';
import { Router } from '@angular/router';
import { NewCampaignState, type CampaignCapital, type CampaignUnitSize } from '../new-campaign-state';
import { CampaignSaveStore } from '../campaign-save-store';
import { WarchestService } from '../chaos/warchest.service'; // D-109 — seed the Warchest for a Hot Spots campaign
import { ContractMarketService } from '../contract/contract-market.service';
import { OrdersService } from '../orders/orders.service';
import { ForceGeneratorService } from '../force/force-generator.service';
import { PilotService } from '../barracks/pilot.service';
import { RESOURCE_TIERS, shipForSize, type ResourceLine } from './resources';
import { capitalSystemIdFor } from '../star/star-capitals';

interface SizeDef {
    id: string;
    name: string;
    count: number; // 'Mech count — drives capital scaling
    clan: string;  // Clan-equivalent note (display only)
}

// Unit sizes (IS naming; Clan equivalent noted). Mirrors the v1 mockup.
const SIZES: readonly SizeDef[] = [
    { id: 'single', name: 'Single ’Mech', count: 1, clan: 'one OmniMech' },
    { id: 'lance', name: 'Lance', count: 4, clan: 'Clan: Star · 5' },
    { id: 'company', name: 'Company', count: 12, clan: 'Clan: Trinary · ~15' },
    { id: 'battalion', name: 'Battalion', count: 36, clan: 'Clan: Cluster · ~45' },
    { id: 'regiment', name: 'Regiment', count: 108, clan: 'Clan: Galaxy · ~135' },
];
const BASE = 5_000_000; // C-bills per 'Mech at Standard
const FAC: Record<string, number> = { Low: 0.4, Standard: 1, High: 2 };

interface Preset {
    tier: string;
    amount: number;
}
interface ResourceCard {
    id: string;
    name: string;
    grade: string;
    lines: ResourceLine[];
}

@Component({
    selector: 'bce-size-capital',
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './size-capital.html',
    styleUrl: './size-capital.scss',
})
export class SizeCapitalComponent {
    private readonly router = inject(Router);
    private readonly state = inject(NewCampaignState);
    private readonly store = inject(CampaignSaveStore);
    private readonly market = inject(ContractMarketService);
    private readonly orders = inject(OrdersService);
    private readonly forceGen = inject(ForceGeneratorService);
    private readonly pilots = inject(PilotService);
    private readonly warchest = inject(WarchestService); // D-109

    protected readonly sizes = SIZES;
    protected readonly generating = signal(false);
    protected readonly beginError = signal<string | null>(null); // HOTFIX-005: catalog-load failure at Begin (error + retry, never a silent empty force)

    protected readonly selectedSize = signal<SizeDef | null>(null);
    protected readonly selectedCapital = signal<CampaignCapital | null>(null);
    protected readonly customText = signal<string>('');
    protected readonly selectedResource = signal<string | null>(null); // tier id
    // DIRECTIVE-068 — the Quick Mission arms-mix toggle ('Mechs only / Combined Arms); flows into the pool.
    protected readonly quickMission = this.state.quickMission;
    protected readonly armsMix = this.state.armsMix;
    protected setArmsMix(v: 'mechs' | 'combined'): void { this.state.setArmsMix(v); }

    constructor() {
        // Step 3 must be done; otherwise climb back up the wizard.
        if (!this.state.unit()) {
            void this.router.navigate(['/campaign/new/faction']);
            return;
        }
        // Restore prior size/capital/resources on return (e.g. Back from the summary).
        const priorSize = this.state.unitSize();
        if (priorSize) {
            this.selectedSize.set(SIZES.find((s) => s.id === priorSize.id) ?? null);
        }
        const priorCap = this.state.capital();
        if (priorCap) {
            this.selectedCapital.set(priorCap);
            if (priorCap.tier === 'Custom') this.customText.set(String(priorCap.amount));
        }
        const priorRes = this.state.resources();
        if (priorRes) this.selectedResource.set(priorRes);
    }

    /** Capital presets for the chosen size — count × 5M × {0.4, 1, 2}. */
    protected readonly presets = computed<Preset[]>(() => {
        const s = this.selectedSize();
        if (!s) return [];
        return (['Low', 'Standard', 'High'] as const).map((tier) => ({
            tier,
            amount: Math.round(s.count * BASE * FAC[tier]),
        }));
    });

    /** Resource cards, with the DropShip lines reflecting the chosen size. */
    protected readonly resourceCards = computed<ResourceCard[]>(() => {
        const ship = shipForSize(this.selectedSize()?.id);
        return RESOURCE_TIERS.map((t) => ({ id: t.id, name: t.name, grade: t.grade, lines: t.assets(ship) }));
    });

    protected readonly canBegin = computed(
        () => !!this.selectedSize() && !!this.selectedCapital() && !!this.selectedResource(),
    );

    protected selectSize(s: SizeDef): void {
        if (this.selectedSize()?.id === s.id) return;
        this.selectedSize.set(s);
        // Size drives both capital presets and the provided DropShip → clear both choices.
        this.selectedCapital.set(null);
        this.customText.set('');
        this.selectedResource.set(null);
    }

    protected selectPreset(p: Preset): void {
        this.selectedCapital.set({ tier: p.tier, amount: p.amount });
        this.customText.set(''); // presets and custom are mutually exclusive in the UI
    }

    protected onCustom(value: string): void {
        this.customText.set(value);
        const v = Math.floor(Number(value));
        if (Number.isFinite(v) && v > 0) {
            this.selectedCapital.set({ tier: 'Custom', amount: v });
        } else if (this.selectedCapital()?.tier === 'Custom') {
            this.selectedCapital.set(null);
        }
    }

    protected isPresetSel(p: Preset): boolean {
        const c = this.selectedCapital();
        return !!c && c.tier === p.tier && c.amount === p.amount;
    }

    protected selectResource(id: string): void {
        this.selectedResource.set(id);
    }

    // C-bill formatting (mirrors the mockup): compact headline, full beneath.
    protected short(n: number): string {
        return n >= 1e9 ? (n / 1e9).toFixed(2).replace(/\.00$/, '') + 'B' : Math.round(n / 1e6) + 'M';
    }
    protected fmt(n: number): string {
        return n.toLocaleString('en-US') + ' C-bills';
    }

    protected back(): void {
        void this.router.navigate(['/campaign/new/faction']);
    }

    protected async begin(): Promise<void> {
        const s = this.selectedSize();
        const c = this.selectedCapital();
        const res = this.selectedResource();
        if (!s || !c || !res || this.generating()) return;
        const size: CampaignUnitSize = { id: s.id, name: s.name, count: s.count };
        this.state.setUnitSize(size);
        this.state.setCapital(c);
        this.state.setResources(res);
        // Generate the campaign's one-time content ONCE now, so it rides the initial save and
        // reload never rerolls (D-017/D-018). Both gens are pure + stored on the snapshot.
        this.generating.set(true);
        this.beginError.set(null);
        // HOTFIX-005: the FORCE draw must not proceed on an unready catalog. generateForCampaign now RETRIES
        // the load and THROWS CatalogUnavailableError if it still can't load — surface that (error + retry),
        // never open the dashboard with a 0-mech force.
        try {
            // D-018: RNG starting force (every campaign; build-your-own writes an empty roster).
            await this.forceGen.generateForCampaign();
        } catch {
            this.generating.set(false);
            this.beginError.set('The unit catalog could not be loaded (db.mekbay.com). Check your connection and press Retry — your campaign settings are kept.');
            return; // no force stored → a Retry re-generates cleanly; do NOT open an empty dashboard
        }
        try {
            // D-020: pilots — one per 'Mech + spares, commander gets the best (needs the D-019
            // structure's commander designation, set inside generateForCampaign above). D-067: auto-crew runs
            // for a Quick Mission too, so the one-shot force is immediately playable.
            this.pilots.generateForCampaign();
            // D-067: a Quick Mission SKIPS the campaign chrome — no contract market / House orders. The
            // one-shot synthesizes its own ACTIVE contract on "Generate Mission".
            if (!this.state.quickMission()) {
                // D-017: merc contract market (merc only). D-032: non-merc campaigns get House orders instead.
                if (this.state.force() === 'MERC') await this.market.generateForCampaign();
                else await this.orders.generateForCampaign();
            }
        } catch {
            /* non-catalog pilots/contract hiccup — non-fatal; the dashboard shows the partial state (as before) */
        }
        this.generating.set(false);
        // D-022: start the campaign clock at the start date + seed the live treasury from capital (the Quick
        // Mission market still needs a treasury to field/buy the force).
        this.state.setCurrentDate(this.state.startDate());
        this.state.setTreasury(c.amount);
        // D-109 — Hot Spots campaigns seed the Warchest (3,000 SP + Rep 1 + Scale 1 + the opening ledger line).
        // Traditional keeps the C-bill treasury above; the two economies don't mix (the treasury still exists for
        // the shared shop/market plumbing, but the Hot Spots UI drives the Warchest).
        if (this.state.campaignSystem() === 'hotspots') this.warchest.seed();
        // D-079 — default the campaign's Star Map location to the chosen faction's capital (GM-changeable
        // later on the Overview). Pure synchronous lookup (tiny capital map; the big systems.json stays lazy).
        this.state.setCurrentLocation(capitalSystemIdFor(this.state.faction()));
        if (!this.state.quickMission()) {
            // Save point = Begin: write an initial autosave + set "last" so a dashboard refresh and cover
            // Resume restore this campaign (multi-save store, D-013).
            void this.store.beginSave();
        } else {
            // D-069 (B): a one-shot force is simply FIELDED — every unit DEPLOYED (no reserve/cold for a quick
            // mission), so the roster reads as deployed AND the battle gets the full BLUFOR (deployedSet).
            this.state.setStartingForce((this.state.startingForce() ?? []).map((i) => ({ ...i, condition: 'Deployed' })));
            // D-069 (A): create the EPHEMERAL server session NOW so the dashboard Lobby has a real campaignId
            // (the D-048 join-QR / claims bind to it). Ephemeral = not a resumable save, but a real host room.
            await this.store.beginEphemeralSession();
        }
        void this.router.navigate(['/campaign']);
    }
}
