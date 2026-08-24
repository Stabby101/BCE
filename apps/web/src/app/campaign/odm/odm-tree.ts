/*
 * DIRECTIVE-ODM-3 — the authored ODM campaign tree (pure module, engine-odm scope).
 *
 * packs/odm/tree.json is the AUTHORED tree; state.missionTree() stays the single RUNTIME tree the shared
 * Classic machinery (generate/resolve/board computeds) operates on. This module is the bridge:
 *   mintOdmBranches  — tree.json → MissionBranch[] (pre-minted at create, so ensureTree's default merc
 *                      opener never fires — the synthetic guerrilla stack is gone by construction);
 *   gateOpen         — evaluates an authored gate against the recorded ODM outcomes (OR over `when`
 *                      entries; each entry ANDs tier∈ + flags⊆ + notFlags∩∅);
 *   reconcileOdmTree — enforces the authored tree over the shared service's side effects: restores
 *                      authored names (runGeneration overwrites the branch name with the rolled forge
 *                      seed's title), strips the rolled fork children + never-dead-end continuation
 *                      branches the shared service mints (LOCKED/AVAILABLE non-authored only — history
 *                      and anything ACTIVE are never touched), and flips authored LOCKED → AVAILABLE
 *                      when the gate opens. Classic files are untouched — the fork calls this after
 *                      every generate/resolve.
 */
import type { MissionBranch, OutcomeGate } from '../mission/mission-tree';

export type OdmTier = 'FULL_SUCCESS' | 'SUCCESS' | 'MISSION_FAILURE' | 'CRITICAL_FAILURE';
export interface OdmOutcome { tier: OdmTier; flags: string[] }

export interface OdmGateWhen { node: string; tier?: OdmTier[]; flags?: string[]; notFlags?: string[] }
export interface OdmDate { y: number; m: number; d: number } // 0-based month — structurally CampaignDate
export interface OdmTreeNode {
    id: string; title: string; system: string; threat: string;
    packet: string | null; start: 'available' | 'locked';
    gate?: { text: string; when: OdmGateWhen[] };
    resolveFlags: { id: string; label: string }[];
    // ── ODM-5 (additive): the time axis. Dates are PACKET TRUTH; windows gate BEGINNING, never finishing. ──
    window?: { opens: OdmDate | null; closes: OdmDate | null; expiredLine?: string };
    opDays?: number;      // the operation's real time cost, booked at resolve (default 12)
    onExpire?: string;    // schema-ready, UNWIRED — an authored consequence node id (PM authors with the packet)
}
export interface OdmTreeData { packId: string; version: number; tiers: string[]; nodes: OdmTreeNode[] }

// ── ODM-5 — date arithmetic over the campaign-date shape ({y, m 0-based, d}) ──
const dnum = (d: OdmDate): number => d.y * 10000 + d.m * 100 + d.d;
export function dateLE(a: OdmDate, b: OdmDate): boolean { return dnum(a) <= dnum(b); }
export function dateLT(a: OdmDate, b: OdmDate): boolean { return dnum(a) < dnum(b); }
/** opens ≤ now < closes (null opens = not yet openable by TIME alone; null closes = never expires). */
export function windowOpen(n: OdmTreeNode, now: OdmDate): boolean {
    const w = n.window;
    if (!w) return true;
    if (w.opens && !dateLE(w.opens, now)) return false;
    return !w.closes || dateLT(now, w.closes);
}
/** now ≥ closes — the un-begun window is gone. */
export function windowClosed(n: OdmTreeNode, now: OdmDate): boolean {
    return !!n.window?.closes && !dateLT(now, n.window.closes);
}
/** ODM-5 — EXPIRED is rendered state, not a new BranchState: an authored node RETIRED with its window closed
 *  and NO recorded outcome expired out (vs RETIRED-by-gate). Not a failure — nothing unlocks off it. */
export function isExpired(node: OdmTreeNode, state: MissionBranch['state'], outcomes: Record<string, OdmOutcome | undefined>, now: OdmDate): boolean {
    return state === 'RETIRED' && !outcomes[node.id] && windowClosed(node, now);
}
/** Closing within one operation-cost of now — the amber "this one dies if you jump elsewhere first". */
export function closingSoon(node: OdmTreeNode, now: OdmDate, state: MissionBranch['state']): boolean {
    if (state !== 'AVAILABLE' || !node.window?.closes) return false;
    const days = (Date.UTC(node.window.closes.y, node.window.closes.m, node.window.closes.d) - Date.UTC(now.y, now.m, now.d)) / 86400000;
    return days > 0 && days <= (node.opDays ?? 12);
}

/** The ODM 4-tier → the shared OutcomeGate vocabulary (for resolveBranch's gating/ledger). Both failure
 *  grades map to FAILURE — PARTIAL sits on the advancing ladder and grades like a marginal win, which the
 *  ODM model has no band for. The TRUE 4-tier literal is recorded in odmOutcomes. */
export function odmTierToGate(t: OdmTier): OutcomeGate {
    return t === 'FULL_SUCCESS' ? 'FULL_SUCCESS' : t === 'SUCCESS' ? 'SUCCESS' : 'FAILURE';
}

/** Does this node's gate open under the recorded outcomes? No gate (an opener) = open. */
export function gateOpen(node: OdmTreeNode, outcomes: Record<string, OdmOutcome | undefined>): boolean {
    if (!node.gate) return true;
    return node.gate.when.some((w) => {
        const rec = outcomes[w.node];
        if (!rec) return false;
        if (w.tier && !w.tier.includes(rec.tier)) return false;
        if (w.flags && !w.flags.every((f) => rec.flags.includes(f))) return false;
        if (w.notFlags && w.notFlags.some((f) => rec.flags.includes(f))) return false;
        return true;
    });
}

/** tree.json → the runtime MissionBranch[] (fresh campaign mint). Deliberately data-light — see the note
 *  inside: authored gate text never enters the branch (the tree persists + fans). */
export function mintOdmBranches(tree: OdmTreeData, now?: OdmDate): MissionBranch[] {
    return tree.nodes.map((n) => ({
        branchId: n.id,
        name: n.title,
        parentBranchId: null, // flat authored tree — OUR evaluator does the unlocking, never selectUnlocks
        outcomeGate: 'ANY' as OutcomeGate,
        threat: n.threat,
        state: n.start === 'available' && (!now || windowOpen(n, now)) ? 'AVAILABLE' as const : 'LOCKED' as const, // ODM-5: window AND start
        // NO gate text on the branch: state.missionTree PERSISTS into the snapshot, and the snapshot fans to
        // session players — authored gate text is lookahead the players must not hold (the odm2 leak net caught
        // exactly this). The board renders gate text LIVE from the runtime-fetched tree.json instead.
    }));
}

/** Enforce the authored tree over the runtime tree (see the header). Pure — returns a new array. */
export function reconcileOdmTree(
    current: MissionBranch[], tree: OdmTreeData, outcomes: Record<string, OdmOutcome | undefined>, now?: OdmDate,
): MissionBranch[] {
    const byId = new Map(tree.nodes.map((n) => [n.id, n]));
    const out: MissionBranch[] = [];
    const seen = new Set<string>();
    for (const b of current) {
        const node = byId.get(b.branchId);
        if (!node) {
            // non-authored: keep HISTORY only. ODM-4 Part A hardened this — a non-authored ACTIVE branch is
            // flow-minted Forge residue (the live "Long Fallow" breach), not a mission worth preserving:
            // authored begins mint no spec and every legitimate ODM mission is an authored node. Rolled fork
            // children (LOCKED), continuations (AVAILABLE), and Forge actives are ALL stripped.
            if (b.state === 'RESOLVED' || b.state === 'RETIRED') out.push(b);
            continue;
        }
        seen.add(b.branchId);
        let next = b;
        if (next.name !== node.title) next = { ...next, name: node.title }; // undo the forge-seed rename
        if (next.forkContext) { const rest = { ...next }; delete rest.forkContext; next = rest; } // snapshot hygiene (see mint)
        // ── ODM-5: availability = WINDOW AND GATE; expiry retires an un-begun node (never an ACTIVE one —
        //    windows gate beginning, not finishing; RESOLVED/RETIRED history is never touched). ──
        if (now && (next.state === 'AVAILABLE' || next.state === 'LOCKED') && !outcomes[node.id] && windowClosed(node, now)) {
            next = { ...next, state: 'RETIRED' }; // EXPIRED (rendered as WINDOW CLOSED; isExpired() distinguishes it)
        } else if (next.state === 'LOCKED' && gateOpen(node, outcomes) && (!now || windowOpen(node, now))) {
            next = { ...next, state: 'AVAILABLE' }; // gate open AND window open (time-keyed arrivals ride the same path)
        } else if (now && next.state === 'AVAILABLE' && node.window?.opens && !dateLE(node.window.opens, now)) {
            next = { ...next, state: 'LOCKED' }; // a not-yet-arrived time-keyed node can never sit AVAILABLE
        }
        out.push(next);
    }
    // authored nodes missing from the runtime tree (older save) — mint them in authored order
    for (const n of tree.nodes) {
        if (seen.has(n.id)) continue;
        const minted = mintOdmBranches({ ...tree, nodes: [n] }, now)[0];
        if (minted.state === 'LOCKED' && gateOpen(n, outcomes) && (!now || windowOpen(n, now))) minted.state = 'AVAILABLE';
        if (now && minted.state !== 'RESOLVED' && !outcomes[n.id] && windowClosed(n, now)) minted.state = 'RETIRED'; // expired before ever minting
        out.push(minted);
    }
    return out;
}

/** Is the runtime tree an authored ODM tree at all? (A pre-ODM-3 save carries only the synthetic
 *  guerrilla opener → replace wholesale rather than reconcile.) */
export function hasAuthoredNodes(current: MissionBranch[], tree: OdmTreeData): boolean {
    const ids = new Set(tree.nodes.map((n) => n.id));
    return current.some((b) => ids.has(b.branchId));
}
