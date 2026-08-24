/*
 * BCE — DIRECTIVE-109: the Chaos Campaign "SP Activity Cost Table" (Draconis Reach §8) as EDITABLE DATA.
 * Support Points (SP) are the Hot Spots fork's single currency. These are the fact-numbers (not book prose);
 * every value is GM-override-ready here rather than hard-coded at the call sites. Amounts are whole SP.
 *
 * IP: mechanics/values are facts; this is our own extraction — no rulebook text. The tool requires the rulebook.
 * Scope note (D-109 ledger-first slice): CBT (BV) costing only. Alpha Strike PV costing (Purchase PV×40, etc.)
 * and Rearm/Heal/Train/SCA wiring are captured in the table for completeness but only Repair/Purchase/Hire are
 * seamed into spend sites this slice (D-110 wires the rest).
 */

import type { OutcomeGate } from '../mission/mission-tree'; // type-only — no runtime dep

/** The single highest applicable repair level (you pay only one — Draconis Reach §8). */
export type RepairLevel = 'armor' | 'structure' | 'crippled' | 'destroyed';

/** What kind of person is being hired (drives the flat hire SP cost). */
export type HireKind = 'crew' | 'namedPilot' | 'battleArmorTrooper';

/** Combat-pay tier (Draconis Reach §7) — the SP earned per track by outcome. */
export type CombatPayTier = 'allObjectives' | 'success' | 'unsuccessful' | 'none';

/** Starting Warchest (Draconis Reach §2/§3 — Mercenary command). Editable. */
export const CHAOS_START = {
    warchestSP: 3000,
    reputation: 1,
    contractScale: 1,
} as const;

/** Monthly economy (Draconis Reach §6). Maintenance = perScale × Contract Scale. Base Pay is D-110. */
export const CHAOS_MONTHLY = {
    maintenancePerScale: 500,
} as const;

/** Combat pay per track, by outcome tier × Track Scale (Draconis Reach §7). Only the highest tier is paid. */
export const CHAOS_COMBAT_PAY: Record<CombatPayTier, number> = {
    allObjectives: 750, // all objectives (1½)
    success: 500, // successful (more objective VP than opponent)
    unsuccessful: 250, // unsuccessful but didn't break the contract (½)
    none: 0, // broke the contract, or no objectives + nothing crippled/destroyed
};

/**
 * D-110b — the ESTIMATED-salvage fraction of the OpFor BV faced, by outcome tier. Multiplied at resolve by the
 * sell economy (BV÷2) and the contract's negotiated Salvage % to estimate SP recovered from the field. An
 * estimate (labeled "(est.)" in the ledger) — accurate/GM-entered salvage is D-110c. GM-tunable here.
 */
export const TIER_SALVAGE_FRACTION: Record<CombatPayTier, number> = {
    allObjectives: 0.5, // clean win — most of the field is yours to strip
    success: 0.35, // held the field
    unsuccessful: 0.15, // recovered a few wrecks
    none: 0, // broke the contract / recovered nothing
};

/** Map the mission-resolve OutcomeGate (6 values) → the combat-pay tier (4 buckets, §7). DIRECTIVE-HARDEN-1:
 *  moved here from WarchestService (with the two pure fns below) so the book arithmetic is unit-testable;
 *  the service delegates — byte-identical. */
export const COMBAT_TIER_BY_GATE: Record<OutcomeGate, CombatPayTier> = {
    FULL_SUCCESS: 'allObjectives', // all objectives (+bonus) → 750×scale
    SUCCESS: 'success', // primary + secondary → 500×scale
    PARTIAL: 'unsuccessful', // primary only (didn't cleanly succeed) → 250×scale
    COMPROMISED: 'unsuccessful', // a compromised outcome → the ½ tier
    FAILURE: 'none', // primary missed → 0
    ANY: 'none', // GM-override sentinel; never a computed resolved tier → 0
};

/** Combat pay earned for a resolved track (§7): the outcome tier's SP × Track Scale. Pure. */
export function combatPayFor(tier: OutcomeGate, scale: number): number {
    return CHAOS_COMBAT_PAY[COMBAT_TIER_BY_GATE[tier] ?? 'none'] * scale;
}

/** D-110b — the ESTIMATED-salvage fraction of the OpFor BV for a resolved track's outcome tier. Pure. */
export function salvageFractionFor(tier: OutcomeGate): number {
    return TIER_SALVAGE_FRACTION[COMBAT_TIER_BY_GATE[tier] ?? 'none'] ?? 0;
}

/** The editable cost table. Repair factors multiply unit TONNAGE; the rest are flat / per-unit-of-work. */
export const CHAOS_SP_COSTS = {
    // Repair — SP = tonnage × factor (single highest level only).
    repair: {
        armor: 0.5, // Armor only: Ton ÷ 2
        structure: 2, // Structure and/or Critical: Ton × 2
        crippled: 3, // Crippled: Ton × 3
        destroyed: 5, // Destroyed (not truly): Ton × 5
        reconfigureOmni: 0.5, // Reconfigure OmniMech: Ton ÷ 2
    } as Record<RepairLevel | 'reconfigureOmni', number>,
    // Repair modifiers (applied in order, each rounding up).
    repairModifiers: {
        clanOrMixed: 1.5, // Clan/Mixed tech ×1.5 (round up)
        vehicleOrBattleArmor: 0.5, // combat vehicles & battle armor halve (round up)
    },
    // Procurement (CBT/BV this slice).
    purchase: { bvMultiplier: 1 }, // Purchase unit = BV  (AS: PV × 40 — D-110)
    sell: { bvDivisor: 2 }, // Sell unit = BV ÷ 2  (AS: PV × 20 — D-110)
    rearm: { perTon: 10 }, // Rearm per ton of ammo = 10  (AS: 20; advanced ×10 — D-110)
    // Hiring (flat, per person).
    hire: {
        crew: 100, // non-named MechWarrior/crew (arrives Regular)
        namedPilot: 150, // Named Pilot (max 4)
        battleArmorTrooper: 20,
    } as Record<HireKind, number>,
    // Healing.
    heal: { mechWarriorPerWound: 30, battleArmorTrooper: 10 }, // MW: 30/wound (≤2/mo); BA trooper: 10
    // Force training.
    train: { formationCommander: 500, changeFormationTraining: 250 },
    // Command training (Special Command Abilities).
    commandAbility: { first: 250, second: 500, third: 750, replace: 250 },
} as const;

/**
 * Repair SP for one unit at its highest damage level (Draconis Reach §8).
 * Order: base = tonnage × level-factor; Clan/Mixed ×1.5 (round up); vehicle/BA halve (round up); whole-SP guard.
 */
export function repairSP(
    level: RepairLevel,
    tonnage: number,
    opts: { clanOrMixed?: boolean; vehicleOrBattleArmor?: boolean } = {},
): number {
    let cost = tonnage * CHAOS_SP_COSTS.repair[level];
    if (opts.clanOrMixed) cost = Math.ceil(cost * CHAOS_SP_COSTS.repairModifiers.clanOrMixed);
    if (opts.vehicleOrBattleArmor) cost = Math.ceil(cost * CHAOS_SP_COSTS.repairModifiers.vehicleOrBattleArmor);
    return Math.ceil(cost); // whole-SP guard (e.g. armor on an odd-tonnage 'Mech)
}

/** Purchase SP for a unit (CBT: = BV). */
export function purchaseSP(bv: number): number {
    return Math.ceil((bv || 0) * CHAOS_SP_COSTS.purchase.bvMultiplier);
}

/** Sell SP for a unit (CBT: = BV ÷ 2). */
export function sellSP(bv: number): number {
    return Math.ceil((bv || 0) / CHAOS_SP_COSTS.sell.bvDivisor);
}

/** Flat hire SP by kind (crew 100 / Named Pilot 150 / battle-armor trooper 20). */
export function hireSP(kind: HireKind): number {
    return CHAOS_SP_COSTS.hire[kind];
}

/** Rearm SP for N tons of ammo (10/ton). */
export function rearmSP(ammoTons: number): number {
    return Math.ceil((ammoTons || 0) * CHAOS_SP_COSTS.rearm.perTon);
}

/** Heal SP for a MechWarrior with N wound boxes (30/wound). */
export function healMechWarriorSP(wounds: number): number {
    return Math.ceil((wounds || 0) * CHAOS_SP_COSTS.heal.mechWarriorPerWound);
}
