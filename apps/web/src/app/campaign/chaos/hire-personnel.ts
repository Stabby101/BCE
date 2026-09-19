import type { HotSpotHireable } from './hotspots-catalog';
import type { ProtoInstance } from '../force/force-generator';
import type { Pilot } from '../barracks/pilot-generator';
import { initCampaignPilot } from './pilot-card';

/** A merc currently fielded — the record that ties the hireable to its minted force unit + pilot for the lifecycle
 *  (per-track release, contract-close cleanup, refund-on-release). Persisted with the campaign. */
export interface HiredMerc {
    key: string;              // the hireable's name — its identity within a hot spot
    name: string;
    instanceId: string;       // the minted ProtoInstance in startingForce
    pilotId: string;          // the minted Pilot
    charged: number;          // SP actually debited at hire (0 = a free one-time re-field)
    oneTimeHire: boolean;
    branchId: string | null;  // the track (mission branch) it was hired for (per-track lifecycle)
    role?: string;
}

export interface HiredWithYou { name: string; role: string; chassis?: string; model?: string; gunnery: number; piloting: number; }
export function hiredWithYouRows(
    hired: readonly HiredMerc[] | null | undefined,
    force: readonly { instanceId: string; chassis?: string; model?: string }[] | null | undefined,
    pilots: readonly { pilotId: string; gunnery: number; piloting: number }[] | null | undefined,
): HiredWithYou[] {
    return (hired ?? []).map((m) => {
        const inst = (force ?? []).find((i) => i.instanceId === m.instanceId);
        const p = (pilots ?? []).find((x) => x.pilotId === m.pilotId);
        return {
            name: m.name, role: m.role ?? '',
            ...(inst?.chassis ? { chassis: inst.chassis } : {}),
            ...(inst?.model ? { model: inst.model } : {}),
            gunnery: p?.gunnery ?? 0, piloting: p?.piloting ?? 0,
        };
    });
}

export function mercHireCharge(h: HotSpotHireable, alreadyPaidKeys: readonly string[]): number {
    if (h.oneTimeHire && alreadyPaidKeys.includes(h.name)) return 0;
    return Math.max(0, Math.round(h.spCost || 0));
}

/** No debt: an unaffordable hire is blocked. A 0 charge (free one-time re-field) always passes. */
export function canAffordHire(warchestSP: number, charge: number): boolean {
    return charge <= 0 || warchestSP >= charge;
}

let seq = 0;
const uid = (p: string): string => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

/** A resolved catalog unit (the fields the mint reads) — the panel resolves the merc's chassis against the unit
 *  catalog and passes it here when found, so a real 'Mech's bv/model/tons/mulId are used. */
export interface ResolvedMercUnit { name: string; chassis: string; model: string; id: number; tons: number; bv: number; type?: string; }

/** Mint the merc's DEPLOYED 'Mech. A resolved catalog `unit` wins for bv/model/tons/mulId; else the hireable's own
 *  data; else advisory defaults (bv 0). condition 'Deployed' → it fields for this track immediately. */
export function buildMercInstance(h: HotSpotHireable, unit?: ResolvedMercUnit): ProtoInstance {
    const chassis = unit?.chassis ?? h.chassis ?? h.name;
    return {
        instanceId: uid('merc'),
        unitRef: unit?.name ?? chassis,
        chassis,
        model: unit?.model ?? h.model ?? '',
        mulId: unit && unit.id > 0 ? unit.id : 0, // PLATFORM-1 — never persist the catalog's -1 sentinel
        tons: unit?.tons ?? 0,
        bv: unit?.bv ?? h.bv ?? 0,
        unitType: unit?.type === 'Tank' || unit?.type === 'VTOL' ? 'vehicle' : 'mech',
        condition: 'Deployed',
        provenance: { origin: 'hired-merc' },
    };
}

export function buildMercPilot(h: HotSpotHireable, instanceId: string): Pilot {
    const pilot: Pilot = {
        pilotId: uid('mercp'),
        name: h.name,
        gunnery: Math.round(h.gunnery),
        piloting: Math.round(h.piloting),
        status: 'Active',
        assignedInstanceId: instanceId,
        named: true,
    };
    pilot.campaignPilot = { ...initCampaignPilot(pilot), edgeTokens: Math.max(1, Math.round(h.edge ?? 1)) };
    return pilot;
}
