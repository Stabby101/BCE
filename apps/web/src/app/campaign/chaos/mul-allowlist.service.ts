/*
 * DIRECTIVE-127 — the MUL ilClan faction allow-list (Hot Spots hard-gate). Loads the authored MUL faction×era
 * rosters (scraped from masterunitlist.info → content-forge/mul/ilclan/, copied to /mekbay/mul-ilclan/allowlist.json
 * at build) and exposes, per faction, the SET of allowed unit ids — where unit.id === the MUL mulId (verified: our
 * catalog's Dasher id 838 == /Unit/Details/838). The OpFor generator + the chaos Market gate on this: for a Hot Spots
 * ilClan campaign the faction's MUL list is the ONLY source of units — nothing off-list may appear.
 *
 * HS-ilClan-ONLY: the gate is live only when campaignSystem()==='hotspots' AND the resident era slice is MekBay
 * ilClan (era id 257). Traditional and every other era are untouched (idsFor() returns null → callers treat it as
 * "no gate"). Fail-open on a load error (→ inert), so a missing asset never blocks or breaks generation.
 */
import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { NewCampaignState } from '../new-campaign-state';
import { DataService } from '../../services/data.service';
import { resolveMekbayEraId } from '../faction/faction-select';

/** MekBay era id for ilClan (the resident slice for a Draconis Reach Hot Spots campaign; BCE era id is 12). */
export const MUL_ILCLAN_ERA = 257;
const ASSET = '/mekbay/mul-ilclan/allowlist.json'; // same-origin build asset (mirrors the DEPLOY-005 slice convention)

@Injectable({ providedIn: 'root' })
export class MulAllowlistService {
    private readonly http = inject(HttpClient);
    private readonly state = inject(NewCampaignState);
    private readonly data = inject(DataService);

    /** factionKey → allowed unit ids (== MUL mulIds). null until loaded; {} on a load failure (gate stays inert). */
    private readonly raw = signal<Record<string, number[]> | null>(null);
    private loading: Promise<void> | null = null;

    /** factionKey → Set<number>, memoized off the loaded signal (reactive: the market computed re-runs on load). */
    private readonly sets = computed<Record<string, Set<number>>>(() => {
        const r = this.raw();
        const out: Record<string, Set<number>> = {};
        if (r) for (const k of Object.keys(r)) out[k] = new Set(r[k]);
        return out;
    });

    /** Load the allow-list asset once (idempotent). Await it before generation, or call fire-and-forget (the market
     *  reads it reactively once the signal lands). Fails OPEN — a fetch error sets {} so the gate is simply inert. */
    async ensure(): Promise<void> {
        if (this.raw() !== null) return;
        if (!this.loading) {
            this.loading = firstValueFrom(this.http.get<Record<string, number[]>>(ASSET).pipe(timeout(12000)))
                .then((j) => { this.raw.set(j && typeof j === 'object' ? j : {}); })
                .catch(() => { this.raw.set({}); });
        }
        return this.loading;
    }

    /** The gate is live only for a Hot Spots campaign whose resident era is MekBay ilClan (257). */
    isIlClan(): boolean {
        return resolveMekbayEraId(this.state.era(), this.data.getEras()) === MUL_ILCLAN_ERA;
    }
    private active(): boolean {
        return this.state.campaignSystem() === 'hotspots' && this.raw() != null && this.isIlClan();
    }

    /** The allowed-id Set for a faction STRING (enemyFaction / opfor.faction / 'Mercenary'), or null when the gate
     *  is inert: Traditional, a non-ilClan era, not-yet-loaded, or an unmapped faction. Callers treat null as
     *  "no MUL gate — keep today's behavior". A live-but-empty faction set also returns null (no false lock-out). */
    idsFor(name: string | null | undefined): Set<number> | null {
        if (!this.active() || !name) return null;
        const key = hsFactionToMulFaction(name);
        if (!key) return null;
        const s = this.sets()[key];
        return s && s.size ? s : null;
    }
}

/* Map a Hot Spots faction STRING → one of the eight MUL dataset keys (the allowlist.json keys). Exact match first,
 * then a normalized alias table (the ilClan renames + common short/prose forms), then a longest-key contains pass
 * for prefixed employer strings ("Federated Suns — New Ivaarsen Chasseurs"). null for an unmapped faction. */
// HIN-1 (2026-09-03) — Lyran Commonwealth + Free Worlds League join CANON so the Hinterlands pack's employers (and Bolan's two
// sides) resolve to real factions. They have NO MUL dataset: idsFor() returns null for them (the gate stays inert → the MekBay
// era pool, the Jade Falcon posture). A bare 'commonwealth' alias was deliberately NOT added — the longest-key contains pass
// would map "Marik-Stewart Commonwealth" (a League successor) to Lyran. No Clan joins the table (H13: the hiring predicate is
// keyed to it; recon proved 0 Clan hiring flips with exactly these keys).
const CANON = ['Draconis Combine', 'Federated Suns', 'Capellan Confederation', 'Republic of the Sphere', 'Raven Alliance', 'Clan Sea Fox', 'Pirates', 'Mercenary', 'Lyran Commonwealth', 'Free Worlds League'];
const ALIAS: Record<string, string> = {
    'draconis combine': 'Draconis Combine', combine: 'Draconis Combine', dcms: 'Draconis Combine', kurita: 'Draconis Combine',
    'federated suns': 'Federated Suns', 'federated commonwealth': 'Federated Suns', affs: 'Federated Suns', davion: 'Federated Suns',
    'capellan confederation': 'Capellan Confederation', capellan: 'Capellan Confederation', ccaf: 'Capellan Confederation', liao: 'Capellan Confederation',
    'republic of the sphere': 'Republic of the Sphere', 'republic armed forces': 'Republic of the Sphere', rots: 'Republic of the Sphere', raf: 'Republic of the Sphere',
    'raven alliance': 'Raven Alliance', 'clan snow raven': 'Raven Alliance', 'snow raven': 'Raven Alliance',
    'clan sea fox': 'Clan Sea Fox', 'sea fox': 'Clan Sea Fox', 'clan diamond shark': 'Clan Sea Fox', 'diamond shark': 'Clan Sea Fox',
    pirates: 'Pirates', pirate: 'Pirates', bandit: 'Pirates', bandits: 'Pirates', bandit_caste: 'Pirates',
    mercenary: 'Mercenary', mercenaries: 'Mercenary', merc: 'Mercenary', mercs: 'Mercenary',
    'lyran commonwealth': 'Lyran Commonwealth', 'lyran alliance': 'Lyran Commonwealth', lyran: 'Lyran Commonwealth', lcaf: 'Lyran Commonwealth', steiner: 'Lyran Commonwealth', // HIN-1
    'free worlds league': 'Free Worlds League', fwl: 'Free Worlds League', fwlm: 'Free Worlds League', marik: 'Free Worlds League', tamarind: 'Free Worlds League', // HIN-1
};
const ALIAS_KEYS_DESC = Object.keys(ALIAS).sort((a, b) => b.length - a.length); // longest first → no short-key false hits
export function hsFactionToMulFaction(name: string): string | null {
    const t = (name ?? '').trim();
    if (!t) return null;
    if (CANON.includes(t)) return t;
    const n = t.toLowerCase();
    if (ALIAS[n]) return ALIAS[n];
    for (const key of ALIAS_KEYS_DESC) if (key.length >= 4 && n.includes(key)) return ALIAS[key];
    return null;
}
