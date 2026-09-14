/*
 * DIRECTIVE-ODM-1 Phase 1 — the ODM campaign creator (the merc-command direct-mint Begin precedent, D-113).
 * No wizard: the pack FIXES everything — era window (Amaris Civil War, inside BCE era 2), start date
 * (Feb 6 2767 "Day 1", ruling 2), the company (the 28-unit LIVE roster, ruling 1: 16
 * SLDF-Royal 'Mechs incl. 3 cold-storage + 12 vehicles, named pilots), treasury, factions. Pack data is
 * fetched from the entitlement-guarded pack API at create time (server-served, never bundled); the minted
 * campaign is a TRADITIONAL-base campaign tagged packId:'odm', persisted through the normal save path
 * (where the server's pack gate re-checks the entitlement — hiding is not security).
 *
 * engine-odm scope: imports platform state/services + the pack fetch only — never engine-classic/hs files.
 */
import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { NewCampaignState } from '../new-campaign-state';
import { CampaignSaveStore } from '../campaign-save-store';
import { DataService } from '../../services/data.service';
import { generatePilots, type Pilot } from '../barracks/pilot-generator';
import type { ProtoInstance } from '../force/force-generator';
import { mintOdmBranches, type OdmTreeData } from './odm-tree'; // ODM-3
import { odmStartingStocks } from './odm-stocks'; // ODM-11 — the survival-economy seed (the authored pack ledger)
import { tradeForInstance } from './odm-trades'; // ODM-15 — the muster stamp
import { identityOf, stableGroups, choosePrimary } from './odm-stables'; // ODM-15b — one record per PERSON

interface OdmRosterUnit {
    chassis: string; variant: string; displayName: string; unitType: string;
    status?: string | null; coldStorage: boolean; mothballed: boolean; damage?: string | null;
    /* ODM-26 option 2 piece 1 — THE PACK MAY NOW CARRY A TRADE AND A PRIMARY HULL. Both OPTIONAL, and
       absent means "derive as before", so every existing pack and every existing campaign is untouched.
       They exist because ODM-25 made trade IDENTITY rather than a function of the machine: a corrected
       trade had nowhere to live in the pack, so a canon written back without these fields would be
       re-derived from the hull on every fresh campaign — the A5 flattening returning through the canon
       itself, which is worse than having no canon. `primaryHull` is a CHASSIS for the same reason it is
       one on the Pilot record: an instanceId dies with the machine. */
    pilot: { callsign: string; name?: string | null; gunnery?: number | null; piloting?: number | null; trade?: string | null; primaryHull?: string | null } | null;
    pilotPrimary?: boolean; // ODM-15b — false marks the SECONDARY seat of a stable (absent = primary)
    catalog?: { name: string; mulId: number; tons: number; bv: number; type: string };
}
/** ODM-26 piece 4 — an authored BENCH entry. MIRRORS the seat's `pilot` object exactly (ruling 1): same
 *  shape, same optional fields, nothing new to parse, and piece 1's schema addition applies unchanged. */
interface OdmBenchPilot { callsign?: string; name: string; gunnery?: number | null; piloting?: number | null; trade?: string | null; primaryHull?: string | null }
interface OdmRoster {
    company: { name: string; designation: string };
    units: OdmRosterUnit[];
    /* ODM-26 piece 4 — THE BENCH, so the canon reproduces itself. roster.json models SEATS, so an
       unassigned person had nowhere to live: writing a campaign back lost them, and the next mint rolled
       three strangers in their place. 29 people in, 31 out — a nearly-faithful baseline, and "nearly" is
       the word this week was spent removing.

       ABSENT → GENERATE AS TODAY. PRESENT → USE VERBATIM AND GENERATE NOTHING — no top-up even when the
       authored bench is smaller than the sparePct formula would produce, because a top-up reintroduces
       exactly the drift this exists to close. Authored wins over derived, the same rule as trade. Every
       existing pack has no bench and is therefore bit-for-bit unaffected. */
    bench?: OdmBenchPilot[];
}
/** ODM-2 — one entry of the manifest's mission index. */
export interface OdmMissionEntry {
    id: string; title: string; system?: string; threat?: string; cycle?: number;
    files?: { package?: string; fragord?: string; opfor?: string };
}
interface OdmCampaign {
    packId: string; title: string;
    era: { bceEraId: number; yearWindow: [number, number] };
    startDate: { y: number; m: number; d: number };
    factions: { player: string; opfor: string[] };
    treasuryStart: number;
}

@Injectable({ providedIn: 'root' })
export class OdmCreateService {
    private readonly state = inject(NewCampaignState);
    private readonly store = inject(CampaignSaveStore);
    private readonly data = inject(DataService);
    private readonly http = inject(HttpClient);
    private readonly router = inject(Router);

    private uid(): string { return globalThis.crypto?.randomUUID?.() ?? 'u-' + Math.random().toString(36).slice(2) + Date.now().toString(36); }

    private base(): string { return localStorage.getItem('bce.engine.url') || 'http://localhost:3000/api'; }

    private fetchPack<T>(file: string): Promise<T> {
        return firstValueFrom(this.http.get<T>(`${this.base()}/pack/odm/file/${file}`, { withCredentials: true }));
    }

    /** ODM-3 — the briefing deep-link handoff: the missions board sets the packet id, the (remounted)
     *  briefing tab's constructor prefers it over the manifest's first mission, then clears it. */
    readonly briefingFocus = signal<string | null>(null);

    /** ODM-15b — the pack roster (the stables migration reads pilotPrimary markers from it; null-tolerant). */
    async rosterJson(): Promise<OdmRoster | null> {
        try { return await this.fetchPack<OdmRoster>('roster.json'); }
        catch { return null; }
    }

    /** ODM-3 — the authored campaign tree (packs/odm/tree.json; non-opfor class — serves permissive like the rest). */
    async treeJson(): Promise<OdmTreeData | null> {
        try { return await firstValueFrom(this.http.get<OdmTreeData>(`${this.base()}/pack/odm/file/tree.json`, { withCredentials: true })); }
        catch { return null; }
    }

    /** The pack manifest (title/blurb) — the cover door's copy source (server-served; NEVER baked into the bundle). */
    async manifest(): Promise<{ packId: string; title: string; blurb?: string } | null> {
        try { return await firstValueFrom(this.http.get<{ packId: string; title: string; blurb?: string }>(`${this.base()}/pack/odm/manifest`, { withCredentials: true })); }
        catch { return null; }
    }

    // ── ODM-2 — mission packets (GM briefing surface; server-served, entitlement-gated, never bundled/persisted) ──
    /** The manifest's mission index (id/title/system/threat + per-doc paths). */
    async missionIndex(): Promise<OdmMissionEntry[]> {
        try {
            const m = await firstValueFrom(this.http.get<{ missions?: OdmMissionEntry[] }>(`${this.base()}/pack/odm/manifest`, { withCredentials: true }));
            return m?.missions ?? [];
        } catch { return []; }
    }
    /** ODM-7 — the mission's authored FORCE-SPEC (opfor-spec.json: the opfor* name keeps it behind the ruled
     *  LAN gate + hosted entitlement, exactly like opfor.md). null = not authored yet / not entitled. */
    async opforSpec(missionId: string): Promise<import('./odm-opfor-roll').OdmForceSpec | null> {
        try { return await firstValueFrom(this.http.get<import('./odm-opfor-roll').OdmForceSpec>(`${this.base()}/pack/odm/missions/${encodeURIComponent(missionId)}/opfor-spec.json`, { withCredentials: true })); }
        catch { return null; }
    }

    /** One mission packet document as raw tagged markdown (package | fragord | opfor). */
    async missionDoc(missionId: string, kind: 'package' | 'fragord' | 'opfor' | 'maps'): Promise<string | null> {
        try { return await firstValueFrom(this.http.get(`${this.base()}/pack/odm/missions/${encodeURIComponent(missionId)}/${kind}.md`, { withCredentials: true, responseType: 'text' })); }
        catch { return null; }
    }

    /** Create + persist the ODM campaign, then land on the (odm-routed) dashboard. Throws on fetch/mint failure. */
    async begin(): Promise<void> {
        const [cfg, roster, treeData] = await Promise.all([
            this.fetchPack<OdmCampaign>('campaign-odm.json'), this.fetchPack<OdmRoster>('roster.json'),
            this.treeJson(), // ODM-3 — the authored tree (null-tolerant: the dashboard's ensure re-tries)
        ]);
        // catalog must be resident to resolve the roster (the merc-command ensure pattern; full catalog is the safe path here)
        if (!this.data.isFullLoaded()) await this.data.ensureFullCatalog();
        const units = this.data.getUnits();
        const byKey = new Map(units.map((u) => [(u.chassis + '|' + u.model).toLowerCase(), u]));

        const s = this.state;
        s.reset();
        s.setCampaignSystem('traditional'); // ODM rides the CLASSIC base (no Hot Spots anything)
        s.packId.set(cfg.packId);
        s.odmStocks.set(odmStartingStocks()); // ODM-11 — the survival economy, seeded from the authored pack ledger
        const startDate = cfg.startDate;

        const force: ProtoInstance[] = [];
        const pilotSeeds: { instanceId: string; callsign: string | null; name: string | null; gunnery: number | null; piloting: number | null; trade: string | null; primaryHull: string | null; primaryMarked: boolean; active: boolean; label: string }[] = [];
        const tradeByInstance = new Map<string, string>(); // ODM-15 — the muster stamp source (catalog type known HERE)
        for (const r of roster.units) {
            const cat = byKey.get((r.chassis + '|' + r.variant).toLowerCase());
            const meta = r.catalog; // build-time verified fallback (all 28 resolve; the live catalog wins when present)
            if (!cat && !meta) continue; // never mint an unresolvable unit
            const inst: ProtoInstance = {
                instanceId: this.uid(),
                unitRef: cat?.name ?? meta!.name,
                chassis: r.chassis, model: r.variant,
                mulId: cat?.id ?? meta!.mulId,
                tons: cat?.tons ?? meta!.tons,
                bv: cat?.bv ?? meta!.bv,
                unitType: (r.unitType === 'vehicle' ? 'vehicle' : 'mech'),
                // TESTER-ODM-1 #1 — authored status WINS AT MINT, and it mints as the condition that MEANS
                // it. This was 'In repair', which collided with HOTFIX-024's stranded-unit self-heal: that
                // pass frees any 'In repair' unit sitting in no bay with no damage (odm-repair-bays:91), so
                // all three authored cold hulls healed themselves to Active at campaign birth and the GM
                // read 28 ready machines when 25 is the truth. Fixed at the SOURCE rather than by teaching
                // the self-heal an exception: a mothballed machine was never in repair. 'Cold storage' is
                // also the honest state downstream — canDeploy excludes it, and donorStrip requires it.
                condition: r.coldStorage || r.mothballed ? 'Cold storage' : 'Active', // benched, not fielded (ruling 1)
                provenance: { origin: 'generated', acquiredDate: startDate },
            };
            force.push(inst);
            const trade = tradeForInstance(inst, cat?.type); // ODM-15 — Mek → mechwarrior · Tank → vehicle-crew
            if (trade) tradeByInstance.set(inst.instanceId, trade);
            if (r.pilot?.callsign || r.pilot?.name) pilotSeeds.push({ // name-only authored pilots are real people too (the 2026-08-28 promotions)
                instanceId: inst.instanceId, callsign: r.pilot.callsign ?? null, name: r.pilot.name ?? null,
                gunnery: r.pilot.gunnery ?? null, piloting: r.pilot.piloting ?? null,
                trade: r.pilot.trade ?? null,                     // ODM-26 — authored trade (absent → derived below)
                primaryHull: r.pilot.primaryHull ?? null,         // ODM-26 — authored primary hull (a CHASSIS)
                primaryMarked: r.pilotPrimary !== false,           // ODM-15b — pilotPrimary:false marks the SECONDARY seat
                active: r.status === 'active' && !r.coldStorage && !r.mothballed,
                label: `${r.chassis} ${r.variant}`.trim(),
            });
        }

        // ── ODM-15b — THE STABLES: one Pilot record per PERSON. A duplicated authored identity is a pilot
        // who owns two machines; the SECONDARY hull mints UNMANNED (a spare machine in the roster pull-down).
        // Rails: the pack marker, then prefer-active, then STOP — never mint the same person twice by guess. ──
        const seatInfos = pilotSeeds.map((x) => ({ instanceId: x.instanceId, identity: identityOf(x.name ?? '', x.callsign ?? undefined), primaryMarked: x.primaryMarked, active: x.active, label: x.label }));
        const secondarySeats = new Set<string>();
        const stableHullsByPrimarySeat = new Map<string, string[]>(); // ODM-15b ADDENDUM — the recoverable person→hulls linkage
        for (const [ident, group] of stableGroups(seatInfos)) {
            const primary = choosePrimary(group);
            if (!primary) throw new Error(`[odm-create] STABLE AMBIGUOUS — "${ident.split('|')[0]}" appears on ${group.map((g) => g.label).join(' + ')} with no usable pilotPrimary marker and no condition split; refusing to mint the same person twice. Fix the pack marker.`);
            for (const g of group) if (g !== primary) secondarySeats.add(g.instanceId);
            stableHullsByPrimarySeat.set(primary.instanceId, [primary.instanceId, ...group.filter((g) => g !== primary).map((g) => g.instanceId)]);
        }

        // pilots: generate the crew frame (assignment/spares logic), DROP the crew of secondary stable
        // hulls (those machines muster unmanned), then OVERLAY the pack's named pilots onto their seats.
        // ODM-15 — the MUSTER STAMP: each assigned pilot's trade comes from the machine that mustered them.
        // The bench spares generatePilots mints (max(1, ceil(n×0.1)) — 3 at this roster) have NO machine and
        // therefore NO stamp: per ruling A4 they render "Unassigned — awaiting posting", never a guess.
        let pilots: Pilot[] = generatePilots(force, 'Veteran')
            .filter((pl) => !(pl.assignedInstanceId && secondarySeats.has(pl.assignedInstanceId))) // the unmanned stable hulls
            .map((pl) => {
                const derived = pl.assignedInstanceId ? tradeByInstance.get(pl.assignedInstanceId) : undefined;
                const seed = pilotSeeds.find((x) => x.instanceId === pl.assignedInstanceId);
                /* ── ODM-26 option 2 piece 2 — AUTHORED WINS OVER DERIVED, and it is the same shape as
                   ODM-25's stamp-if-absent: the pack SAYS who someone is, and the hull only answers when
                   the pack is silent. Without this precedence a written-back canon would be undone at
                   every mint — the machine would re-stamp the person, which is exactly the A5 behaviour
                   ODM-25 superseded, arriving through the one file that is supposed to be authoritative.
                   An unrecognised authored value is carried THROUGH, not corrected: the pack is the
                   master, and a mint that silently rewrites its master is the bug, not the guard. ── */
                const trade = seed?.trade ?? derived;
                const withTrade = trade ? { ...pl, trade } : pl;
                if (!seed) return withTrade;
                const stableHulls = pl.assignedInstanceId ? stableHullsByPrimarySeat.get(pl.assignedInstanceId) : undefined;
                return {
                    ...withTrade,
                    name: seed.name ?? pl.name,
                    callsign: seed.callsign ?? undefined, // a name-only authored pilot carries NO callsign (never the rolled one)
                    gunnery: seed.gunnery ?? pl.gunnery,
                    piloting: seed.piloting ?? pl.piloting,
                    named: true,
                    ...(seed.primaryHull ? { primaryHull: seed.primaryHull } : {}), // ODM-26 — authored, else unset
                    ...(stableHulls ? { stableHulls } : {}), // ADDENDUM — the seed of the future familiarity list
                };
            });
        /* ── ODM-26 piece 4 — THE AUTHORED BENCH REPLACES THE GENERATED SPARES, verbatim and without a
           top-up. The spares are exactly the unassigned records generatePilots minted; when the pack
           authors a bench we drop them wholesale and mint the authored people instead, so the roster
           reproduces person-for-person instead of re-rolling strangers.

           Each entry is shaped through the same generator the rest of the roster uses (a throwaway seed
           gives a fully-formed Pilot — id, status, bio, recordsBegin), then the authored identity is
           overlaid and the assignment stripped. `named: true` is load-bearing: it makes the collision belt
           below THROW on a bench identity that duplicates a seated one, rather than quietly re-rolling the
           authored person's name. trade and primaryHull are spread conditionally — an unassigned crew
           member has no hull and may have no trade, and ABSENT MUST STAY ABSENT rather than becoming a
           literal "unset" string, which would then filter them out of every trade-pruned crew list. ── */
        if (Array.isArray(roster.bench)) {
            const benchPilots: Pilot[] = roster.bench.filter((b) => b?.name).map((b) => {
                const seedInst: ProtoInstance = { instanceId: `bench-${this.uid()}`, unitRef: '', chassis: '', model: '', mulId: 0, tons: 50, bv: 1000, condition: 'Active' };
                const shell = generatePilots([seedInst], 'Veteran')[0];
                return {
                    ...shell,
                    assignedInstanceId: undefined, // the bench holds no machine — that is what makes it the bench
                    name: b.name,
                    callsign: b.callsign ?? undefined,
                    gunnery: b.gunnery ?? shell.gunnery,
                    piloting: b.piloting ?? shell.piloting,
                    named: true,
                    ...(b.trade ? { trade: b.trade } : {}),
                    ...(b.primaryHull ? { primaryHull: b.primaryHull } : {}),
                };
            });
            pilots = [...pilots.filter((pl) => pl.assignedInstanceId), ...benchPilots];
        }

        // ODM-15b belt — a GENERATED name (bench / unauthored seat) can coincidentally collide with an
        // authored identity: that would be a second false "same person". Re-mint the generated pilot's
        // identity from a synthetic seed (bounded); two colliding AUTHORED records outside a ruled stable
        // would have thrown above. Nothing here renames an authored pilot.
        for (let tries = 0; tries < 20; tries++) {
            const seen = new Map<string, number>();
            pilots.forEach((pl, i) => { const k = identityOf(pl.name, pl.callsign); if (!seen.has(k)) seen.set(k, i); });
            const clashIdx = pilots.findIndex((pl, i) => seen.get(identityOf(pl.name, pl.callsign)) !== i);
            if (clashIdx < 0) break;
            const clash = pilots[clashIdx];
            if (clash.named) throw new Error(`[odm-create] AUTHORED identity duplicated outside a ruled stable: "${clash.name}" — fix the pack.`);
            const seedInst: ProtoInstance = { instanceId: `re-${this.uid()}`, unitRef: '', chassis: '', model: '', mulId: 0, tons: 50, bv: 1000, condition: 'Active' };
            const fresh = generatePilots([seedInst], 'Veteran')[0];
            pilots = pilots.map((pl, i) => (i === clashIdx ? { ...pl, name: fresh.name, callsign: fresh.callsign } : pl));
        }

        s.setEra({ id: cfg.era.bceEraId, name: 'Amaris Civil War', from: cfg.era.yearWindow[0], to: cfg.era.yearWindow[1] }); // the pack's locked window INSIDE BCE era 2 (Star League) — era config, not new machinery
        s.setForce('SLDF'); // not MERC — no contract layer, no merc framing (refreshTick self-gates on force!=='MERC')
        s.setFaction(roster.company.name);
        s.setUnit('__custom__');
        s.setUnitSize({ id: 'custom', name: roster.company.designation, count: force.length });
        s.setCommandName(roster.company.name);
        s.setResources('normal'); // the dashboard entry guard (benign label — the D-113 precedent)
        s.setTreasury(cfg.treasuryStart);
        s.setStartDate(startDate);
        s.setCurrentDate(startDate);
        s.setStartingForce(force);
        s.setPilots(pilots);
        s.setCurrentLocation(null);
        // The STANDING ORDER — the mission loop's ignition (the D-110b synthetic-offer precedent): Classic's
        // missions zone + generator key off an ACTIVE accepted contract. ODM has no contracts (IRON RULE), so a
        // synthetic zero-pay standing order carries the OpFor faction + mission posture instead. Pay 0 + the
        // pack-gated clock ticks = no C-bill income ever flows from it.
        s.setAcceptedContract({
            id: 'odm-standing-orders',
            employer: { name: 'SLDF High Command', tier: 'independent', generic: true, img: null },
            target: cfg.factions.opfor[0] ?? 'Rim Worlds Republic - Terran Corps',
            missionType: 'GUERRILLA_WARFARE', // the generator FAMILY (raid-shaped) — never player-visible
            missionName: 'Standing Orders', // ODM-3 — the DISPLAY name (roster cell + flow header render it; no merc-contract framing)
            durationMonths: 156, // Kerensky is thirteen years away
            command: 'Independent',
            salvage: { pct: 100, exchange: false },
            support: { kind: 'none', pct: 0 },
            transportPct: 0,
            rolls: { command: 0, salvage: 0, support: 0, transport: 0 },
            pay: { total: 0, monthly: 0, base: 0, multiplier: 0 },
            status: 'ACTIVE',
        } as never); // shaped to ContractOffer (typed as the state's signal; 'as never' avoids an odm->classic type import)
        // ODM-3 — pre-mint the AUTHORED tree: a non-empty tree suppresses ensureTree's default merc opener
        // (the synthetic guerrilla stack never exists), and the board renders 2 AVAILABLE + 4 LOCKED from it.
        if (treeData?.nodes?.length) s.setMissionTree(mintOdmBranches(treeData, startDate)); // ODM-5: windows apply from Day 1
        await this.store.beginSave();
        await this.router.navigate(['/campaign']);
    }
}
