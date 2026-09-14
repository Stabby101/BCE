/*
 * DIRECTIVE-ODM-11 — the SURVIVAL economy, pure module: the authored stock seeds + the display derivations.
 * A merc economy models cash flow; a survival economy models attrition — stock − consumption = operations
 * remaining, and you cannot earn your way out. EVERY NUMBER HERE COMES FROM THE AUTHORED PACK LEDGER (§5 of
 * its packet) — nothing is invented, per the directive. NB: comments AND strings here reach the served GM
 * bundle — never name pack content (ops, worlds, people; the odm2 dist leak-net greps for it).
 * v1 is DISPLAY + GM manual adjust only (R2: no auto-consumption; R1: below-floor WARNS, never gates BEGIN).
 */
import type { OdmStocks } from '../new-campaign-state';

/** The authored seed — the pack ledger at campaign start. Bin insertion order is the render order.
 *  The two zero bins are AUTHORED ZERO (one launcher never fires; one munition is refused on principle) —
 *  they render as 0.0 t, never as absent; the WHY lives in the GM packet, not in the bundle. */
export function odmStartingStocks(): OdmStocks {
    return {
        // 200 t on hand = 93% of capacity → capacity ≈ 215 t (200 / 0.93). Floor + rates verbatim from the ledger.
        fuelTons: 200,
        fuelCapacityTons: 215,
        fuelFloorTons: 85.6,
        crackerTonsPerDay: 3.2,
        missionBurnTons: 24.7,
        bins: {
            'LRM': { tons: 5.0, floorTons: 5.0 },
            'SRM': { tons: 7.0, floorTons: 7.0 },
            'MG': { tons: 2.0, floorTons: 2.0 },
            'AC/5': { tons: 2.0, floorTons: 2.0 },
            'AC/10': { tons: 2.0, floorTons: 2.0 },
            'Gauss': { tons: 2.0, floorTons: 2.0 },
            'Arrow IV': { tons: 0, floorTons: null },
            'Inferno': { tons: 0, floorTons: null },
        },
        exposure: 'LOW', // ODM-11 Part B — GM-set; a fresh, undiscovered company starts quiet
        invAmmoMigrated: true, // ODM-13 Ruling 1 — new campaigns are born reconciled (ammo is bins, never inventory)
    };
}

/** ODM-13 Ruling 2 (extensible bins) — resolve a free-text ammo label (a D-056 inventory line label OR a
 *  catalog comp display name) to its BIN name. The authored floored set maps by class; anything else becomes
 *  its own floorless bin ("found materiel") named by the cleaned class text. Ammo is ALWAYS bins. */
export function binNameForAmmo(label: string): string {
    const s = (label || '').replace(/\bammo\b/gi, ' ').replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
    if (/\bLRM\b/i.test(s) && !/streak|extended|enhanced|torpedo/i.test(s)) return 'LRM';
    if (/\bSRM\b/i.test(s) && !/streak|advanced|torpedo/i.test(s)) return 'SRM';
    if (/machine gun|\bMG\b/i.test(s)) return 'MG';
    if (/(\bAC|autocannon)[ /-]?5\b/i.test(s) && !/ultra|lb|rotary|light|proto|improved|primitive|hyper/i.test(s)) return 'AC/5';
    if (/(\bAC|autocannon)[ /-]?10\b/i.test(s) && !/ultra|lb|rotary|light|proto|improved|primitive|hyper/i.test(s)) return 'AC/10';
    if (/gauss/i.test(s) && !/light|heavy|hyper|improved|magshot|silver/i.test(s)) return 'Gauss';
    return s || 'Unsorted ammunition';
}

export const round1 = (n: number): number => Math.round(n * 10) / 10;

/** The GM-set Exposure ladder (v1: a label the GM moves by hand; no automatic model, by ruling). */
export const ODM_EXPOSURE_LEVELS = ['LOW', 'GUARDED', 'ELEVATED', 'HIGH', 'CRITICAL'] as const;

/** % of tank capacity (the packet states 93% at seed). */
export const fuelPct = (s: OdmStocks): number => (s.fuelCapacityTons > 0 ? Math.round((s.fuelTons / s.fuelCapacityTons) * 100) : 0);

/** THE HEADLINE — operations remaining = usable fuel ABOVE THE FLOOR ÷ baseline burn per operation.
 *  (Stated formula, per the directive: one number a commander can hold. Seed: (200 − 85.6) / 24.7 → ~4.) */
export const opsRemaining = (s: OdmStocks): number => (s.missionBurnTons > 0 ? Math.max(0, Math.floor((s.fuelTons - s.fuelFloorTons) / s.missionBurnTons)) : 0);

/** The endurance context — days of cracker output one baseline operation costs (24.7 / 3.2 → ~8 days). */
export const daysCrackingPerOp = (s: OdmStocks): number => (s.crackerTonsPerDay > 0 ? Math.round(s.missionBurnTons / s.crackerTonsPerDay) : 0);

/** Fuel display state: 'red' below the floor · 'amber' within one baseline burn of it · 'ok' above. */
export function fuelState(s: OdmStocks): 'ok' | 'amber' | 'red' {
    if (s.fuelTons < s.fuelFloorTons) return 'red';
    if (s.fuelTons < s.fuelFloorTons + s.missionBurnTons) return 'amber';
    return 'ok';
}

/** A bin BELOW its authored floor is a BREACH (at-floor is not — the seed bins sit exactly at floor). */
export const binBreach = (tons: number, floorTons: number | null): boolean => floorTons != null && tons < floorTons;
