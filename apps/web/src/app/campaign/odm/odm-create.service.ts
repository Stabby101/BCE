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

interface OdmRosterUnit {
    chassis: string; variant: string; displayName: string; unitType: string;
    status?: string | null; coldStorage: boolean; mothballed: boolean; damage?: string | null;
    pilot: { callsign: string; name?: string | null; gunnery?: number | null; piloting?: number | null } | null;
    catalog?: { name: string; mulId: number; tons: number; bv: number; type: string };
}
interface OdmRoster { company: { name: string; designation: string }; units: OdmRosterUnit[]; }
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
        const startDate = cfg.startDate;

        const force: ProtoInstance[] = [];
        const pilotSeeds: { instanceId: string; callsign: string; name: string | null; gunnery: number | null; piloting: number | null }[] = [];
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
                condition: r.coldStorage || r.mothballed ? 'In repair' : 'Active', // cold storage as-is (ruling 1): benched, not fielded
                provenance: { origin: 'generated', acquiredDate: startDate },
            };
            force.push(inst);
            if (r.pilot?.callsign) pilotSeeds.push({ instanceId: inst.instanceId, callsign: r.pilot.callsign, name: r.pilot.name ?? null, gunnery: r.pilot.gunnery ?? null, piloting: r.pilot.piloting ?? null });
        }

        // pilots: generate the crew frame (assignment/spares logic), then OVERLAY the pack's named pilots
        // (real names/callsigns/skills from the live campaign) onto their assigned units.
        const pilots: Pilot[] = generatePilots(force, 'Veteran').map((pl) => {
            const seed = pilotSeeds.find((x) => x.instanceId === pl.assignedInstanceId);
            if (!seed) return pl;
            return {
                ...pl,
                name: seed.name ?? pl.name,
                callsign: seed.callsign,
                gunnery: seed.gunnery ?? pl.gunnery,
                piloting: seed.piloting ?? pl.piloting,
                named: true,
            };
        });

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
