/*
 * BCE campaign-pack — FORCE STRUCTURE (DIRECTIVE-019). Pure TS, no Angular/DOM.
 *
 * Organizes a flat generated force (D-018 proto-instances) into canon sub-units — IS lances
 * of 4 / Clan Stars of 5, nesting up through company/Trinary, battalion/Cluster, regiment/Galaxy
 * — with a deterministically-designated command unit anchoring the Command Lance and an overflow
 * RESERVE. Membership is a LINK (`lanceId` on the instance), not a property, so reassignment is a
 * later-slice no-op against this shape. ALL templates + naming live in STRUCTURE_TUNABLES behind a
 * seam (House/Clan naming conventions arrive with the OOB pass, D-021/T-024). Lifts to apps/api.
 */
import type { ProtoInstance } from './force-generator';

export interface Lance {
    id: string;
    name: string; // e.g. "Command Lance", "Alpha Star"
    ordinal: number; // 0-based fill order (0 = command)
    groups: string[]; // ancestor group labels for nested headers, e.g. ["1st Battalion","Command Company"]
}
export interface ForceStructure {
    lances: Lance[];
    basis: number; // 4 IS / 5 Clan — the nominal lance/Star size
}

interface ParentTier {
    kind: 'company' | 'battalion';
    count: number;
}
interface SizeTemplate {
    parents: ParentTier[]; // tiers ABOVE the lance leaf (top-first)
    leafLances: number; // lances per lowest group
}

// ── TUNABLE: structure templates + naming (the seam the OOB pass replaces) ──
export const STRUCTURE_TUNABLES = {
    basis: { is: 4, clan: 5 } as const,
    /** nesting per unit-size (same counts for IS + Clan; tier WORDS differ). */
    templates: {
        single: { parents: [], leafLances: 1 },
        lance: { parents: [], leafLances: 1 },
        company: { parents: [], leafLances: 3 }, // 3 lances / 3 Stars
        battalion: { parents: [{ kind: 'company', count: 3 }], leafLances: 3 }, // 3 companies × 3
        regiment: { parents: [{ kind: 'battalion', count: 3 }, { kind: 'company', count: 3 }], leafLances: 3 }, // 3×3×3
    } as Record<string, SizeTemplate>,
    /** phonetic names for lances/Stars + companies/Trinaries (index 0 = Command). */
    names: ['Command', 'Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliet', 'Kilo', 'Lima', 'Mike', 'November', 'Oscar', 'Papa', 'Quebec', 'Romeo', 'Sierra', 'Tango', 'Uniform', 'Victor', 'Whiskey', 'Xray', 'Yankee', 'Zulu'],
    /** ordinal names for battalions/Clusters. */
    ordinals: ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th'],
    /** tier WORDS by archetype. */
    words: {
        is: { lance: 'Lance', company: 'Company', battalion: 'Battalion' },
        clan: { lance: 'Star', company: 'Trinary', battalion: 'Cluster' },
    },
    // ── D-027 lance-management knobs ──
    /** false = moving past the basis only badges OVERSTRENGTH (amber); true = hard-cap at basis (PROD-001 GM freedom). */
    enforceBasis: false,
    /** false = an emptied non-Command lance auto-removes; true = keep empty lances around. */
    keepEmptyLances: false,
} as const;

const T = STRUCTURE_TUNABLES;

function tierWord(kind: 'lance' | 'company' | 'battalion', clan: boolean): string {
    return clan ? T.words.clan[kind] : T.words.is[kind];
}

/** Build the template lance list (with nested group labels) for a size + archetype. */
function buildLances(sizeId: string, clan: boolean): Lance[] {
    const tmpl = T.templates[sizeId] ?? T.templates['company'];
    const leafWord = tierWord('lance', clan);
    const lances: Lance[] = [];
    let ord = 0;

    const recurse = (depth: number, groups: string[]): void => {
        if (depth === tmpl.parents.length) {
            for (let i = 0; i < tmpl.leafLances; i++) {
                lances.push({ id: `lance-${ord}`, name: `${T.names[i] ?? 'Lance ' + (i + 1)} ${leafWord}`, ordinal: ord, groups: [...groups] });
                ord++;
            }
            return;
        }
        const tier = tmpl.parents[depth];
        const word = tierWord(tier.kind, clan);
        const ordinal = tier.kind === 'battalion';
        for (let i = 0; i < tier.count; i++) {
            const base = ordinal ? T.ordinals[i] ?? `${i + 1}` : T.names[i] ?? `${i + 1}`;
            recurse(depth + 1, [...groups, `${base} ${word}`]);
        }
    };
    recurse(0, []);
    return lances;
}

export interface StructuredForce {
    instances: ProtoInstance[]; // each gains lanceId (or undefined = RESERVE) + isCommander
    structure: ForceStructure; // only the lances that actually hold units
}

/** Assign lances + the command unit. Greedy fill (basis per lance), commander first, overflow -> RESERVE. */
export function assignStructure(instances: ProtoInstance[], archetype: string | null, sizeId: string): StructuredForce {
    const clan = archetype === 'CLAN';
    const basis = clan ? T.basis.clan : T.basis.is;
    const lances = buildLances(sizeId, clan);

    if (!instances.length) return { instances: [], structure: { lances: [], basis } };

    // Command = heaviest tonnage, BV tiebreak, then instanceId (deterministic; D-018 doesn't flag it).
    const commander = [...instances].sort(
        (a, b) => b.tons - a.tons || (b.bv ?? 0) - (a.bv ?? 0) || a.instanceId.localeCompare(b.instanceId),
    )[0];
    // Order: commander first, the rest in original (generation) order.
    const ordered = [commander, ...instances.filter((i) => i.instanceId !== commander.instanceId)];

    const assigned: ProtoInstance[] = ordered.map((inst, idx) => {
        const lanceIdx = Math.floor(idx / basis);
        const lance = lances[lanceIdx]; // undefined past the template -> RESERVE
        return { ...inst, lanceId: lance?.id, isCommander: inst.instanceId === commander.instanceId };
    });

    const usedCount = Math.min(lances.length, Math.ceil(ordered.length / basis));
    return { instances: assigned, structure: { lances: lances.slice(0, usedCount), basis } };
}

/** Does a force already carry structure links? (false => structure-on-load needed.) */
export function hasStructure(instances: ProtoInstance[] | null, structure: ForceStructure | null | undefined): boolean {
    return !!structure && !!structure.lances.length && !!instances?.some((i) => i.lanceId);
}

// ── D-027: live lance management (membership = the lanceId link, made editable) ──

/** The next lance to append via + NEW LANCE — continues the phonetic sequence, top-level (no parent group).
 *  Ordinal is max+1 (collision-free after a prune); the NAME follows the same index. */
export function buildNextLance(structure: ForceStructure, clan: boolean, rng: () => number = Math.random): Lance {
    const leafWord = clan ? T.words.clan.lance : T.words.is.lance;
    const ord = structure.lances.reduce((m, l) => Math.max(m, l.ordinal), -1) + 1;
    const name = `${T.names[ord] ?? 'Lance ' + (ord + 1)} ${leafWord}`;
    return { id: `lance-x${ord}-${Math.floor(rng() * 1e6)}`, name, ordinal: ord, groups: [] };
}

/** Prune a lance IFF it is now empty, not the Command Lance (ordinal 0), and keepEmptyLances is off.
 *  Targeted at the just-emptied source only, so a freshly-created empty + NEW LANCE survives. */
export function pruneLance(
    structure: ForceStructure,
    force: ProtoInstance[],
    lanceId: string | undefined,
    keepEmpty: boolean = T.keepEmptyLances,
): ForceStructure {
    if (keepEmpty || !lanceId) return structure;
    const lance = structure.lances.find((l) => l.id === lanceId);
    if (!lance || lance.ordinal === 0) return structure; // Command Lance is never auto-removed
    if (force.some((i) => i.lanceId === lanceId)) return structure; // still occupied
    return { ...structure, lances: structure.lances.filter((l) => l.id !== lanceId) };
}

/** D-029: re-pick the commander (the D-019 rule — heaviest tonnage, BV then instanceId tiebreak) when the
 *  prior commander has left the force (sold/deleted). No-op if a commander remains or the force is empty. */
export function redesignateCommander(instances: ProtoInstance[]): ProtoInstance[] {
    if (!instances.length || instances.some((i) => i.isCommander)) return instances;
    const cmd = [...instances].sort(
        (a, b) => b.tons - a.tons || (b.bv ?? 0) - (a.bv ?? 0) || a.instanceId.localeCompare(b.instanceId),
    )[0];
    return instances.map((i) => ({ ...i, isCommander: i.instanceId === cmd.instanceId }));
}
