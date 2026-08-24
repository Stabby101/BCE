/*
 * BCE Inventory I (DIRECTIVE-055, T-037 slice 1) — SOURCE (B): the structural components.
 *
 * These are the parts MekBay stores as UNIT STRING ATTRIBUTES (armorType / structureType / engine /
 * gyro / cockpit / actuators), NOT equipment rows — so the catalog must author them. This is
 * BCE-AUTHORED rules data implementing canon facts (cost, tonnage rule, intro/extinct/reintro years),
 * CITED to TechManual + cross-checked against Sarna. NOT copied from any witness file (REF-001).
 *
 * Pricing (TechManual): engine, internal structure, and armor scale with the 'Mech's tonnage → they
 * carry a `cost_formula` KEY (evaluated by catalog-rules.evalCostFormula), NOT a flat cost. Gyro,
 * cockpit, and actuators are flat per the directive (their full tonnage/rating scaling is a shop-slice
 * refinement — flagged in `notes`). Years are canon (Sarna-verifiable); the lostech gap (extinct →
 * reintroduced) is what gates XL / Endo-Steel / Ferro-Fibrous out of 3025 but back by ~3035–3040.
 */

const TM = (section) => `TechManual — ${section}; rules data, xref Sarna`;
const row = (o) => ({
    source: 'structural', tech_rating: null, intro_year: null, extinction_year: null, reintro_year: null,
    cost_cbills: null, cost_formula: null, tonnage: null, crit_slots: null, availability: null, notes: null, ...o,
});

export const STRUCTURAL_COMPONENTS = [
    // ── ARMOR (cost scales with tons of armor → cost_formula) ──
    row({ id: 'struct:armor_standard', name: 'Standard Armor', category: 'armor', tech_base: 'All', tech_rating: 'C', intro_year: 2470, cost_formula: 'armor_std', provenance: TM('Armor'), notes: '10,000 C-bills/ton of armor.' }),
    row({ id: 'struct:armor_ferro_fibrous', name: 'Ferro-Fibrous Armor', category: 'armor', tech_base: 'IS', tech_rating: 'E', intro_year: 2571, extinction_year: 2865, reintro_year: 3040, cost_formula: 'armor_ferro_fibrous', provenance: TM('Ferro-Fibrous Armor'), notes: 'Lostech: extinct 2865, reintroduced 3040. 20,000 C-bills/ton.' }),
    row({ id: 'struct:armor_ferro_fibrous_clan', name: 'Ferro-Fibrous Armor (Clan)', category: 'armor', tech_base: 'Clan', tech_rating: 'F', intro_year: 2820, cost_formula: 'armor_ferro_fibrous', provenance: TM('Ferro-Fibrous Armor (Clan)'), notes: 'Clan FF; 20,000 C-bills/ton.' }),
    row({ id: 'struct:armor_light_ff', name: 'Light Ferro-Fibrous Armor', category: 'armor', tech_base: 'IS', tech_rating: 'E', intro_year: 3067, cost_formula: 'armor_light_ff', provenance: TM('Light Ferro-Fibrous Armor') }),
    row({ id: 'struct:armor_heavy_ff', name: 'Heavy Ferro-Fibrous Armor', category: 'armor', tech_base: 'IS', tech_rating: 'E', intro_year: 3069, cost_formula: 'armor_heavy_ff', provenance: TM('Heavy Ferro-Fibrous Armor') }),
    row({ id: 'struct:armor_stealth', name: 'Stealth Armor', category: 'armor', tech_base: 'IS', tech_rating: 'E', intro_year: 3063, cost_formula: 'armor_stealth', provenance: TM('Stealth Armor'), notes: 'Requires Guardian ECM; 50,000 C-bills/ton.' }),
    row({ id: 'struct:armor_reactive', name: 'Reactive Armor', category: 'armor', tech_base: 'IS', tech_rating: 'E', intro_year: 3063, cost_formula: 'armor_reactive', provenance: TM('Reactive Armor') }),
    row({ id: 'struct:armor_reflective', name: 'Reflective Armor', category: 'armor', tech_base: 'IS', tech_rating: 'E', intro_year: 3058, cost_formula: 'armor_reflective', provenance: TM('Reflective Armor') }),
    row({ id: 'struct:armor_hardened', name: 'Hardened Armor', category: 'armor', tech_base: 'IS', tech_rating: 'D', intro_year: 3047, cost_formula: 'armor_hardened', provenance: TM('Hardened Armor') }),

    // ── INTERNAL STRUCTURE (cost = perTon × 'Mech tonnage → cost_formula) ──
    row({ id: 'struct:structure_standard', name: 'Standard Structure', category: 'structure', tech_base: 'All', tech_rating: 'C', intro_year: 2439, cost_formula: 'struct_std', provenance: TM('Internal Structure'), notes: '400 C-bills x BattleMech tonnage.' }),
    row({ id: 'struct:structure_endo_steel', name: 'Endo Steel', category: 'structure', tech_base: 'IS', tech_rating: 'E', intro_year: 2487, extinction_year: 2865, reintro_year: 3035, cost_formula: 'struct_endo_steel', provenance: TM('Endo Steel'), notes: 'Lostech: extinct 2865, reintroduced 3035. 1,600 C-bills × tonnage; 14 crit slots (IS).' }),
    row({ id: 'struct:structure_endo_steel_clan', name: 'Endo Steel (Clan)', category: 'structure', tech_base: 'Clan', tech_rating: 'F', intro_year: 2827, cost_formula: 'struct_endo_steel', provenance: TM('Endo Steel (Clan)'), notes: 'Clan Endo; 7 crit slots.' }),
    row({ id: 'struct:structure_composite', name: 'Composite Structure', category: 'structure', tech_base: 'IS', tech_rating: 'E', intro_year: 3061, cost_formula: 'struct_composite', provenance: TM('Composite Internal Structure') }),
    row({ id: 'struct:structure_reinforced', name: 'Reinforced Structure', category: 'structure', tech_base: 'IS', tech_rating: 'E', intro_year: 3057, cost_formula: 'struct_reinforced', provenance: TM('Reinforced Internal Structure') }),
    row({ id: 'struct:structure_endo_composite', name: 'Endo-Composite Structure', category: 'structure', tech_base: 'IS', tech_rating: 'E', intro_year: 3067, cost_formula: 'struct_endo_composite', provenance: TM('Endo-Composite Internal Structure') }),

    // ── ENGINES (cost = multiplier × rating × tonnage / 75 → cost_formula) ──
    row({ id: 'struct:engine_standard', name: 'Standard Fusion Engine', category: 'engine', tech_base: 'All', tech_rating: 'C', intro_year: 2439, cost_formula: 'engine_std', crit_slots: 6, provenance: TM('Fusion Engine'), notes: '5,000 × rating × tonnage / 75.' }),
    row({ id: 'struct:engine_xl', name: 'XL Engine', category: 'engine', tech_base: 'IS', tech_rating: 'E', intro_year: 2579, extinction_year: 2865, reintro_year: 3035, cost_formula: 'engine_xl', crit_slots: 12, provenance: TM('XL Engine'), notes: 'Lostech: extinct 2865, reintroduced 3035. 20,000 × rating × tonnage / 75; IS = 12 crit slots.' }),
    row({ id: 'struct:engine_xl_clan', name: 'XL Engine (Clan)', category: 'engine', tech_base: 'Clan', tech_rating: 'F', intro_year: 2827, cost_formula: 'engine_xl', crit_slots: 10, provenance: TM('XL Engine (Clan)'), notes: 'Clan XL = 10 crit slots.' }),
    row({ id: 'struct:engine_light', name: 'Light Engine', category: 'engine', tech_base: 'IS', tech_rating: 'E', intro_year: 3055, cost_formula: 'engine_light', crit_slots: 10, provenance: TM('Light Engine') }),
    row({ id: 'struct:engine_compact', name: 'Compact Engine', category: 'engine', tech_base: 'IS', tech_rating: 'E', intro_year: 3068, cost_formula: 'engine_compact', crit_slots: 3, provenance: TM('Compact Engine') }),
    row({ id: 'struct:engine_xxl', name: 'XXL Engine', category: 'engine', tech_base: 'IS', tech_rating: 'F', intro_year: 3055, cost_formula: 'engine_xxl', crit_slots: 18, provenance: TM('XXL Engine') }),
    row({ id: 'struct:engine_ice', name: 'I.C.E.', category: 'engine', tech_base: 'All', tech_rating: 'C', intro_year: 2300, cost_formula: 'engine_ice', crit_slots: 6, provenance: TM('Internal Combustion Engine'), notes: '1,250 × rating × tonnage / 75; no fusion (no heat sinks).' }),

    // ── GYROS (flat per directive; full pricing = 300,000 × ceil(rating/100) is a shop-slice refinement) ──
    row({ id: 'struct:gyro_standard', name: 'Standard Gyro', category: 'gyro', tech_base: 'All', tech_rating: 'C', intro_year: 2439, cost_cbills: 300000, crit_slots: 4, provenance: TM('Gyro'), notes: 'Stored as the per-gyro-ton rate (300,000); full cost = 300,000 × ceil(rating/100) — shop-slice.' }),
    row({ id: 'struct:gyro_xl', name: 'Extra-Light Gyro', category: 'gyro', tech_base: 'IS', tech_rating: 'E', intro_year: 3067, cost_cbills: 750000, crit_slots: 6, provenance: TM('Extra-Light Gyro') }),
    row({ id: 'struct:gyro_compact', name: 'Compact Gyro', category: 'gyro', tech_base: 'IS', tech_rating: 'E', intro_year: 3068, cost_cbills: 400000, crit_slots: 2, provenance: TM('Compact Gyro') }),
    row({ id: 'struct:gyro_heavy_duty', name: 'Heavy-Duty Gyro', category: 'gyro', tech_base: 'IS', tech_rating: 'E', intro_year: 3067, cost_cbills: 500000, crit_slots: 4, provenance: TM('Heavy-Duty Gyro') }),

    // ── COCKPITS (flat) ──
    row({ id: 'struct:cockpit_standard', name: 'Standard Cockpit', category: 'cockpit', tech_base: 'All', tech_rating: 'C', intro_year: 2439, cost_cbills: 200000, crit_slots: 1, provenance: TM('Cockpit'), notes: 'Includes life support + sensors in the head.' }),
    row({ id: 'struct:cockpit_small', name: 'Small Cockpit', category: 'cockpit', tech_base: 'IS', tech_rating: 'E', intro_year: 3067, cost_cbills: 175000, crit_slots: 1, provenance: TM('Small Cockpit') }),
    row({ id: 'struct:cockpit_command_console', name: 'Command Console', category: 'cockpit', tech_base: 'All', tech_rating: 'E', intro_year: 2631, extinction_year: 2864, reintro_year: 3052, cost_cbills: 500000, provenance: TM('Command Console'), notes: 'Lostech: extinct 2864, reintroduced 3052.' }),
    row({ id: 'struct:cockpit_torso_mounted', name: 'Torso-Mounted Cockpit', category: 'cockpit', tech_base: 'IS', tech_rating: 'E', intro_year: 3053, cost_cbills: 750000, provenance: TM('Torso-Mounted Cockpit') }),
    row({ id: 'struct:cockpit_industrial', name: 'Industrial Cockpit', category: 'cockpit', tech_base: 'All', tech_rating: 'C', intro_year: 2469, cost_cbills: 100000, crit_slots: 1, provenance: TM('Industrial Cockpit') }),
    row({ id: 'struct:cockpit_primitive', name: 'Primitive Cockpit', category: 'cockpit', tech_base: 'All', tech_rating: 'C', intro_year: 2439, extinction_year: 2520, cost_cbills: 100000, crit_slots: 1, provenance: TM('Primitive Cockpit'), notes: 'Superseded by the standard cockpit ~2520.' }),

    // ── ACTUATORS (the fixed set; flat per directive — full pricing is tonnage-scaled, a shop-slice refinement) ──
    row({ id: 'struct:actuator_shoulder', name: 'Shoulder Actuator', category: 'actuator', tech_base: 'All', tech_rating: 'C', intro_year: 2439, cost_cbills: 0, crit_slots: 1, provenance: TM('Actuators'), notes: 'Part of the arm assembly; tonnage-scaled pricing is a shop-slice refinement.' }),
    row({ id: 'struct:actuator_upper_arm', name: 'Upper Arm Actuator', category: 'actuator', tech_base: 'All', tech_rating: 'C', intro_year: 2439, cost_cbills: 0, crit_slots: 1, provenance: TM('Actuators') }),
    row({ id: 'struct:actuator_lower_arm', name: 'Lower Arm Actuator', category: 'actuator', tech_base: 'All', tech_rating: 'C', intro_year: 2439, cost_cbills: 0, crit_slots: 1, provenance: TM('Actuators') }),
    row({ id: 'struct:actuator_hand', name: 'Hand Actuator', category: 'actuator', tech_base: 'All', tech_rating: 'C', intro_year: 2439, cost_cbills: 0, crit_slots: 1, provenance: TM('Actuators') }),
    row({ id: 'struct:actuator_hip', name: 'Hip Actuator', category: 'actuator', tech_base: 'All', tech_rating: 'C', intro_year: 2439, cost_cbills: 0, crit_slots: 1, provenance: TM('Actuators') }),
    row({ id: 'struct:actuator_upper_leg', name: 'Upper Leg Actuator', category: 'actuator', tech_base: 'All', tech_rating: 'C', intro_year: 2439, cost_cbills: 0, crit_slots: 1, provenance: TM('Actuators') }),
    row({ id: 'struct:actuator_lower_leg', name: 'Lower Leg Actuator', category: 'actuator', tech_base: 'All', tech_rating: 'C', intro_year: 2439, cost_cbills: 0, crit_slots: 1, provenance: TM('Actuators') }),
    row({ id: 'struct:actuator_foot', name: 'Foot Actuator', category: 'actuator', tech_base: 'All', tech_rating: 'C', intro_year: 2439, cost_cbills: 0, crit_slots: 1, provenance: TM('Actuators') }),
];
