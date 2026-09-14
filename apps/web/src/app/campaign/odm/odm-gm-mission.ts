/*
 * DIRECTIVE-ODM-18 Phase 3 — the GM-COMPOSED MISSION (pure module, engine-odm scope).
 *
 * THE SPLIT (§S-4, the presented-hotspot pattern verbatim): a composed mission lives in TWO places.
 *   OdmGmDraft   — GM truth. Lives under snapshot `gmOnly.gmMissionDrafts`, which the server DELETES for
 *                  every non-GM recipient (unparsed), so design notes never reach a player device.
 *   OdmGmMission — the PUBLISHED, player-safe record, DERIVED from the draft by publishRecord() and stored
 *                  TOP-LEVEL so the normal fan carries it. The derive is a field WHITELIST, never a spread:
 *                  a new GM-only draft field cannot leak by being forgotten.
 *
 * THE MERGE (§S-1, the ruled step one): a published mission projects to an OdmTreeNode carrying the explicit
 * `kind: 'gm-mission'`, and mergeGmMissions() hands the runtime the AUTHORED ∪ PUBLISHED node set. The
 * ODM-4 Part A delete rule in reconcileOdmTree is UNTOUCHED — it still strips every branch it cannot find a
 * node for; what changed is that a published mission now legitimately HAS a node. Authored nodes reconcile
 * byte-identically (the merge appends; it never rewrites an authored entry).
 *
 * §S-2 — a composed node carries the fields odmNodeDef() would have supplied from tree.json: resolveFlags
 * (the GM's checklist), opDays (the real time cost — a composed operation that costs zero days is a lie the
 * clock tells), and, through the node, the 4-tier picker and the odmOutcomes entry.
 */
import type { ProtoInstance } from '../force/force-generator';
import type { OdmDate, OdmTreeData, OdmTreeNode } from './odm-tree';

/** The published, PLAYER-SAFE record (top-level snapshot key — it fans to every joined device). */
export interface OdmGmMission {
    id: string;                 // 'gm-…' namespaced (§S-8: composed ids share the odmOutcomes/odmSeeds keyspace)
    title: string;
    system: string;
    threat: string;
    brief: string;              // the GM's player-facing prose — the mission document for a composed op
    objectives: { primary: string; secondary: string; bonus: string };
    opDays: number;
    opforForce: ProtoInstance[]; // fans by the ODM-9 ruling (units on a table are not intel)
    opforBv: number;
    publishedAt: OdmDate;
}

/** The GM-side DRAFT — everything above PLUS GM-only truth. NEVER stored outside gmOnly. */
export interface OdmGmDraft extends OdmGmMission {
    gmNotes: string;            // design commentary, the intended twist — GM eyes only
    // PANEL FIX — the resolve checklist is GM-ONLY: "did the convoy survive?" is lookahead that tells
    // players what the operation is really about. It lives on the DRAFT and reaches the node through the
    // merge's draft argument, never through the fanned record.
    resolveFlags: { id: string; label: string }[];
    published: boolean;
    nextIdx: number;            // PANEL FIX — a MONOTONIC OpFor id counter (never the array length)
}

/** DOCTRINE §7c — the ODM legality year. The composed OpFor pool is era-legal by default (the pack's own
 *  bar); an off-list pick is a deliberate GM act, tagged as such, never the default. */
export const ODM_LEGALITY_YEAR = 2767;

/** The honest opDays default: the AUTHORED median (§S-2 — surfaced in the form, GM-editable). Falls back to
 *  the shared 12 when the pack is unreachable, which is what every consumer already assumes. */
export function medianOpDays(tree: OdmTreeData | null): number {
    const xs = (tree?.nodes ?? []).map((n) => n.opDays ?? 12).sort((a, b) => a - b);
    if (!xs.length) return 12;
    const m = Math.floor(xs.length / 2);
    return xs.length % 2 ? xs[m] : Math.round((xs[m - 1] + xs[m]) / 2);
}

/** A published mission AS a tree node. `kind` is the explicit merge key — nothing infers gm-ness from a
 *  missing packet or an id prefix. `packet: null` is the truth: there is no pack packet, and every packet
 *  consumer already treats null as "no packet" (the authored PACKET-PENDING copy branches on kind). */
export function gmMissionNode(m: OdmGmMission, draft?: OdmGmDraft): OdmTreeNode {
    return {
        id: m.id, title: m.title, system: m.system, threat: m.threat,
        packet: null, start: 'available',
        // GM-only: present on the GM device (which holds the drafts), empty on a player device — and the
        // resolve checklist is a GM surface, so an empty list there is correct, not a degradation.
        resolveFlags: draft?.resolveFlags ?? [],
        opDays: m.opDays,
        kind: 'gm-mission',
        // NO gate: a composed mission stands OUTSIDE the authored gate chain by design (it never gates an
        // authored node, and no authored outcome gates it). NO window: the GM publishes when they mean it.
    };
}

/** THE MERGED NODE SET (§S-1). Authored nodes first, in authored order, byte-identical; published missions
 *  appended. A composed id equal to an authored id is DROPPED here as the last belt — publish already
 *  rejects collisions (a shadowed authored node would break its gates silently). */
export function mergeGmMissions(tree: OdmTreeData | null, missions: OdmGmMission[] | null | undefined, drafts?: OdmGmDraft[] | null): OdmTreeData | null {
    if (!tree) return null;
    const list = missions ?? [];
    if (!list.length) return tree; // by reference — a pack campaign with no composed missions costs nothing
    const authored = new Set(tree.nodes.map((n) => n.id));
    const byId = new Map((drafts ?? []).map((d) => [d.id, d]));
    return { ...tree, nodes: [...tree.nodes, ...list.filter((m) => !authored.has(m.id)).map((m) => gmMissionNode(m, byId.get(m.id)))] };
}

/** Is this node a composed one? The single predicate every branching surface asks (never an id-prefix test). */
export function isGmMissionNode(n: OdmTreeNode | null | undefined): boolean { return n?.kind === 'gm-mission'; }

/** THE DERIVE (§S-4) — a field WHITELIST. gmNotes and `published` are structurally unable to ride along:
 *  adding a GM-only draft field later cannot leak it, because this function never spreads the draft. */
export function publishRecord(d: OdmGmDraft, at: OdmDate): OdmGmMission {
    return {
        id: d.id,
        title: d.title.trim(),
        system: d.system.trim(),
        threat: d.threat.trim() || 'MODERATE',
        brief: d.brief.trim(),
        objectives: {
            primary: (d.objectives?.primary ?? '').trim(),
            secondary: (d.objectives?.secondary ?? '').trim(),
            bonus: (d.objectives?.bonus ?? '').trim(),
        },
        opDays: Math.max(1, Math.round(d.opDays || 12)),
        // PANEL FIX — DEEP-COPY the force. The draft's ProtoInstance OBJECTS would otherwise be shared with
        // the published record AND (via mintOdmSpec's composed branch) with missionSpec.opforForce, where
        // battle-reconcile writes `inst.damage` IN PLACE — the GM's pristine roster would be overwritten
        // with battle state, persisted into the top-level key, and fanned. The rolled path is immune
        // because it builds fresh objects every begin; the composed path must copy to match.
        opforForce: (d.opforForce ?? []).map((u) => JSON.parse(JSON.stringify(u))),
        opforBv: d.opforBv ?? 0,
        publishedAt: at,
    };
}

/** Publish readiness — the ordered minimum. A title AND a primary objective: the title names the operation
 *  on every board and the player brief, and the primary is what the resolve dialog and the AAR record. */
export function publishBlockers(d: OdmGmDraft, authoredIds: Set<string>, publishedIds: Set<string>, titles?: string[]): string[] {
    const out: string[] = [];
    if (!d.title.trim()) out.push('a title');
    if (!(d.objectives?.primary ?? '').trim()) out.push('a primary objective');
    // a duplicate title is indistinguishable on the board AND in the players' Orders header (panel note)
    if (d.title.trim() && (titles ?? []).some((t) => t.trim().toLowerCase() === d.title.trim().toLowerCase())) out.push('a title not already in use');
    if (authoredIds.has(d.id)) out.push('a non-colliding id (this id shadows an authored operation)');
    if (publishedIds.has(d.id)) out.push('a non-colliding id (already published)');
    return out;
}

/** A fresh draft. The id is namespaced at mint (§S-8) — composed ids share the odmOutcomes / odmSeeds /
 *  missionTree keyspace with authored ones, and the engagement room keys off the branch id. */
export function newGmDraft(rand: () => string, opDays: number): OdmGmDraft {
    return {
        id: `gm-${rand()}`,
        title: '', system: '', threat: 'MODERATE', brief: '',
        objectives: { primary: '', secondary: '', bonus: '' },
        opDays, opforForce: [], opforBv: 0,
        publishedAt: { y: 0, m: 0, d: 0 },
        resolveFlags: [], gmNotes: '', published: false, nextIdx: 0,
    };
}
