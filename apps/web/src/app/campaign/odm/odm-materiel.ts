import type { UnitSummary as Unit } from '../../models/unit-summary.model';
import type { ProtoInstance } from '../force/force-generator';
import type { OdmStockBin } from '../new-campaign-state';
import type { InventoryLine } from '../inventory/starting-inventory';
import { binNameForAmmo, round1 } from './odm-stocks';

export const ODM_STRIP_TUNABLES = {
    /** fraction of the wreck's carried ammo recoverable, by severity (INTERIM — PM-dialable). */
    ammoFraction: { G: 0.75, Y: 0.5, R: 0.25, B: 0.1 } as Record<string, number>,
    /** max component LINES stripped per wreck, by severity (a field clock in item form; INTERIM). */
    componentCap: { G: 6, Y: 4, R: 3, B: 2 } as Record<string, number>,
};

export interface OdmStripYield {
    ammo: { bin: string; tons: number; src?: string }[];
    parts: { label: string; count: number; id?: string; t?: string }[];
}

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

export const ODM_FIELD_HOURS = {
    weaponBase: 2, weaponMax: 8,   // + round(tonnage), clamped — the doctrine's 2–8 range
    ammoPerTon: 2,                 // the 1–3 h/ton mid
    heatSink: 1.5,                 // the 1–2 h mid
    equipment: 2,                  // misc E-class electronics the field table allows
} as const;

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

export function addPartLine(lines: InventoryLine[], label: string, count: number, from: string): void {
    const idx = lines.findIndex((l) => l.category === 'component' && l.label === label);
    if (idx >= 0) {
        const g = effGrades(lines[idx]);
        lines[idx] = { ...lines[idx], onHand: lines[idx].onHand + count, grades: { ...g, raw: g.raw + count } };
    } else {
        lines.push({ catalogId: null, category: 'component', label, onHand: count, unit: 'count', floor: 0, notes: `Field-stripped (${from})`, grades: { a: 0, b: 0, c: 0, raw: count } });
    }
}

export function findPartLine(lines: InventoryLine[], component: string): number {
    const exact = lines.findIndex((l) => l.category === 'component' && l.onHand > 0 && l.label === component);
    if (exact >= 0) return exact;
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
    const want = norm(component);
    return lines.findIndex((l) => l.category === 'component' && l.onHand > 0 && norm(l.label) === want);
}

const normLabel = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

export function installableCount(lines: InventoryLine[], component: string): number {
    const want = normLabel(component);
    return lines.filter((l) => l.category === 'component' && normLabel(l.label) === want)
        .reduce((s, l) => { const g = effGrades(l); return s + g.a + g.c; }, 0);
}

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
