import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { NewCampaignState } from '../new-campaign-state';
import { DataService } from '../../services/data.service';
import { resolveMekbayEraId } from '../faction/faction-select';

/** MekBay era id for ilClan (the resident slice for a Draconis Reach Hot Spots campaign; BCE era id is 12). */
export const MUL_ILCLAN_ERA = 257;
export type MulLoadStatus = 'idle' | 'loading' | 'ready' | 'failed';
export type MulGateState = 'inert' | 'loading' | 'failed' | 'ready';
const ASSET = '/mekbay/mul-ilclan/allowlist.json'; // same-origin build asset (mirrors the DEPLOY-005 slice convention)

@Injectable({ providedIn: 'root' })
export class MulAllowlistService {
    private readonly http = inject(HttpClient);
    private readonly state = inject(NewCampaignState);
    private readonly data = inject(DataService);

    /** factionKey → allowed unit ids (== MUL mulIds). null until loaded — and null after a FAILED load (the gate stays inert). */
    private readonly raw = signal<Record<string, number[]> | null>(null);
    private loading: Promise<void> | null = null;
    /** LANDING (3) — the load's state, the one witness the surfaces read. idle until the first ensure(). */
    readonly status = signal<MulLoadStatus>('idle');

    /** factionKey → Set<number>, memoized off the loaded signal (reactive: the market computed re-runs on load). */
    private readonly sets = computed<Record<string, Set<number>>>(() => {
        const r = this.raw();
        const out: Record<string, Set<number>> = {};
        if (r) for (const k of Object.keys(r)) out[k] = new Set(r[k]);
        return out;
    });

    /** Load the allow-list asset once (idempotent). Await it before generation, or call fire-and-forget (the market
     *  reads it reactively once the signal lands). A fetch error / a 12 s timeout / a malformed body → status 'failed',
     *  raw stays null (idsFor() null — inert for generation, exactly as before); the failure is STICKY here — retry() is
     *  the explicit second attempt, so an awaiting generator never re-waits the timeout. */
    async ensure(): Promise<void> {
        if (this.raw() !== null) return;
        if (!this.loading) {
            this.status.set('loading');
            this.loading = firstValueFrom(this.http.get<Record<string, number[]>>(ASSET).pipe(timeout(12000)))
                .then((j) => {
                    if (j && typeof j === 'object' && !Array.isArray(j)) { this.raw.set(j); this.status.set('ready'); }
                    else this.status.set('failed');
                })
                .catch(() => { this.status.set('failed'); });
        }
        return this.loading;
    }
    /** LANDING (3) — a second attempt after a failure (the builder's / the Market's Retry). A no-op while loading or ready. */
    retry(): Promise<void> {
        if (this.status() !== 'failed') return this.ensure();
        this.loading = null;
        this.status.set('idle');
        return this.ensure();
    }

    isIlClan(): boolean {
        this.data.isDataReady(); this.data.catalogVersion();
        return resolveMekbayEraId(this.state.era(), this.data.getEras()) === MUL_ILCLAN_ERA;
    }
    private active(): boolean {
        return this.state.campaignSystem() === 'hotspots' && this.raw() != null && this.isIlClan();
    }
    /** LANDING (3) — what a player-side surface should SAY about the list: 'inert' outside a Hot Spots ilClan campaign
     *  (nothing is said — Traditional untouched); else 'loading' until the asset lands (idle counts as loading: every
     *  surface calls ensure() on construction), 'failed' after a failed load, 'ready' once the sets exist. Reactive. */
    gateState(): MulGateState {
        if (this.state.campaignSystem() !== 'hotspots' || !this.isIlClan()) return 'inert';
        const st = this.status();
        return st === 'ready' ? 'ready' : st === 'failed' ? 'failed' : 'loading';
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
// keyed to it; recon proved 0 Clan hiring flips with exactly these keys).
const CANON = ['Draconis Combine', 'Federated Suns', 'Capellan Confederation', 'Republic of the Sphere', 'Raven Alliance', 'Clan Sea Fox', 'Pirates', 'Mercenary', 'Lyran Commonwealth', 'Free Worlds League'];
/** ORDER-15 (a) — the AFFILIATIONS a Hot Spots command may declare at creation: the canon keys, Mercenary first (the default).
 *  The off-list tag and the hiring predicate key on the chosen one. Exported for the creation step's select + the specs. */
export const COMMAND_AFFILIATIONS: readonly string[] = ['Mercenary', ...CANON.filter((f) => f !== 'Mercenary')];
export const DEFAULT_AFFILIATION = 'Mercenary';
/** The command's MUL key: its declared affiliation, else Mercenary (older saves, and the default). Never a NAME lookup — a
 *  command called "Kurita's Lancers" is not the Combine; only the declared affiliation keys the lists. */
export function commandMulKey(affiliation: string | null | undefined): string {
    const a = (affiliation ?? '').trim();
    return a && CANON.includes(a) ? a : DEFAULT_AFFILIATION;
}
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
