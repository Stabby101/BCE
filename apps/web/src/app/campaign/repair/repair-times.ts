import type { CBTSerializedState, CriticalSlot } from '../../models/force-serialization';

const H = (min: number) => Math.round((min / 60) * 100) / 100; // minutes -> labor-hours (2dp)

/** A cited time. hours = labor tech-hours; cite = the canonical source line. */
export interface CitedTime { hours: number; cite: string; }
export type RepairAction = 'repair' | 'replace';

// ── §9.2 'MECH REPLACEMENTS (StratOps p.183) — D39 §10.3 overrides applied where the extract carries them ──
const REPLACE: Record<string, CitedTime> = {
    destroyedLocation: { hours: H(240), cite: 'StratOps p.183 §9.2 Destroyed Location (240 min)' },
    limb: { hours: H(180), cite: 'StratOps p.183 §9.2 Reattach/Replace Blown-Off Limb (180 min)' },
    head: { hours: 8, cite: 'ODM D39 §10.3 (StratOps Head 200 min → 8 h half-shift)' },
    cockpit: { hours: 8, cite: 'ODM D39 §10.3 (Cockpit/Head → 8 h half-shift)' },
    actuator: { hours: H(90), cite: 'StratOps p.183 §9.2 Actuator (90 min)' },
    ammo: { hours: H(120), cite: 'StratOps p.183 §9.2 Ammunition Critical (120 min)' },
    case: { hours: H(60), cite: 'StratOps p.183 §9.2 CASE/CASE II (60 min)' },
    engine: { hours: 16, cite: 'ODM D39 §10.3 (StratOps Engine 360 min → 16 h full shift)' },
    gyro: { hours: 8, cite: 'ODM D39 §10.3 (StratOps Gyro 200 min → 8 h half-shift)' },
    heatSink: { hours: H(90), cite: 'StratOps p.183 §9.2 Heat Sink (90 min)' },
    jumpJet: { hours: H(60), cite: 'StratOps p.183 §9.2 Jump Jet (60 min)' },
    lifeSupport: { hours: H(180), cite: 'StratOps p.183 §9.2 Life Support (180 min)' },
    sensors: { hours: H(260), cite: 'StratOps p.183 §9.2 Sensors (260 min)' },
    weapon: { hours: H(120), cite: 'StratOps p.183 §9.2 Weapons and Other Equipment (120 min)' },
};
// ── §9.6 'MECH REPAIRS (NOT replacements) — severity/count-tiered (StratOps p.185) ──
const REPAIR_TIER: Record<string, number[]> = {
    engine: [H(100), H(200), H(300)],   // §9.6 Engine 1/2/3 crits
    gyro: [H(120), H(240)],             // §9.6 Gyro 1/2 crits
    sensors: [H(75), H(150)],           // §9.6 Sensors 1/2 crits
    lifeSupport: [H(60), H(120)],       // §9.6 Life Support 1/2 crits
    weapon: [H(100), H(150), H(200), H(250)], // §9.6 Weapons 1/2/3/4+ crits
    heatSink: [H(120)],                 // §9.6 Heat Sink (120 min, repair)
    actuator: [H(120)],                 // §9.6 Actuators (120 min, repair)
    jumpJet: [H(90)],                   // §9.6 Jump Jet (90 min, repair)
};
const REPAIR_CITE: Record<string, string> = {
    engine: 'StratOps p.185 §9.6 Engine crits (100/200/300 min)',
    gyro: 'StratOps p.185 §9.6 Gyro crits (120/240 min)',
    sensors: 'StratOps p.185 §9.6 Sensors crits (75/150 min)',
    lifeSupport: 'StratOps p.185 §9.6 Life Support crits (60/120 min)',
    weapon: 'StratOps p.185 §9.6 Weapons crits (100/150/200/250 min)',
    heatSink: 'StratOps p.185 §9.6 Heat Sink (120 min)',
    actuator: 'StratOps p.185 §9.6 Actuators (120 min)',
    jumpJet: 'StratOps p.185 §9.6 Jump Jet (90 min)',
};

// total — pre-rounding the per-point rate (5 min → 0.08 h) under-billed ~4% at scale. Cites unchanged.
const ARMOR_PER_POINT = { minutes: 5, cite: 'StratOps p.183 §9.2 Armor (5 min per circle/point)' };
const INTERNAL_PER_POINT = { minutes: 6, cite: 'ODM D39 §10.4 Internal Structure (0.1 h/pt Std; Endo ×2 — flagged)' };

/** Classify a crit by name into a component family. Unnamed/weapon → 'weapon' (the §9.2 catch-all). */
function family(c: CriticalSlot): string {
    const n = (c.name || c.originalName || '').toLowerCase();
    if (/engine/.test(n)) return 'engine';
    if (/gyro/.test(n)) return 'gyro';
    if (/cockpit/.test(n)) return 'cockpit';
    if (/sensor/.test(n)) return 'sensors';
    if (/life support/.test(n)) return 'lifeSupport';
    if (/heat sink/.test(n)) return 'heatSink';
    if (/actuator|hip|shoulder/.test(n)) return 'actuator';
    if (/jump jet/.test(n)) return 'jumpJet';
    if (/case/.test(n)) return 'case';
    if (/ammo|@/.test(n)) return 'ammo';
    return 'weapon';
}
const LABEL: Record<string, string> = {
    engine: 'Engine', gyro: 'Gyro', cockpit: 'Cockpit', sensors: 'Sensors', lifeSupport: 'Life Support',
    heatSink: 'Heat Sink', actuator: 'Actuator', jumpJet: 'Jump Jet', case: 'CASE', ammo: 'Ammo bin', weapon: 'Weapon / equipment',
};

export interface RepairLine { component: string; action: RepairAction; count: number; hours: number; cite: string; }
export interface RepairBill { lines: RepairLine[]; totalHours: number; notes: string[]; }

/** Walk the live damage envelope into an itemized, cited repair bill (labor tech-hours). */
export function estimateRepairJob(damage: CBTSerializedState | undefined | null): RepairBill {
    const lines: RepairLine[] = [];
    const notes: string[] = [];
    const locs = (damage?.locations ?? {}) as Record<string, { armor?: number; internal?: number; pendingArmor?: number; pendingInternal?: number }>;

    let armorPts = 0, internalPts = 0;
    for (const k of Object.keys(locs)) {
        const l = locs[k];
        armorPts += (l.armor ?? 0) + (l.pendingArmor ?? 0);
        internalPts += (l.internal ?? 0) + (l.pendingInternal ?? 0);
    }
    if (armorPts > 0) lines.push({ component: `Armor (${armorPts} pts)`, action: 'repair', count: armorPts, hours: round((armorPts * ARMOR_PER_POINT.minutes) / 60), cite: ARMOR_PER_POINT.cite });
    if (internalPts > 0) { lines.push({ component: `Internal structure (${internalPts} pts)`, action: 'repair', count: internalPts, hours: round((internalPts * INTERNAL_PER_POINT.minutes) / 60), cite: INTERNAL_PER_POINT.cite }); notes.push('Internal at Std 0.1 h/pt; Endo-Steel doubles (§10.4) but the envelope carries no structure type — flagged.'); }

    // crits grouped by component family
    const groups = new Map<string, { count: number; destroyed: number }>();
    for (const c of (damage?.crits ?? [])) {
        const f = family(c);
        const g = groups.get(f) ?? { count: 0, destroyed: 0 };
        g.count++; if (c.destroyed) g.destroyed++;
        groups.set(f, g);
    }
    let sawUnnamed = false;
    for (const [f, g] of groups) {
        const allDestroyed = g.destroyed >= g.count;
        // engine/gyro/cockpit: a destroyed component is a REPLACE (D39 §10.3); else the §9.6 repair tier.
        if ((f === 'engine' || f === 'gyro' || f === 'cockpit') && allDestroyed) {
            lines.push({ component: `${LABEL[f]} (replace)`, action: 'replace', count: g.count, hours: REPLACE[f].hours, cite: REPLACE[f].cite });
        } else if (REPAIR_TIER[f]) {
            const tier = REPAIR_TIER[f];
            const hours = tier[Math.min(g.count, tier.length) - 1];
            lines.push({ component: `${LABEL[f]} (${g.count} crit${g.count > 1 ? 's' : ''})`, action: 'repair', count: g.count, hours, cite: REPAIR_CITE[f] });
        } else if (REPLACE[f]) {
            // per-crit replace components (actuator / heat sink / jump jet / case / ammo / cockpit-not-all-destroyed)
            const e = REPLACE[f] ?? REPLACE['weapon'];
            lines.push({ component: `${LABEL[f] ?? 'Equipment'} (${g.count})`, action: g.destroyed ? 'replace' : 'repair', count: g.count, hours: round(g.count * e.hours), cite: e.cite });
        } else {
            const e = REPLACE['weapon'];
            lines.push({ component: `${LABEL[f] ?? 'Equipment'} (${g.count})`, action: 'replace', count: g.count, hours: round(g.count * e.hours), cite: e.cite });
            sawUnnamed = true;
        }
        if (f === 'weapon') sawUnnamed = true;
    }
    if (sawUnnamed) notes.push('Weapons/unnamed crits billed at the §9.2 "Weapons and Other Equipment" catch-all where the table does not name the exact item.');

    const totalHours = round(lines.reduce((s, l) => s + l.hours, 0));
    return { lines, totalHours, notes };
}

function round(n: number): number { return Math.round(n * 100) / 100; }
