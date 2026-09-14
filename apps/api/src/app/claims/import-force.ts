/*
 * GM-1 P3 — JOIN-WITH-FORCE: the pure import-mint helpers (HARDEN-6 discipline — no Socket, no DI, no env).
 * The server is the ID AUTHORITY (re-mints instance/pilot ids so cross-campaign imports can never collide)
 * and the CAP AUTHORITY (playerUnitCap, default 4, counted against the owner's existing imports); the GM
 * client stays the SNAPSHOT AUTHOR (it merges the re-minted units and persists — the one-writer rule that
 * keeps the D-130 precedent and avoids racing the GM's debounced PUT). Ownership rides as
 * provenance { origin: 'player-import', owner: <anonId> } — the anonId, never the raw token (the snapshot
 * fans to every room member; raw tokens in it would be the HARDEN-5b leak class all over again).
 */

export interface ImportUnit {
    instanceId?: string; // GM-2 P1 — the HOME campaign's instance id (preserved as provenance.originInstanceId; never reused as the minted id)
    unitRef: string;
    chassis: string;
    model: string;
    mulId: number;
    tons: number;
    bv: number;
    unitType?: 'mech' | 'vehicle';
    damage?: unknown; // CBTSerializedState — opaque here; rides verbatim
}
export interface ImportPilot {
    pilotId?: string; // GM-2 P1 — the HOME campaign's pilot id (preserved as originPilotId)
    name: string;
    callsign?: string;
    gunnery: number;
    piloting: number;
    assignedInstanceId?: string; // the ORIGINAL instance id — remapped to the re-minted id
}

/** GM-2 P1 — the identity the company carries with it: where it came from (the home campaign) and which home unit /
 *  pilot each minted copy IS. The minted ids stay server-authored (collision-free); the origin rides beside them so the
 *  results slip can point a row back at the home campaign's own instance. Absent when the payload carries none
 *  (a pre-P1 client) — every consumer treats them as optional. */
export interface ImportProvenance { origin: 'player-import'; owner: string; sourceCampaignId?: string; originInstanceId?: string; homeReputation?: number } // GM-2 P2b — the company's home reputation (every minted unit carries it; the phone + the GM broker negotiate against it)
export interface MintedImport {
    units: Array<ImportUnit & { instanceId: string; condition: 'Deployed'; provenance: ImportProvenance }>;
    pilots: Array<ImportPilot & { pilotId: string; status: 'Active'; assignedInstanceId?: string; originPilotId?: string; named?: boolean }>;
    instanceIds: string[];
}

/** Re-mint every id under the server's own `imp-` scheme and remap pilot links in the same pass.
 *  `ownerAnon` = anonId(token) (prefixed 'anon-…'); `seq` = a caller-supplied uniqueness stamp (Date.now()).
 *  GM-2 P1 — `sourceCampaignId` (the player's HOME campaign, from the handshake) + each unit's / pilot's origin id are
 *  PRESERVED on the mint (provenance.sourceCampaignId / originInstanceId; pilot originPilotId). */
export function remintImport(units: readonly ImportUnit[], pilots: readonly ImportPilot[], ownerAnon: string, seq: number, sourceCampaignId?: string, reputation?: number): MintedImport {
    const tag = ownerAnon.replace(/^anon-/, '').slice(0, 8) || 'x';
    const idMap = new Map<string | undefined, string>();
    const src = { ...(typeof sourceCampaignId === 'string' && sourceCampaignId ? { sourceCampaignId } : {}), ...(typeof reputation === 'number' && Number.isFinite(reputation) ? { homeReputation: Math.max(0, Math.min(99, Math.round(reputation))) } : {}) }; // GM-2 P2b — + the home reputation
    const minted = units.map((u, i) => {
        const instanceId = `imp-${tag}-${seq % 1_000_000}-${i}`;
        const originInstanceId = typeof u.instanceId === 'string' && u.instanceId ? u.instanceId : undefined;
        idMap.set(originInstanceId, instanceId);
        return {
            unitRef: u.unitRef, chassis: u.chassis, model: u.model, mulId: u.mulId, tons: u.tons, bv: u.bv,
            ...(u.unitType ? { unitType: u.unitType } : {}),
            ...(u.damage != null ? { damage: u.damage } : {}),
            instanceId,
            condition: 'Deployed' as const, // the hired-merc precedent — invisible on the claim board otherwise
            provenance: { origin: 'player-import' as const, owner: ownerAnon, ...src, ...(originInstanceId ? { originInstanceId } : {}) },
        };
    });
    const mintedPilots = pilots.map((p, i) => ({
        name: p.name,
        ...(p.callsign ? { callsign: p.callsign } : {}),
        gunnery: p.gunnery, piloting: p.piloting,
        pilotId: `impp-${tag}-${seq % 1_000_000}-${i}`,
        status: 'Active' as const,
        ...(p.assignedInstanceId && idMap.has(p.assignedInstanceId) ? { assignedInstanceId: idMap.get(p.assignedInstanceId) } : {}),
        ...(typeof p.pilotId === 'string' && p.pilotId ? { originPilotId: p.pilotId, named: true } : {}), // GM-2 P1 (the home id) · P3 — a brought pilot is a NAMED pilot: the D-125 career-SP earn side credits it
    }));
    return { units: minted, pilots: mintedPilots, instanceIds: minted.map((u) => u.instanceId) };
}

/** How many units this owner has already imported into the campaign (reads the opaque snapshot defensively). */
export function countOwnedImports(snapshot: unknown, ownerAnon: string): number {
    if (!snapshot || typeof snapshot !== 'object') return 0;
    const force = (snapshot as { startingForce?: unknown }).startingForce;
    if (!Array.isArray(force)) return 0;
    return force.filter((i) => {
        const p = (i as { provenance?: { origin?: string; owner?: string } } | null)?.provenance;
        return p?.origin === 'player-import' && p?.owner === ownerAnon;
    }).length;
}

/** The GM-set per-player unit cap (top-level snapshot field; absent = the directive's default lance of 4). */
export function importCapOf(snapshot: unknown): number {
    const raw = (snapshot && typeof snapshot === 'object') ? (snapshot as { playerUnitCap?: unknown }).playerUnitCap : null;
    const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : 4;
    return Math.max(1, Math.min(24, n));
}
