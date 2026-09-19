import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { NewCampaignState } from '../new-campaign-state';
import { CampaignSaveStore } from '../campaign-save-store';
import { DataService } from '../../services/data.service';
import { generatePilots, type Pilot } from '../barracks/pilot-generator';
import type { ProtoInstance } from '../force/force-generator';
import { mintOdmBranches, type OdmTreeData } from './odm-tree';
import { odmStartingStocks } from './odm-stocks';
import { tradeForInstance } from './odm-trades';
import { identityOf, stableGroups, choosePrimary } from './odm-stables';

interface OdmRosterUnit {
    chassis: string; variant: string; displayName: string; unitType: string;
    status?: string | null; coldStorage: boolean; mothballed: boolean; damage?: string | null;
    pilot: { callsign: string; name?: string | null; gunnery?: number | null; piloting?: number | null; trade?: string | null; primaryHull?: string | null } | null;
    pilotPrimary?: boolean;
    catalog?: { name: string; mulId: number; tons: number; bv: number; type: string };
}
interface OdmBenchPilot { callsign?: string; name: string; gunnery?: number | null; piloting?: number | null; trade?: string | null; primaryHull?: string | null }
interface OdmRoster {
    company: { name: string; designation: string };
    units: OdmRosterUnit[];
    bench?: OdmBenchPilot[];
}
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

    readonly briefingFocus = signal<string | null>(null);

    async rosterJson(): Promise<OdmRoster | null> {
        try { return await this.fetchPack<OdmRoster>('roster.json'); }
        catch { return null; }
    }

    async treeJson(): Promise<OdmTreeData | null> {
        try { return await firstValueFrom(this.http.get<OdmTreeData>(`${this.base()}/pack/odm/file/tree.json`, { withCredentials: true })); }
        catch { return null; }
    }

    /** The pack manifest (title/blurb) — the cover door's copy source (server-served; NEVER baked into the bundle). */
    async manifest(): Promise<{ packId: string; title: string; blurb?: string } | null> {
        try { return await firstValueFrom(this.http.get<{ packId: string; title: string; blurb?: string }>(`${this.base()}/pack/odm/manifest`, { withCredentials: true })); }
        catch { return null; }
    }

    /** The manifest's mission index (id/title/system/threat + per-doc paths). */
    async missionIndex(): Promise<OdmMissionEntry[]> {
        try {
            const m = await firstValueFrom(this.http.get<{ missions?: OdmMissionEntry[] }>(`${this.base()}/pack/odm/manifest`, { withCredentials: true }));
            return m?.missions ?? [];
        } catch { return []; }
    }
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
            this.treeJson(),
        ]);
        // catalog must be resident to resolve the roster (the merc-command ensure pattern; full catalog is the safe path here)
        if (!this.data.isFullLoaded()) await this.data.ensureFullCatalog();
        const units = this.data.getUnits();
        const byKey = new Map(units.map((u) => [(u.chassis + '|' + u.model).toLowerCase(), u]));

        const s = this.state;
        s.reset();
        s.setCampaignSystem('traditional'); // ODM rides the CLASSIC base (no Hot Spots anything)
        s.packId.set(cfg.packId);
        s.odmStocks.set(odmStartingStocks());
        const startDate = cfg.startDate;

        const force: ProtoInstance[] = [];
        const pilotSeeds: { instanceId: string; callsign: string | null; name: string | null; gunnery: number | null; piloting: number | null; trade: string | null; primaryHull: string | null; primaryMarked: boolean; active: boolean; label: string }[] = [];
        const tradeByInstance = new Map<string, string>();
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
                // pass frees any 'In repair' unit sitting in no bay with no damage (odm-repair-bays:91), so
                // all three authored cold hulls healed themselves to Active at campaign birth and the GM
                // read 28 ready machines when 25 is the truth. Fixed at the SOURCE rather than by teaching
                // the self-heal an exception: a mothballed machine was never in repair. 'Cold storage' is
                // also the honest state downstream — canDeploy excludes it, and donorStrip requires it.
                condition: r.coldStorage || r.mothballed ? 'Cold storage' : 'Active', // benched, not fielded (ruling 1)
                provenance: { origin: 'generated', acquiredDate: startDate },
            };
            force.push(inst);
            const trade = tradeForInstance(inst, cat?.type);
            if (trade) tradeByInstance.set(inst.instanceId, trade);
            if (r.pilot?.callsign || r.pilot?.name) pilotSeeds.push({ // name-only authored pilots are real people too (the 2026-08-28 promotions)
                instanceId: inst.instanceId, callsign: r.pilot.callsign ?? null, name: r.pilot.name ?? null,
                gunnery: r.pilot.gunnery ?? null, piloting: r.pilot.piloting ?? null,
                trade: r.pilot.trade ?? null,
                primaryHull: r.pilot.primaryHull ?? null,
                primaryMarked: r.pilotPrimary !== false,
                active: r.status === 'active' && !r.coldStorage && !r.mothballed,
                label: `${r.chassis} ${r.variant}`.trim(),
            });
        }

        // who owns two machines; the SECONDARY hull mints UNMANNED (a spare machine in the roster pull-down).
        // Rails: the pack marker, then prefer-active, then STOP — never mint the same person twice by guess. ──
        const seatInfos = pilotSeeds.map((x) => ({ instanceId: x.instanceId, identity: identityOf(x.name ?? '', x.callsign ?? undefined), primaryMarked: x.primaryMarked, active: x.active, label: x.label }));
        const secondarySeats = new Set<string>();
        const stableHullsByPrimarySeat = new Map<string, string[]>();
        for (const [ident, group] of stableGroups(seatInfos)) {
            const primary = choosePrimary(group);
            if (!primary) throw new Error(`[odm-create] STABLE AMBIGUOUS — "${ident.split('|')[0]}" appears on ${group.map((g) => g.label).join(' + ')} with no usable pilotPrimary marker and no condition split; refusing to mint the same person twice. Fix the pack marker.`);
            for (const g of group) if (g !== primary) secondarySeats.add(g.instanceId);
            stableHullsByPrimarySeat.set(primary.instanceId, [primary.instanceId, ...group.filter((g) => g !== primary).map((g) => g.instanceId)]);
        }

        // pilots: generate the crew frame (assignment/spares logic), DROP the crew of secondary stable
        // hulls (those machines muster unmanned), then OVERLAY the pack's named pilots onto their seats.
        // The bench spares generatePilots mints (max(1, ceil(n×0.1)) — 3 at this roster) have NO machine and
        // therefore NO stamp: per ruling A4 they render "Unassigned — awaiting posting", never a guess.
        let pilots: Pilot[] = generatePilots(force, 'Veteran')
            .filter((pl) => !(pl.assignedInstanceId && secondarySeats.has(pl.assignedInstanceId))) // the unmanned stable hulls
            .map((pl) => {
                const derived = pl.assignedInstanceId ? tradeByInstance.get(pl.assignedInstanceId) : undefined;
                const seed = pilotSeeds.find((x) => x.instanceId === pl.assignedInstanceId);
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
                    ...(seed.primaryHull ? { primaryHull: seed.primaryHull } : {}),
                    ...(stableHulls ? { stableHulls } : {}), // ADDENDUM — the seed of the future familiarity list
                };
            });
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
        s.setResources('normal');
        s.setTreasury(cfg.treasuryStart);
        s.setStartDate(startDate);
        s.setCurrentDate(startDate);
        s.setStartingForce(force);
        s.setPilots(pilots);
        s.setCurrentLocation(null);
        // missions zone + generator key off an ACTIVE accepted contract. ODM has no contracts (IRON RULE), so a
        // synthetic zero-pay standing order carries the OpFor faction + mission posture instead. Pay 0 + the
        // pack-gated clock ticks = no C-bill income ever flows from it.
        s.setAcceptedContract({
            id: 'odm-standing-orders',
            employer: { name: 'SLDF High Command', tier: 'independent', generic: true, img: null },
            target: cfg.factions.opfor[0] ?? 'Rim Worlds Republic - Terran Corps',
            missionType: 'GUERRILLA_WARFARE', // the generator FAMILY (raid-shaped) — never player-visible
            missionName: 'Standing Orders',
            durationMonths: 156, // Kerensky is thirteen years away
            command: 'Independent',
            salvage: { pct: 100, exchange: false },
            support: { kind: 'none', pct: 0 },
            transportPct: 0,
            rolls: { command: 0, salvage: 0, support: 0, transport: 0 },
            pay: { total: 0, monthly: 0, base: 0, multiplier: 0 },
            status: 'ACTIVE',
        } as never); // shaped to ContractOffer (typed as the state's signal; 'as never' avoids an odm->classic type import)
        // (the synthetic guerrilla stack never exists), and the board renders 2 AVAILABLE + 4 LOCKED from it.
        if (treeData?.nodes?.length) s.setMissionTree(mintOdmBranches(treeData, startDate));
        await this.store.beginSave();
        await this.router.navigate(['/campaign']);
    }
}
