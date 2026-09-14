/*
 * DIRECTIVE-ODM-13 — the MATERIEL math, pure + shared by the fork's walk (Phase 1) and bays (Phase 2:
 * donor-strip reuses THIS block — one tunable set, never forked constants, per the Phase-2 ruling).
 * Strip yields are CATALOG TRUTH: ammo tonnage = the wreck's real carried load (Unit.comp, t==='X',
 * q = tons) × a by-severity fraction; components = weapons + equipment minus DESTROYED crit names,
 * count-capped. Only the fraction and the cap are tunable interims (the WALK_TUNABLES precedent).
 */
import type { UnitSummary as Unit } from '../../models/unit-summary.model';
import type { ProtoInstance } from '../force/force-generator';
import type { OdmStockBin } from '../new-campaign-state';
import type { InventoryLine } from '../inventory/starting-inventory';
import { binNameForAmmo, round1 } from './odm-stocks';

// ── ODM-13 STRIP-YIELD TUNABLES — the ONE interim block (flagged; PM-dialable). ──
export const ODM_STRIP_TUNABLES = {
    /** fraction of the wreck's carried ammo recoverable, by severity (INTERIM — PM-dialable). */
    ammoFraction: { G: 0.75, Y: 0.5, R: 0.25, B: 0.1 } as Record<string, number>,
    /** max component LINES stripped per wreck, by severity (a field clock in item form; INTERIM). */
    componentCap: { G: 6, Y: 4, R: 3, B: 2 } as Record<string, number>,
};

export interface OdmStripYield {
    ammo: { bin: string; tons: number; src?: string }[]; // src — ODM-17 P3 additive: the SOURCE comp label (the quarantine flag keys on it, not the bin)
    parts: { label: string; count: number; id?: string; t?: string }[]; // id/t — ODM-17 P2 additive: the catalog internalName + comp class (pricing truth; older stored yields lack them)
}

/** What a STRIP takes off this machine (field walk AND bay donor-strip — the same physics).
 *  ODM-17 P2: `capOverride` lets the WALK kill the count cap (the field clock in HOURS is the real cap
 *  there — the cap IS what the hours afford); the bays' donor-strip keeps the tunable until its own
 *  hour-pricing directive. */
export function odmStripYield(inst: ProtoInstance, unit: Unit | undefined, severity: string, capOverride?: number): OdmStripYield {
    const comp = unit?.comp ?? [];
    const frac = ODM_STRIP_TUNABLES.ammoFraction[severity] ?? 0.25;
    const cap = capOverride ?? ODM_STRIP_TUNABLES.componentCap[severity] ?? 3;
    const destroyedNames = new Set((inst.damage?.crits ?? []).filter((c) => !!c.destroyed).map((c) => (c.name || c.originalName || '').toLowerCase().trim()).filter(Boolean));
    const ammoMap = new Map<string, { tons: number; src: string }>();
    for (const c of comp) {
        if (c.t !== 'X') continue;
        const tons = round1((c.q || 0) * frac);
        if (tons <= 0) continue;
        const bin = binNameForAmmo(c.n);
        const cur = ammoMap.get(bin);
        ammoMap.set(bin, { tons: round1((cur?.tons ?? 0) + tons), src: cur?.src ?? c.n });
    }
    const parts: { label: string; count: number; id?: string; t?: string }[] = [];
    let left = cap;
    for (const c of comp) {
        if (left <= 0) break;
        if (!['E', 'M', 'B', 'A', 'C'].includes(c.t)) continue;
        if (destroyedNames.has((c.n || '').toLowerCase().trim())) continue; // a destroyed slot yields nothing
        const take = Math.min(Math.max(1, c.q || 1), left);
        parts.push({ label: c.n, count: take, id: c.id, t: c.t });
        left -= take;
    }
    return { ammo: [...ammoMap.entries()].map(([bin, v]) => ({ bin, tons: v.tons, src: v.src })), parts };
}

/* ── DIRECTIVE-ODM-17 P2 — THE TRANSPORT QUESTION: tonnage + field hours, pure. ────────────────────
 * Tonnage truth = the equipment catalog (equipment2 stats.tonnage), resolved by the caller-supplied
 * lookup (name → tons; the walk builds it from DataService incl. aliases). NOTHING here invents a
 * weight: an unpriceable label prices 0 and is REPORTED by the caller, never guessed.
 * Field hours = the doctrine's own recovery table (dark_meridian_salvage_doctrine, Part III):
 *   weapons 2–8 h each · ammo 1–3 h/ton · heat sinks 1–2 h each · (actuators 3–6 h — INERT here:
 *   actuators never appear in Unit.comp, so BCE's strip vocabulary cannot take them; the row is
 *   carried for the record) · gyro 8–14 and engine 14–30 are MAC-7-ONLY and never field-priced.
 * The deterministic point inside each doctrine RANGE is a CC decision, flagged: weapons scale with
 * their own tonnage (clamp(2 + round(tons), 2, 8) — a 1 t laser ≈ 3 h, a 7 t AC ≈ 8 h), ammo takes
 * the mid 2 h/ton, sinks the mid 1.5 h, other equipment 2 h (the "basic electronics work" the field
 * table allows). PM-dialable in one block, the WALK_TUNABLES precedent. */
export const ODM_FIELD_HOURS = {
    weaponBase: 2, weaponMax: 8,   // + round(tonnage), clamped — the doctrine's 2–8 range
    ammoPerTon: 2,                 // the 1–3 h/ton mid
    heatSink: 1.5,                 // the 1–2 h mid
    equipment: 2,                  // misc E-class electronics the field table allows
} as const;

/** MAC-7-only recovery (the doctrine's own capability column): a field walk cannot take these — they
 *  ride home ON the hulk (through a bay slot) or they are lost. Gyro/engine never appear in comp
 *  (the ODM-13 derivation finding); Jump Jets DO — "No jump jet service" is the field table's line. */
export function mac7Only(label: string): boolean {
    return /jump jet|gyro|engine/i.test(label || '');
}

/** Split a strip yield into what the FIELD can take vs what is MAC-7-only (rides the hulk or is lost). */
export function fieldableYield(y: OdmStripYield): { fieldable: OdmStripYield; mac7Only: string[] } {
    const left = y.parts.filter((p) => !mac7Only(p.label));
    const denied = y.parts.filter((p) => mac7Only(p.label)).map((p) => p.label);
    return { fieldable: { ammo: y.ammo, parts: left }, mac7Only: denied };
}

/** The caller-supplied catalog resolver: a yield part → its tonnage, or null when the catalog cannot
 *  price it (reported by yieldTons, never guessed). id-first (comp.id IS the equipment internalName). */
export type OdmPartTons = (p: { label: string; id?: string }) => number | null;

/** The yield's cargo tonnage: ammo tons + component tons via the caller's catalog lookup. */
export function yieldTons(y: OdmStripYield, tonsOf: OdmPartTons): { ammoTons: number; componentTons: number; unpriced: string[] } {
    const ammoTons = round1(y.ammo.reduce((s, a) => s + a.tons, 0));
    let componentTons = 0;
    const unpriced: string[] = [];
    for (const p of y.parts) {
        const t = tonsOf(p);
        if (t == null) { unpriced.push(p.label); continue; } // reported, never guessed
        componentTons = round1(componentTons + t * p.count);
    }
    return { ammoTons, componentTons, unpriced };
}

/** The yield's FIELD price in tech-hours (the doctrine table, deterministic points as flagged above).
 *  Weapon classes = the catalog's own E/M/B/A codes; C splits sink vs other equipment. */
export function yieldFieldHours(y: OdmStripYield, tonsOf: OdmPartTons): number {
    let h = y.ammo.reduce((s, a) => s + a.tons * ODM_FIELD_HOURS.ammoPerTon, 0);
    for (const p of y.parts) {
        if (/heat sink/i.test(p.label)) { h += ODM_FIELD_HOURS.heatSink * p.count; continue; }
        if (p.t === 'E' || p.t === 'M' || p.t === 'B' || p.t === 'A') {
            const t = tonsOf(p) ?? 1;
            h += Math.min(ODM_FIELD_HOURS.weaponMax, ODM_FIELD_HOURS.weaponBase + Math.round(t)) * p.count;
            continue;
        }
        h += ODM_FIELD_HOURS.equipment * p.count;
    }
    return Math.round(h * 10) / 10;
}

/* ── DIRECTIVE-ODM-17 P3 — GRADES AND THE LIFECYCLE, pure. ─────────────────────────────────────────
 * The doctrine's ledger (Part VI, source vocabulary): RAW STOCK (recovered, unassessed, cannot install)
 * → IN-SHOP (on the bench) → CACHED (assessed A/B/C, in storage) → INSTALLED / CONSUMED (immutable) —
 * plus BARTERED, the directive's ordered hook for ODM-11's black market (state exists; no UI). In BCE's
 * count model: RAW/A/B/C are the line's per-grade counts (armor_parts qty_grade_* schema); IN-SHOP is
 * the bench queue; INSTALLED/CONSUMED/BARTERED are ledger rows (campaignLog kind 'parts' — append-only
 * by construction, which IS the immutability). Grades: A = ready to install · B = minor wear, bench
 * inspection required · C = damaged, repair needed · RAW = unassessed (doctrine Part VI + armor_parts).
 * Bench pricing = the doctrine's OWN 1–4 h/item range ("Component bench test and assessment — MAC-7
 * only — 1-4 hrs per item"); the deterministic points inside the range are CC DECISIONS, flagged,
 * PM-dialable in one block (the WALK_TUNABLES precedent). */
export const ODM_BENCH = {
    assessPerItem: 2.5,   // RAW → graded (the 1–4 mid-high: assessment is the thorough pass)
    inspectPerItem: 1.5,  // B → A (the 1–4 low: the wear is known, the check is targeted)
    repairPerItem: 4,     // C → A parts-repair (the range ceiling; also the hours LEDGERED when a
                          // hold-release consumes a C part directly — the repair happens at install)
    ammoPerTon: 2,        // quarantine clearance (test-one-round-per-lot, priced with the P2 ammo rate)
} as const;

export interface OdmGrades { a: number; b: number; c: number; raw: number }
/** The effective grades of a line — a pre-P3 line reads as ALL-A (the forward-only migration identity:
 *  everything the depot seeded or a pre-P3 save held was installable before grades existed). */
export function effGrades(l: InventoryLine): OdmGrades {
    return l.grades ?? { a: l.onHand, b: 0, c: 0, raw: 0 };
}

/** Doctrine Part V — the Republican compatibility matrix's ASSESS FIRST classes. Keyed on the SOURCE
 *  label (binNameForAmmo may route a Precision AC lot into the standard bin — the flag is on the
 *  LANDING, not a new router, per the directive). */
export function odmAmmoAssessFirst(sourceLabel: string): boolean {
    return /inferno|precision|narc/i.test(sourceLabel || '');
}

/** Merge ammo tonnage into a bins map (Ruling 2 — an unmatched class mints a FLOORLESS bin). Mutates `bins`.
 *  ODM-17 P3-d: an ASSESS-FIRST lot (by SOURCE label) lands QUARANTINED — outside `tons`, invisible to
 *  rearm, until a bench assessment clears it. */
export function addAmmoToBins(bins: Record<string, OdmStockBin>, bin: string, tons: number, sourceLabel?: string): boolean {
    if (tons <= 0) return false;
    const cur = bins[bin] ?? { tons: 0, floorTons: null };
    if (sourceLabel && odmAmmoAssessFirst(sourceLabel)) {
        bins[bin] = { ...cur, quarantinedTons: round1((cur.quarantinedTons ?? 0) + tons) };
    } else {
        bins[bin] = { ...cur, tons: round1(cur.tons + tons) };
    }
    return true;
}

/** Merge a component into inventory lines (by exact label; new lines carry the provenance note). Mutates `lines`.
 *  ODM-17 P3-a: strip yields land as RAW STOCK — recovered, unassessed, uninstallable until benched. */
export function addPartLine(lines: InventoryLine[], label: string, count: number, from: string): void {
    const idx = lines.findIndex((l) => l.category === 'component' && l.label === label);
    if (idx >= 0) {
        const g = effGrades(lines[idx]);
        lines[idx] = { ...lines[idx], onHand: lines[idx].onHand + count, grades: { ...g, raw: g.raw + count } };
    } else {
        lines.push({ catalogId: null, category: 'component', label, onHand: count, unit: 'count', floor: 0, notes: `Field-stripped (${from})`, grades: { a: 0, b: 0, c: 0, raw: count } });
    }
}

/** ODM-13 Phase 2 (R3) — find the inventory component line satisfying a named replace-component.
 *  Tier 1: exact label. Tier 2 ("a compatible donor-stripped line"): case/whitespace-insensitive match.
 *  Returns the line index or -1. */
export function findPartLine(lines: InventoryLine[], component: string): number {
    const exact = lines.findIndex((l) => l.category === 'component' && l.onHand > 0 && l.label === component);
    if (exact >= 0) return exact;
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
    const want = norm(component);
    return lines.findIndex((l) => l.category === 'component' && l.onHand > 0 && norm(l.label) === want);
}

const normLabel = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** ODM-17 P3-b — how many INSTALLABLE units of a component the stores hold: grade A (ready) + grade C
 *  (installs with its parts-repair hours ledgered at the hold-release). B needs its bench inspection
 *  first and RAW cannot be installed until reclassified — neither counts (doctrine Part VI). */
export function installableCount(lines: InventoryLine[], component: string): number {
    const want = normLabel(component);
    return lines.filter((l) => l.category === 'component' && normLabel(l.label) === want)
        .reduce((s, l) => { const g = effGrades(l); return s + g.a + g.c; }, 0);
}

/** ODM-17 P3-b — consume ONE installable part: A first, else C (the caller ledgers the C parts-repair,
 *  ODM_BENCH.repairPerItem). Mutates `lines` (a fully-emptied line is dropped). Returns the grade used. */
export function consumeInstallable(lines: InventoryLine[], component: string): 'a' | 'c' | null {
    const want = normLabel(component);
    const pick = (grade: 'a' | 'c') => lines.findIndex((l) => l.category === 'component' && normLabel(l.label) === want && effGrades(l)[grade] > 0);
    let grade: 'a' | 'c' = 'a';
    let idx = pick('a');
    if (idx < 0) { grade = 'c'; idx = pick('c'); }
    if (idx < 0) return null;
    const g = effGrades(lines[idx]);
    const ng = { ...g, [grade]: g[grade] - 1 };
    const onHand = lines[idx].onHand - 1;
    if (onHand <= 0 && ng.a + ng.b + ng.c + ng.raw <= 0) lines.splice(idx, 1);
    else lines[idx] = { ...lines[idx], onHand: Math.max(0, onHand), grades: ng };
    return grade;
}

/** ODM-17 P3-b — the held card's RECOURSE for a missing part, in doctrine terms: on the bench (with the
 *  live hours) · in RAW stock (bench it) · grade B (inspection needed) · or genuinely absent. */
export function heldRecourse(component: string, lines: InventoryLine[], bench: { label: string; kind: string; hoursRemaining: number }[]): string {
    const want = normLabel(component);
    const onBench = bench.find((j) => j.kind !== 'ammo' && normLabel(j.label) === want);
    if (onBench) return `${component} on the bench, ${Math.ceil(onBench.hoursRemaining)} h`;
    const line = lines.find((l) => l.category === 'component' && normLabel(l.label) === want);
    if (line) {
        const g = effGrades(line);
        if (g.raw > 0) return `${component} in RAW stock — bench-assess it`;
        if (g.b > 0) return `${component} at grade B — bench inspection needed`;
    }
    return `awaiting ${component} (salvage one or strip a donor)`;
}

/** ODM-13 Phase 2 — the ammo RESTORED by a completed repair, computed from the DAMAGE STATE (game truth:
 *  each ammo crit slot is one ton; restored tons = consumed/totalAmmo per slot), routed to bins by class. */
export function rearmNeeds(inst: ProtoInstance): { bin: string; tons: number }[] {
    const needs = new Map<string, number>();
    for (const c of (inst.damage?.crits ?? []) as Array<{ name?: string; originalName?: string; ammo?: string; totalAmmo?: number; consumed?: number }>) {
        const total = c.totalAmmo ?? 0;
        const used = c.consumed ?? 0;
        if (total <= 0 || used <= 0) continue;
        const tons = round1(Math.min(1, used / total)); // one ammo slot = one ton of that class
        if (tons <= 0) continue;
        const bin = binNameForAmmo(c.ammo || c.name || c.originalName || '');
        needs.set(bin, round1((needs.get(bin) ?? 0) + tons));
    }
    return [...needs.entries()].map(([bin, tons]) => ({ bin, tons }));
}
