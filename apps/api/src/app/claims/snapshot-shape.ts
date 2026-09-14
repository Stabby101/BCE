/*
 * GM-1 P2 — the gmOnly SNAPSHOT SHAPE (the P0 R1×P2 architectural ruling). The campaign snapshot may carry
 * ONE well-known top-level key — `gmOnly` — and the campaign fan STRIPS that key for every non-GM recipient.
 * The server DELETES it, never parses it: blob-first opacity is preserved as a structural convention. The
 * strip is recipient-conditional, not gmSession-conditional — it runs on every campaign and is a no-op
 * without the key (a legacy/plain snapshot passes through by reference).
 *
 * ODM-18 P1 (panel finding) — the LEGACY field joins the strip: `pilots[].gmNotes` predates the gmOnly
 * relocation and a pre-migration ODM snapshot still carries it AT REST; the client-side migration runs only
 * when the GM device next loads the campaign, so until then every campaign-sync would hand players the GM's
 * private pilot notes verbatim. Stripping the known legacy FIELD NAME is deletion, not parsing — the same
 * opacity rule as gmOnly itself (the value is never read).
 *
 * NON-MUTATING (roster-redact's discipline): at the fan the snapshot is parsed ONCE and the same object
 * instance goes to every recipient — the strip returns a NEW object and never deletes on the shared one.
 */
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
    // GM-2 P2a — the per-recipient ATTACH: a joined company's OWN contract (gmOnly.participantContracts[its home campaign
    // id]) rides top-level as `participantContract` to the device that brought that company — and to no other device
    // (H14). The recipient is matched by the mint's provenance.owner (the anonId of its device token, HARDEN-5b's handle)
    // → that import's sourceCampaignId. The server reads exactly those keys and parses nothing else of the contract.
    const own = recipientAnon ? ownContractOf(o, recipientAnon) : null;
    if (own) rest['participantContract'] = own;
    // GM-3 P1 — the same attach for a VOIDED contract (un-present): the recipient's own entry in gmOnly.voidedContracts rides
    // top-level as `participantVoid` (the notice + the rep refund) — to that device only, parsed no deeper than the key.
    const voided = recipientAnon ? ownVoidOf(o, recipientAnon) : null;
    if (voided) rest['participantVoid'] = voided;
    return rest;
}

/** GM-3 P1 — the recipient's own VOIDED contract (gmOnly.voidedContracts at its home campaign key), or null. */
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

/** GM-2 P2b — the home campaign ids a recipient's device brought (in roster order): every player-import owned by this
 *  anonId names its home. The sign-contract handler uses it to hold a phone to ITS OWN company. Malformed → []. */
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
