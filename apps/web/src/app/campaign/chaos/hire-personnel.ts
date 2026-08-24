/*
 * DIRECTIVE-IMPORT-3 Part 2 — hireable special personnel: the PURE logic (charge decision, afford guard, and the
 * ProtoInstance / Pilot mint). Kept dep-free (type-only imports) so the SP-cost + afford rules are unit-testable
 * in isolation; the panel component wires these to the Warchest + roster. HS-only, additive.
 */
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
    role?: string;            // IMPORT-6 FOLLOWUPS — the hireable's role (display; rides onto the player brief's "fielded" line)
}

/** IMPORT-6 FOLLOWUPS — a RESULTS-ONLY view of the special personnel actually HIRED and fielded: the row shape stamped
 *  onto MissionForge.hiredWithYou (persisted with the spec → the player brief renders it from the record). Built from
 *  the hire lifecycle records + the minted unit/pilot — NEVER from the offer list (HotSpotBrief.hireable stays GM-side;
 *  no spCost / oneTimeHire / edge here). Pure. */
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

/** IMPORT-3 P2 — the SP charge to FIELD a hireable: `spCost` per track, EXCEPT a `oneTimeHire` already paid for
 *  this contract → 0 (fielded free thereafter). Pure + data-driven (the exact spCost is author/book data, so
 *  per-track-vs-per-contract is a flag, never hard-coded). */
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

/** Mint the merc's NAMED pilot, linked to the instance, with a campaign card (Edge from the hireable). Named so
 *  it renders on the pilot card + deploy cell like any pilot, and shares combat-pay at resolve (D-125). */
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
