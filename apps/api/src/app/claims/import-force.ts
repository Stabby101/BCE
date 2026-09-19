
export interface ImportUnit {
    instanceId?: string;
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
    pilotId?: string;
    name: string;
    callsign?: string;
    gunnery: number;
    piloting: number;
    assignedInstanceId?: string; // the ORIGINAL instance id — remapped to the re-minted id
}

export interface ImportProvenance { origin: 'player-import'; owner: string; sourceCampaignId?: string; originInstanceId?: string; homeReputation?: number }
export interface MintedImport {
    units: Array<ImportUnit & { instanceId: string; condition: 'Deployed'; provenance: ImportProvenance }>;
    pilots: Array<ImportPilot & { pilotId: string; status: 'Active'; assignedInstanceId?: string; originPilotId?: string; named?: boolean }>;
    instanceIds: string[];
}

export function remintImport(units: readonly ImportUnit[], pilots: readonly ImportPilot[], ownerAnon: string, seq: number, sourceCampaignId?: string, reputation?: number): MintedImport {
    const tag = ownerAnon.replace(/^anon-/, '').slice(0, 8) || 'x';
    const idMap = new Map<string | undefined, string>();
    const src = { ...(typeof sourceCampaignId === 'string' && sourceCampaignId ? { sourceCampaignId } : {}), ...(typeof reputation === 'number' && Number.isFinite(reputation) ? { homeReputation: Math.max(0, Math.min(99, Math.round(reputation))) } : {}) };
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
        ...(typeof p.pilotId === 'string' && p.pilotId ? { originPilotId: p.pilotId, named: true } : {}),
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
