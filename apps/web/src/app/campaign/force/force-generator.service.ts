/*
 * BCE retool — starting-force generator service (DIRECTIVE-018). The Angular seam around the
 * pure generator: builds the era-gated eligible 'Mech pool (the D-014 faction.eras machinery),
 * resolves merc signature 'Mechs, runs the generator ONCE, and stores proto-instances on
 * NewCampaignState. MekBay's DataService supplies the catalog; all generation math is pure
 * (force-generator.ts). Build-your-own writes an empty force (manual acquisition = engine phase).
 */
import { Injectable, Injector, effect, inject } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { DataService } from '../../services/data.service';
import { resolveMekbayEraId, eraActivePool } from '../faction/faction-select';
import { MERC_COMMANDS } from '../faction/merc-commands';
import { FORMATION_OOB } from '../faction/formation-oob';
import { generateForce, generateForceToBV, formationSeedCap, ratResolveProbe, vehicleShareForYear, FORCE_GEN_TUNABLES, type GenUnit, type GeneratedForce, type ResourceTier } from './force-generator';
import type { ProtoInstance } from './force-generator';
import { assignStructure, hasStructure } from './force-structure';
import type { Faction } from '../../models/factions.model';
import type { Unit } from '../../models/units.model';
import type { MarketContext } from './market';
import { CUSTOM_UNIT } from '../faction/faction-data';

const isClanGroup = (g: string): boolean => g === 'IS Clan' || g === 'HW Clan';

/** HOTFIX-005: the unit catalog (units.json) could not be loaded after retries. Thrown rather than
 *  silently drawing from an empty pool — the caller (Begin) shows a clear error + retry. */
export class CatalogUnavailableError extends Error {
    constructor() {
        super('The unit catalog could not be loaded.');
        this.name = 'CatalogUnavailableError';
    }
}

/** D-076 — per-call OpFor arms-mix override: when present, WINS over the campaign state.armsMix() default +
 *  the per-era vehicle share for that generation (a seed's intent or a GM per-mission toggle). */
export interface OpForArmsOpts {
    armsMix?: 'mechs' | 'combined';
    vehicleShare?: number;
    // DIRECTIVE-127 — Hot Spots ilClan hard-gate: when present, the OpFor is drawn ONLY from this allow-list
    // (a Set of unit ids == MUL mulIds) — the faction's MUL list is the sole source, no off-list unit. With
    // noFallback, an empty gated pool returns [] instead of the generic era-union fallback (no off-list leak).
    allowIds?: Set<number>;
    noFallback?: boolean;
}

@Injectable({ providedIn: 'root' })
export class ForceGeneratorService {
    private readonly state = inject(NewCampaignState);
    private readonly data = inject(DataService);
    private readonly injector = inject(Injector);
    /** D-088 test/diagnostic — the last OpFor's era×faction vehicle share + context (read by the D-085/088 hook). */
    lastOpFor: { year: number; faction: string; armsMix: string; share: number; seedOverride: boolean; factionGap: boolean } | null = null;

    /** True when this campaign generates a force. Make-your-own = a BLANK SLATE (D-029): no RNG draw on
     *  EITHER path — merc build-your-own (Independent Command) OR the House MAKE YOUR OWN formation
     *  (unit === CUSTOM_UNIT). The market is the path to a force. Canon-formation + merc model-on-canon
     *  draws are UNCHANGED. */
    isGeneratable(): boolean {
        if (this.state.force() === 'MERC' && this.state.faction() === 'Independent Command') return false;
        if (this.state.force() !== 'MERC' && this.state.unit() === CUSTOM_UNIT) return false;
        return true;
    }

    /** Generate the starting force once for the current campaign and store it on the state. */
    async generateForCampaign(): Promise<GeneratedForce | null> {
        if (!this.isGeneratable()) {
            this.state.setStartingForce([]); // build-your-own: clean empty roster (manual acquisition later)
            return null;
        }
        try {
            await this.ensureData();
        } catch {
            // HOTFIX-005: do NOT silently write an empty force when the catalog can't load — surface it so
            // Begin shows a clear error + retry. No force is stored here, so a retry re-generates cleanly.
            throw new CatalogUnavailableError();
        }

        const force = this.state.force();
        const faction = this.state.faction();
        const tier = ((this.state.resources() ?? 'normal') as ResourceTier);
        const unitSizeId = this.state.unitSize()?.id ?? 'lance';
        const clanBasis = force === 'CLAN';
        const eraId = resolveMekbayEraId(this.state.era(), this.data.getEras());
        const startYear = this.state.startDate()?.y ?? this.state.era()?.from ?? 3025;

        // Eligible id set: a real faction's era set, else (merc) the broad era-active IS union.
        let idSet: Set<number>;
        if (force === 'MERC') {
            idSet = this.isUnionIdSet(eraId);
        } else {
            const f = faction ? this.data.getFactionByName(faction) : undefined;
            idSet = f ? this.factionErasIdSet(f, eraId) : this.isUnionIdSet(eraId);
        }

        // D-046: combined-arms eligibility — 'Mechs AND combat vehicles (era/faction-gated identically).
        const eligible = this.data.getUnits().filter((u) => (u.type === 'Mek' || u.type === 'Tank') && u.year <= startYear && idSet.has(u.id));
        const fullPool: GenUnit[] = eligible.filter((u) => this.isCombatUnit(u)).map((u) => this.toGenUnit(u));
        // D-068: 'Mechs-only arms mix (Quick Mission) drops combat vehicles from the pool (vehicle-share 0).
        const pool: GenUnit[] = this.state.armsMix() === 'mechs' ? fullPool.filter((u) => u.unitType !== 'vehicle') : fullPool;
        const vehN = pool.filter((u) => u.unitType === 'vehicle').length;
        console.info(`[D-046 pool] player "${faction}" ≤${startYear}: ${pool.length} combat units (${pool.length - vehN} Meks + ${vehN} vehicles; vehicle share ~${Math.round(vehicleShareForYear(startYear) * 100)}%)`);
        this.ratProbe(faction, startYear, 'player'); // D-024 resolve-probe (PM patches misses)

        // Signature seeding: merc model-on-canon (D-018, uncapped ≤3) OR a chosen House formation
        // (D-021, capped at min(3, 25% of nominal size) so a lance isn't wall-to-wall signatures).
        let seeds: GenUnit[] = [];
        if (force === 'MERC') {
            const r = this.resolveSignature(this.state.commandName() ?? faction ?? '');
            seeds = r.seeds;
            const total = r.seeds.length + r.misses.length;
            if (r.misses.length) {
                console.warn(`[D-018 signature] ${r.seeds.length}/${total} signature 'Mechs resolved; missed: ${r.misses.join(', ')}`);
            } else if (total) {
                console.info(`[D-018 signature] ${total}/${total} signature 'Mechs resolved`);
            }
        } else if (this.state.formation()) {
            const formationName = this.state.formation()!;
            const cap = formationSeedCap(unitSizeId, clanBasis);
            const r = this.resolveFormationSignature(formationName);
            seeds = r.seeds.slice(0, Math.max(0, cap));
            const total = r.seeds.length + r.misses.length;
            if (r.misses.length) {
                console.warn(`[D-021 formation] ${formationName}: ${r.seeds.length}/${total} signature 'Mechs resolved (seeding ${seeds.length}, cap ${cap}); missed: ${r.misses.join(', ')}`);
            } else if (total) {
                console.info(`[D-021 formation] ${formationName}: ${total}/${total} signature 'Mechs resolved; seeding ${seeds.length} (cap ${cap})`);
            }
        }

        const result = generateForce({ pool, seeds, unitSizeId, tier, clanBasis, factionCode: faction, year: startYear, eraId });
        // D-019: organize the flat draw into lances/Stars + command designation.
        const structured = assignStructure(result.instances, force, unitSizeId);
        // D-029: stamp provenance 'generated' on the draw (absent on old saves = generated; no migration).
        // SEAM (D-029, James noted-not-critical): a future economy pass will AUTO-DEDUCT this generated
        // force's catalog value from starting capital (symmetry with purchased forces). NOT built here.
        const stamped = structured.instances.map((i) => ({ ...i, provenance: { origin: 'generated' as const } }));
        console.info(`[D-018 force] ${result.instances.length} 'Mechs (nominal ${result.meta.nominal}, pool ${pool.length}, ${tier}); weights ${JSON.stringify(result.meta.weightSpread)}; levels ${JSON.stringify(result.meta.levelSpread)}; lances ${structured.structure.lances.length}`);
        this.state.setStartingForce(stamped);
        this.state.setForceStructure(structured.structure);
        return result;
    }

    /** Structure-on-load: a loaded force without lance links (pre-D-019 save) gets organized. */
    ensureStructure(): boolean {
        const force = this.state.startingForce();
        if (!force || !force.length) return false;
        if (hasStructure(force, this.state.forceStructure())) return false;
        const structured = assignStructure(force, this.state.force(), this.state.unitSize()?.id ?? 'company');
        this.state.setStartingForce(structured.instances);
        this.state.setForceStructure(structured.structure);
        return true;
    }

    /**
     * Generate an OpFor force (D-023) for an explicit TARGET faction at the campaign's current era +
     * year, sized to a BV target. The keystone D-018 reuse outside Begin: same era-legal pool machinery
     * (faction.eras ∩ year ∩ Mek), same heuristic draw — band-stopped on BV. A target that isn't a real
     * catalog faction (a CamOps generic / pirates) falls back to the broad era-active IS union. Pure RNG
     * injectable so the caller generates ONCE and stores the result (reload-identical). Empty if offline.
     */
    generateOpFor(targetFaction: string, bvTarget: number, tolerance: number, opts?: OpForArmsOpts, rng: () => number = Math.random): ProtoInstance[] {
        if (!this.data.isDataReady()) return [];
        const eraId = resolveMekbayEraId(this.state.era(), this.data.getEras());
        const year = this.state.currentDate()?.y ?? this.state.startDate()?.y ?? this.state.era()?.from ?? 3025;
        const tier = ((this.state.resources() ?? 'normal') as ResourceTier);
        const f = targetFaction ? this.data.getFactionByName(targetFaction) : undefined;
        // DIRECTIVE-127 — Hot Spots ilClan: the faction's MUL list (opts.allowIds) is the ONLY source; it REPLACES
        // the MekBay faction×era pool (and the merc/unknown IS-union). Everything else keeps today's behavior.
        const idSet = opts?.allowIds ?? (f ? this.factionErasIdSet(f, eraId) : this.isUnionIdSet(eraId));
        // D-046: combined-arms OpFor — 'Mechs AND combat vehicles (the prose-implied armor now structured).
        const eligible = this.data.getUnits().filter((u) => (u.type === 'Mek' || u.type === 'Tank') && u.year <= year && idSet.has(u.id));
        const fullPool: GenUnit[] = eligible.filter((u) => this.isCombatUnit(u)).map((u) => this.toGenUnit(u));
        // D-068/D-076: the OpFor arms style — a D-076 seed/GM override (opts.armsMix) WINS over the campaign
        // state.armsMix() default for this call; 'mechs' fields a 'Mechs-only OpFor (0 vehicles).
        const armsMix = opts?.armsMix ?? this.state.armsMix();
        const vehicleShare = opts?.vehicleShare; // D-076: seed's desired vehicle fraction (else per-era default in the draw)
        const pool: GenUnit[] = armsMix === 'mechs' ? fullPool.filter((u) => u.unitType !== 'vehicle') : fullPool;
        const vehN = pool.filter((u) => u.unitType === 'vehicle').length;
        const effShare = armsMix === 'mechs' ? 0 : (vehicleShare ?? vehicleShareForYear(year, targetFaction)); // D-088
        this.lastOpFor = { year, faction: targetFaction, armsMix, share: effShare, seedOverride: vehicleShare != null, factionGap: false };
        console.info(`[D-046 pool] opfor "${targetFaction}" ≤${year}: ${pool.length} combat units (${pool.length - vehN} Meks + ${vehN} vehicles; arms ${armsMix}, vehicle share ~${Math.round(effShare * 100)}% [D-088 era×faction])`);
        this.ratProbe(targetFaction, year, 'opfor'); // D-024 resolve-probe
        if (!pool.length) {
            // DIRECTIVE-127 — under the MUL gate the list is authoritative and COMPLETE: never substitute a generic
            // era-union (the directive's "no generic-RAT fallback, no off-list unit, ever"). An empty gated pool =
            // no combatants on this faction's MUL list at this year → return [] rather than leak off-list units.
            if (opts?.noFallback) {
                console.warn(`[D-127] "${targetFaction}" MUL-gated OpFor pool empty (era ${eraId}, ≤${year}) — NO generic fallback; empty OpFor.`);
                return [];
            }
            // D-102 A3 — a CLAN target must NEVER silently field IS 'Mechs: fall back to the CLAN union, not the IS
            // union. Flag the availability gap (faction.eras data is MekBay's, known-thin — the real fix is task #47).
            const clanTarget = f ? isClanGroup(f.group) : /clan/i.test(targetFaction);
            const fbIdSet = clanTarget ? this.clanUnionIdSet(eraId) : this.isUnionIdSet(eraId);
            console.warn(`[D-102 A3] empty era-legal pool for "${targetFaction}" (era ${eraId}, ≤${year}) — ${clanTarget ? 'CLAN' : 'IS'}-union fallback (faction×era unit data incomplete, #47)`);
            if (this.lastOpFor) this.lastOpFor.factionGap = true;
            const fb = this.data.getUnits().filter((u) => this.isCombatUnit(u) && u.year <= year && fbIdSet.has(u.id)).map((u) => this.toGenUnit(u));
            if (!fb.length) return [];
            return generateForceToBV({ pool: fb, bvTarget, tolerance, factionCode: targetFaction, year, eraId, tier, vehicleShare }, rng).instances;
        }
        const r = generateForceToBV({ pool, bvTarget, tolerance, factionCode: targetFaction, year, eraId, tier, vehicleShare }, rng);
        console.info(`[D-023 opfor] "${targetFaction}": ${r.instances.length} units, BV ${r.bvTotal} (target ${Math.round(bvTarget)}, band ±${Math.round(tolerance * 100)}%, pool ${pool.length}, era ${eraId} ≤${year})`);
        return r.instances;
    }

    // ── D-029 unit market: the D-018 eligibility filter + the gate context, exposed as a BROWSE list ──
    /** The eligible BROWSE list (faction-era ∩ year ∩ combat-'Mech) as catalog Units, instead of drawn. */
    eligibleUnits(): Unit[] {
        if (!this.data.isDataReady()) return [];
        const eraId = resolveMekbayEraId(this.state.era(), this.data.getEras());
        const year = this.marketYear();
        const idSet = this.playerIdSet(this.state.force(), this.state.faction(), eraId);
        return this.data.getUnits().filter((u) => this.isCombatMek(u) && u.year <= year && idSet.has(u.id));
    }

    /** DIRECTIVE-130 — the eligible OpFor BROWSE list for an explicit TARGET faction (the manual OpFor builder's
     *  DEFAULT gate): combat 'Mechs + combat vehicles that are era-legal for that faction at the current year — the
     *  exact pool `generateOpFor` draws from, undrawn, as catalog Units. When `allowIds` is passed (the D-127 MUL
     *  gate = `MulAllowlistService.idsFor(faction)`), it REPLACES the faction×era id set, so the builder's default
     *  list matches what the gated OpFor generator would field (D-127 parity). No never-dead-end union fallback here
     *  (an empty gated pool → the GM uses the off-list override); Traditional/other eras never call this. */
    eligibleOpForUnits(targetFaction: string, allowIds?: Set<number>): Unit[] {
        if (!this.data.isDataReady()) return [];
        const eraId = resolveMekbayEraId(this.state.era(), this.data.getEras());
        const year = this.state.currentDate()?.y ?? this.state.startDate()?.y ?? this.state.era()?.from ?? 3025;
        const f = targetFaction ? this.data.getFactionByName(targetFaction) : undefined;
        const idSet = allowIds ?? (f ? this.factionErasIdSet(f, eraId) : this.isUnionIdSet(eraId));
        return this.data.getUnits().filter((u) => (u.type === 'Mek' || u.type === 'Tank') && u.year <= year && idSet.has(u.id) && this.isCombatUnit(u));
    }

    /** All combat 'Mechs (the GM-override browse — ignores faction/era; the gates surface per row). DEPLOY-005:
     *  this needs the FULL catalog (the era slice has only the era's units), so it gates on isFullLoaded — the
     *  market lazy-loads the full catalog (ensureFullCatalog) and shows a loading state until then. */
    allCombatMeks(): Unit[] {
        return this.data.isFullLoaded() ? this.data.getUnits().filter((u) => this.isCombatMek(u)) : [];
    }

    /** The four-gate context for the current campaign era (factionIdSet · era-union · hero set · year). */
    marketContext(): MarketContext {
        const eraId = resolveMekbayEraId(this.state.era(), this.data.getEras());
        const factionIdSet = this.playerIdSet(this.state.force(), this.state.faction(), eraId);
        const eraUnion = new Set<number>();
        for (const f of eraActivePool(this.data.getFactions(), eraId)) for (const id of this.factionErasIdSet(f, eraId)) eraUnion.add(id);
        const uniq = this.data.getFactionByName('Unique'); // the MUL hero meta-bucket (D-015 deny-list)
        const heroIdSet = new Set<number>();
        if (uniq) for (const id of this.factionErasIdSet(uniq, eraId)) if (!eraUnion.has(id)) heroIdSet.add(id);
        return { factionIdSet, eraUnion, heroIdSet, year: this.marketYear() };
    }

    private marketYear(): number {
        return this.state.currentDate()?.y ?? this.state.startDate()?.y ?? this.state.era()?.from ?? 3025;
    }
    /** Player faction's era id set (or the broad IS union for mercs / unknown factions). */
    private playerIdSet(force: string | null, faction: string | null, eraId: number | null): Set<number> {
        if (force === 'MERC') return this.isUnionIdSet(eraId);
        const f = faction ? this.data.getFactionByName(faction) : undefined;
        return f ? this.factionErasIdSet(f, eraId) : this.isUnionIdSet(eraId);
    }

    // ── pool helpers ──
    /** D-024: a combat 'Mech eligible for generation — excludes IndustrialMechs/civilian designs
     *  (catalog `subtype` contains "Industrial") unless FORCE_GEN_TUNABLES.allowIndustrials. Charger,
     *  UrbanMech, etc. are subtype 'BattleMek' → unaffected. Player + OpFor share this predicate. */
    private isCombatMek(u: Unit): boolean {
        if (u.type !== 'Mek') return false;
        return FORCE_GEN_TUNABLES.allowIndustrials || !/industrial/i.test(u.subtype);
    }
    /** D-046: a combat VEHICLE for the pool — a ground combat tank (type 'Tank', subtype 'Combat Vehicle'),
     *  excluding support/industrial vehicles. VTOL + aerospace defer to T-032 (battlefield support). */
    private isCombatVehicle(u: Unit): boolean {
        if (u.type !== 'Tank') return false;
        const sub = u.subtype ?? '';
        if (!/combat vehicle/i.test(sub) || /support|industrial/i.test(sub)) return false;
        // D-085: many SUPPORT/non-combatant vehicles (BattleMech/Heavy Recovery, Engineering incl. flamer, salvage,
        // cargo, mobile HQ/field base, …) carry a 'Combat Vehicle' subtype in the catalog yet are NOT combatants —
        // exclude them by ROLE in the name, the way D-024 excludes industrial 'Mechs. They must not pad the OpFor BV.
        const name = `${u.chassis ?? ''} ${u.model ?? ''}`;
        return !/recovery|engineering|salvage|support|cargo|mobile (hq|long ?tom|field|hpg|structure)|maintenance|refuel|fuel|ambulance|\bmash\b|fire ?(engine|truck)|construction|bridge ?layer|coolant|crane/i.test(name);
    }
    /** D-046: the combined-arms combat predicate — a combat 'Mech OR a combat vehicle (armor). */
    private isCombatUnit(u: Unit): boolean {
        return this.isCombatMek(u) || this.isCombatVehicle(u);
    }

    /** Normalized full-catalog 'Mech chassis set (not year-gated → no false RAT misses). */
    private catalogChassis(): Set<string> {
        return new Set(this.data.getUnits().filter((u) => u.type === 'Mek').map((u) => u.chassis.toLowerCase().replace(/[^a-z0-9]+/g, '')));
    }

    /** D-024 RAT resolve-probe: log chassis listed in rat-weights.ts for this faction+year that don't
     *  resolve against the catalog (patched manually). Quiet when a table matches cleanly / no table. */
    private ratProbe(faction: string | null, year: number, tag: string): void {
        const misses = ratResolveProbe(faction, year, this.catalogChassis());
        if (misses.length) console.warn(`[D-024 rat] ${tag} "${faction}" ${year}: ${misses.length} RAT chassis not in catalog: ${misses.join(', ')}`);
        else console.info(`[D-024 rat] ${tag} "${faction}" ${year}: RAT chassis all resolved (or no table)`);
    }

    private toGenUnit(u: Unit): GenUnit {
        return { name: u.name, chassis: u.chassis, model: u.model, id: u.id, year: u.year, level: String(u.level), techRating: u.techRating, weightClass: u.weightClass, role: u.role, tons: u.tons, bv: u.bv, unitType: u.type === 'Mek' ? 'mech' : 'vehicle' };
    }

    private factionErasIdSet(f: Faction, eraId: number | null): Set<number> {
        const out = new Set<number>();
        if (eraId == null) return out;
        const e = (f.eras as Record<number, unknown>)?.[eraId];
        if (!e) return out;
        if (e instanceof Set) for (const x of e) out.add(Number(x));
        else if (Array.isArray(e)) for (const x of e) out.add(Number(x));
        else if (typeof e === 'object') for (const k of Object.keys(e as object)) out.add(Number(k));
        return out;
    }

    /** Broad era-active IS pool (non-Clan factions' union) — the merc fill pool. */
    private isUnionIdSet(eraId: number | null): Set<number> {
        const out = new Set<number>();
        if (eraId == null) return out;
        const pool = eraActivePool(this.data.getFactions(), eraId).filter((f) => !isClanGroup(f.group));
        for (const f of pool) for (const id of this.factionErasIdSet(f, eraId)) out.add(id);
        return out;
    }

    /** D-102 A3 — broad era-active CLAN pool (Clan factions' union): the Clan-target fallback fill so a Clan OpFor
     *  with a thin own-faction era set never silently becomes IS. Mirrors isUnionIdSet, Clan-side. */
    private clanUnionIdSet(eraId: number | null): Set<number> {
        const out = new Set<number>();
        if (eraId == null) return out;
        for (const f of eraActivePool(this.data.getFactions(), eraId).filter((g) => isClanGroup(g.group))) for (const id of this.factionErasIdSet(f, eraId)) out.add(id);
        return out;
    }

    /** Resolve a chosen House formation's signature 'Mechs (D-021) — chassis vs the catalog, like
     *  the merc path. Caller caps the result; resolve-probe surfaces chassis misses for PM patching. */
    private resolveFormationSignature(formationName: string): { seeds: GenUnit[]; misses: string[] } {
        const rec = FORMATION_OOB.find((f) => f.name === formationName || (f.aliases ?? []).includes(formationName));
        if (!rec) return { seeds: [], misses: [] };
        const units = this.data.getUnits();
        const seeds: GenUnit[] = [];
        const misses: string[] = [];
        for (const m of rec.signatureMechs) {
            const u = units.find((x) => x.type === 'Mek' && x.chassis === m.chassis);
            if (u) seeds.push(this.toGenUnit(u));
            else misses.push(m.chassis);
        }
        return { seeds, misses };
    }

    private resolveSignature(commandName: string): { seeds: GenUnit[]; misses: string[] } {
        const cmd = MERC_COMMANDS.find((c) => c.name === commandName || c.aliases.includes(commandName));
        if (!cmd) return { seeds: [], misses: [] };
        const units = this.data.getUnits();
        const seeds: GenUnit[] = [];
        const misses: string[] = [];
        for (const m of cmd.signatureMechs) {
            let u: Unit | undefined;
            if (m.variant) {
                const re = new RegExp(m.variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
                u = units.find((x) => x.type === 'Mek' && x.chassis === m.chassis && re.test(x.model));
            }
            if (!u) u = units.find((x) => x.type === 'Mek' && x.chassis === m.chassis);
            if (u) seeds.push(this.toGenUnit(u));
            else misses.push(`${m.chassis}${m.variant ? ' ' + m.variant : ''}`);
        }
        return { seeds, misses };
    }

    // ── catalog readiness (HOTFIX-005: RETRY transient failures, then SURFACE — never draw an empty pool) ──
    private async ensureData(attempts = 2): Promise<void> {
        if (this.data.isDataReady()) return;
        // DEPLOY-005: prefer the SMALL per-era slice (the common Begin path draws from the era pool only) —
        // no 24MB parse. Fall back to the full catalog on a genuine slice failure (dev w/o slices, or error).
        try {
            if (await this.data.ensureSliceIndex()) {
                const eraId = resolveMekbayEraId(this.state.era(), this.data.getEras());
                if (eraId != null && (await this.data.ensureSlice(eraId))) return;
            }
        } catch { /* fall through to the full catalog */ }
        for (let i = 0; i < attempts; i++) {
            if (this.data.isDataReady()) return;
            // (re)kick the load if nothing is in flight; initialize() resolves regardless and isDataReady
            // reflects the outcome (it only goes true once units + every store actually loaded).
            if (!this.data.isDownloading()) this.data.initialize().catch(() => { /* outcome read via isDataReady */ });
            try { await this.whenDataReady(); return; } catch { /* the 30s wait timed out — retry the load once */ }
        }
        if (!this.data.isDataReady()) throw new CatalogUnavailableError();
    }
    private whenDataReady(): Promise<void> {
        if (this.data.isDataReady()) return Promise.resolve();
        return new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => { ref.destroy(); reject(new Error('data timeout')); }, 30000);
            const ref = effect(() => {
                if (this.data.isDataReady()) {
                    clearTimeout(timer);
                    ref.destroy();
                    resolve();
                }
            }, { injector: this.injector });
        });
    }
}
