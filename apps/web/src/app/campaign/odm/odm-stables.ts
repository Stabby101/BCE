/*
 * DIRECTIVE-ODM-15b — THE STABLES, pure module. The PM ruling: the duplicated identities in the pack
 * roster are REAL — pilots who upgraded and kept the old hull. One Pilot record per PERSON; the
 * secondary hull mints UNMANNED (a spare machine in the roster pull-down). The engine's 1:1
 * pilot-per-seat mint was the bug, not the names.
 *
 * Identity = authored full name + callsign (the D-024 kin rule deliberately shares SURNAMES, so a
 * surname is never an identity). Primary selection rails, in order:
 *   1. the pack's `pilotPrimary: false` marker (marks SECONDARY seats; absent = primary);
 *   2. condition — prefer the ACTIVE ride over salvage/cold (covers Elara; NOT Aldous, whose hulls
 *      are both active — his marker is load-bearing, verified at ingest);
 *   3. still ambiguous → STOP: never mint (or fold onto) the same person twice by guess.
 *
 * THE FOLD (migration, forward-only) is deliberately LOSSLESS so the ruling's report-if-lossy clause
 * never fires: numerics take MAX (the ruling's rule — SUM was considered and rejected: a same-mission
 * double-deploy of both hulls would double-count), perks take UNION, status takes the worst case
 * (KIA > Injured > Active — dead stays dead), and anything on the folded record that differs
 * (a diverged bio, gmNotes, unequal skills) is APPENDED to gmNotes under a fold marker rather than
 * dropped. Nothing authored or GM-written is ever lost.
 */
import type { Pilot } from '../barracks/pilot-generator';

export interface StableSeatInfo {
    instanceId: string;
    identity: string;          // name + '|' + callsign
    primaryMarked: boolean;    // pack: absent pilotPrimary → true; pilotPrimary === false → false
    active: boolean;           // condition rail input
    label: string;             // for STOP reporting
}

export const identityOf = (name: string | undefined, callsign: string | undefined): string =>
    `${(name ?? '').trim()}|${(callsign ?? '').trim()}`.toLowerCase();

/** Group seats by authored identity; only groups of ≥2 are stables. */
export function stableGroups(seats: StableSeatInfo[]): Map<string, StableSeatInfo[]> {
    const by = new Map<string, StableSeatInfo[]>();
    for (const s of seats) {
        if (!s.identity || s.identity === '|') continue;
        const g = by.get(s.identity) ?? [];
        g.push(s);
        by.set(s.identity, g);
    }
    for (const [k, g] of [...by]) if (g.length < 2) by.delete(k);
    return by;
}

/** The primary-seat rails. Returns the primary seat, or null = AMBIGUOUS (the caller STOPs). */
export function choosePrimary(group: StableSeatInfo[]): StableSeatInfo | null {
    const marked = group.filter((s) => s.primaryMarked);
    if (marked.length === 1) return marked[0];
    if (marked.length > 1) {
        const active = marked.filter((s) => s.active);
        if (active.length === 1) return active[0];
        return null; // multiple primaries, condition can't split them → STOP
    }
    // no markers at all → the condition rail
    const active = group.filter((s) => s.active);
    return active.length === 1 ? active[0] : null;
}

/** The LOSSLESS fold: the person's one record, based on the primary-ride record. */
export function foldPilots(primary: Pilot, secondary: Pilot): Pilot {
    const notes: string[] = [];
    if (secondary.gmNotes?.trim() && secondary.gmNotes !== primary.gmNotes) notes.push(`[folded record — GM notes] ${secondary.gmNotes.trim()}`);
    if (secondary.bio?.trim() && secondary.bio !== primary.bio) notes.push(`[folded record — bio] ${secondary.bio.trim()}`);
    if (secondary.gunnery !== primary.gunnery || secondary.piloting !== primary.piloting) notes.push(`[folded record — skills read ${secondary.gunnery}/${secondary.piloting}]`);
    const status = primary.status === 'KIA' || secondary.status === 'KIA' ? 'KIA'
        : primary.status === 'Injured' || secondary.status === 'Injured' ? 'Injured' : primary.status;
    return {
        ...primary,
        status,
        missionCount: Math.max(primary.missionCount ?? 0, secondary.missionCount ?? 0),
        hits: Math.max(primary.hits ?? 0, secondary.hits ?? 0) || undefined,
        recoveryDays: Math.max(primary.recoveryDays ?? 0, secondary.recoveryDays ?? 0) || undefined,
        kiaDate: primary.kiaDate ?? secondary.kiaDate,
        perks: [...new Set([...(primary.perks ?? []), ...(secondary.perks ?? [])])],
        gmNotes: [primary.gmNotes?.trim(), ...notes].filter(Boolean).join('\n') || undefined,
        recordsBegin: primary.recordsBegin ?? secondary.recordsBegin,
        named: primary.named || secondary.named,
    };
}

/* ── ODM ROSTER SKILL RECONCILIATION (James's live-barracks order, 2026-08-28) — forward-only and
 * TRIPLE-BOUNDED so it can never stomp earned progression: an authored skill edit applies ONLY where the
 * persisted pilot (a) matches the seat's authored identity, (b) has missionCount 0, and (c) still carries
 * the EXACT pre-edit pair. Anything outside the triple match is left alone (and reported once). All eight
 * edited/promoted seats ride the table; the four promotion rows are was==now identity confirmations that
 * can never change state (their counterparts in other campaigns are rolled people, not the seat's identity). */
export const ROSTER_SKILL_RECONCILIATIONS: { name: string; callsign: string | null; was: [number, number]; now: [number, number] }[] = [
    { name: 'Pier Augusto Valentini', callsign: 'Archivist', was: [2, 3], now: [3, 3] },
    { name: 'Rhiannon Ashvale-Price', callsign: 'Anchor', was: [2, 3], now: [3, 3] },
    { name: 'Leonora Vasquez-Iturbe', callsign: 'Mantis', was: [2, 4], now: [3, 4] },
    { name: 'Petra Novotná', callsign: 'Beacon', was: [3, 5], now: [4, 5] },
    { name: 'Sasha Weaver', callsign: null, was: [3, 4], now: [3, 4] },
    { name: 'Vesna Yilmaz', callsign: null, was: [4, 4], now: [4, 4] },
    { name: 'Yusuf Pulaski', callsign: null, was: [4, 4], now: [4, 4] },
    { name: 'Rina Abara', callsign: null, was: [4, 5], now: [4, 5] },
];

/** Apply the bounded reconciliation. Pure: returns the next pilots + what changed + what was left alone. */
export function reconcileRosterSkills(pilots: Pilot[]): { pilots: Pilot[]; applied: string[]; leftAlone: string[] } {
    const applied: string[] = [];
    const leftAlone: string[] = [];
    const next = pilots.map((p) => {
        const row = ROSTER_SKILL_RECONCILIATIONS.find((r) => r.name === p.name && (r.callsign == null ? !p.callsign : r.callsign === p.callsign));
        if (!row) return p;
        if (row.was[0] === row.now[0] && row.was[1] === row.now[1]) return p; // a promotion row — identity confirmation only, never a change
        if (p.gunnery === row.now[0] && p.piloting === row.now[1]) return p; // already current (fresh mint or reconciled) — nothing to do, nothing to say
        if ((p.missionCount ?? 0) === 0 && p.gunnery === row.was[0] && p.piloting === row.was[1]) {
            applied.push(`${p.callsign ?? p.name}: ${row.was[0]}/${row.was[1]} → ${row.now[0]}/${row.now[1]}`);
            return { ...p, gunnery: row.now[0], piloting: row.now[1] };
        }
        leftAlone.push(`${p.callsign ?? p.name} kept ${p.gunnery}/${p.piloting} (${p.missionCount ?? 0} msn — earned state, untouched)`);
        return p;
    });
    return { pilots: next, applied, leftAlone };
}

