export function shapeSnapshot(snap: unknown, isGm: boolean, recipientAnon?: string | null): unknown {
    if (isGm) return snap; // a GM recipient gets the whole record — including gmOnly
    if (snap === null || typeof snap !== 'object' || Array.isArray(snap)) return snap;
    const o = snap as Record<string, unknown>;
    const pilots = o['pilots'];
    const notesRide = Array.isArray(pilots) && pilots.some((p) => p !== null && typeof p === 'object' && 'gmNotes' in (p as Record<string, unknown>));
    if (!('gmOnly' in o) && !notesRide) return snap; // neither key → pass through by reference
    const { gmOnly: _gmOnly, ...rest } = o;
    void _gmOnly; // deleted, never read — the server does not parse GM truth
    if (notesRide) {
        rest['pilots'] = (pilots as unknown[]).map((p) => {
            if (p === null || typeof p !== 'object' || !('gmNotes' in (p as Record<string, unknown>))) return p;
            const { gmNotes: _n, ...pr } = p as Record<string, unknown>;
            void _n;
            return pr;
        });
    }
    // id]) rides top-level as `participantContract` to the device that brought that company — and to no other device
    // → that import's sourceCampaignId. The server reads exactly those keys and parses nothing else of the contract.
    const own = recipientAnon ? ownContractOf(o, recipientAnon) : null;
    if (own) rest['participantContract'] = own;
    // top-level as `participantVoid` (the notice + the rep refund) — to that device only, parsed no deeper than the key.
    const voided = recipientAnon ? ownVoidOf(o, recipientAnon) : null;
    if (voided) rest['participantVoid'] = voided;
    return rest;
}

export function ownVoidOf(o: Record<string, unknown>, recipientAnon: string): Record<string, unknown> | null {
    const gm = o['gmOnly'];
    if (gm === null || typeof gm !== 'object' || Array.isArray(gm)) return null;
    const map = (gm as Record<string, unknown>)['voidedContracts'];
    if (map === null || typeof map !== 'object' || Array.isArray(map)) return null;
    for (const key of ownCompanyKeysOf(o, recipientAnon)) {
        const v = (map as Record<string, unknown>)[key];
        if (v !== null && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
    }
    return null;
}

/** The recipient's own participant contract, or null: the first player-import in `startingForce` owned by this anonId
 *  names its home campaign; the map under gmOnly is read at that key. Malformed shapes → null, never a throw. */
export function ownContractOf(o: Record<string, unknown>, recipientAnon: string): Record<string, unknown> | null {
    const gm = o['gmOnly'];
    if (gm === null || typeof gm !== 'object' || Array.isArray(gm)) return null;
    const map = (gm as Record<string, unknown>)['participantContracts'];
    if (map === null || typeof map !== 'object' || Array.isArray(map)) return null;
    for (const key of ownCompanyKeysOf(o, recipientAnon)) {
        const c = (map as Record<string, unknown>)[key];
        if (c !== null && typeof c === 'object' && !Array.isArray(c)) return c as Record<string, unknown>;
    }
    return null;
}

export function ownCompanyKeysOf(o: Record<string, unknown>, recipientAnon: string): string[] {
    const force = o['startingForce'];
    if (!Array.isArray(force)) return [];
    const out: string[] = [];
    for (const u of force) {
        const prov = (u as { provenance?: { origin?: unknown; owner?: unknown; sourceCampaignId?: unknown } } | null)?.provenance;
        if (!prov || prov.origin !== 'player-import' || prov.owner !== recipientAnon || typeof prov.sourceCampaignId !== 'string') continue;
        if (!out.includes(prov.sourceCampaignId)) out.push(prov.sourceCampaignId);
    }
    return out;
}
