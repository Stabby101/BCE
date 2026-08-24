/*
 * BCE Personnel (DIRECTIVE-058, T-040 slice 1) — the PURE starting-SUPPORT-personnel model.
 *
 * No Angular/DOM/service deps: given a force summary (units) + tier + seed it DETERMINISTICALLY produces the
 * support PersonnelState (named roster + staffing readout + monthly payroll). The owning PersonnelService does
 * the impure work (resolve the force size, store on the snapshot) and calls this — mirrors starting-inventory.ts.
 *
 * WITNESSES (REF-001 — canon/CamOps is the spec; read-and-cross-check, never bundled): MekHQ supplies the
 * MECHANICS (the support role set, the 6:1 support ratio, salary = base[role] × xpMultiplier[band], 2d6 →
 * experience-band generation, getShorthandedMod), ODM (a prior private prototype) supplies the STRUCTURE (layer 1 named
 * roster + layer 2 aggregate staffing/capacity — the NPC registry is slice 3 / D-060). This slice = layers 1+2.
 * HEURISTIC allotment math is BCE-authored (PERSONNEL_TUNABLES, PM-dialable like INVENTORY_TUNABLES). Salaries
 * + bands are cited (CamOps via MekHQ). DATA-002/003: this output is structured campaign state, STORED on the
 * snapshot and never re-rolled (the forward-only PersonnelService.ensureStartingPersonnel guard).
 */

export type SupportRole = 'mek_tech' | 'astech' | 'doctor' | 'medic' | 'admin';
export type ExperienceBand = 'green' | 'regular' | 'veteran' | 'elite';
export type PersonStatus = 'active' | 'injured' | 'kia';
export type PersonnelTier = 'lean' | 'normal' | 'established';

/** Layer 1 — a named member of the support roster. (Bio/voice is a D-060 concern; a role line is enough here.) */
export interface SupportPerson {
    id: string;
    name: string;
    role: SupportRole;
    experienceBand: ExperienceBand;
    skillLevel: number;   // governing-skill level for the band (display-only this slice: target = baseTN − level)
    salary: number;       // C-bills / month
    status: PersonStatus; // active | injured | kia (injury/recovery is later)
}
/** Layer 2 — one have-vs-need staffing line per the 6:1 ratios, with the short-staffed penalty band. */
export interface StaffingLine {
    label: string;
    have: number;
    need: number;
    shortMod: number;     // MekHQ getShorthandedMod: +4 / +3 / +2 / +1 / 0 (DISPLAY only this slice)
    note: string;
}
export interface PersonnelState {
    roster: SupportPerson[];
    staffing: StaffingLine[];
    monthlyPayroll: number;   // Σ active salaries (C-bills/mo) — the recurring burn the T-037 ledger projects
    generatedAt: string;
    tier: string;
}
/** D-059 — a hireable candidate: a would-be SupportPerson + the one-time signing bonus a seasoned hand asks. */
export interface HireCandidate extends SupportPerson {
    signingBonus: number; // 0 for ≤-average hires; the "golden hello" for the rare veteran/elite
}
/** D-059 — the refreshing personnel market: a pool stable within a campaign MONTH (periodKey), rebuilt on cross. */
export interface HiringMarket {
    periodKey: string;        // `${year}-${month}` of currentDate — the pool's stability window
    pool: HireCandidate[];
}

// ── TUNABLES (HEURISTIC, PM-dialable — house style: FORCE_GEN_TUNABLES / INVENTORY_TUNABLES) ──────────────
export const PERSONNEL_TUNABLES = {
    /** mech techs ∝ units (1 per this many fielded units, before depth). A company (~12) → ~2 at normal. */
    techPerUnits: 5,
    /** the MekHQ 6:1 gem — a specialist's full team is 6 assistants (need = techs × 6, medics need = doctors × 6). */
    astechsPerTech: 6,
    medicsPerDoctor: 6,
    /** ~1 doctor per this many total personnel (combat + support). A company → ~1. */
    personnelPerDoctor: 25,
    /** sane cap on medics PER DOCTOR so the established multiplier doesn't balloon the medic bay. */
    medicsPerDoctorCap: 8,
    /** admins ∝ the combat roster (1 per this many units, before depth) — a company → ~1–2. */
    adminPerRoster: 8,
    /** depth by resource tier (reuse the inventory feel): lean = thin/short-staffed, established = comfortable.
     *  HAVE scales with depth while NEED stays the fixed 6:1 ratio → lean visibly reads short-staffed. */
    depthByTier: { lean: 0.6, normal: 1.0, established: 1.6 } as Record<PersonnelTier, number>,
    /** stable-seed jitter band on quantities (±) — genuine RNG variation, reproducible per seed. */
    jitter: 0.12,
    /** CamOps (Campaign Operations) base MONTHLY salary by role, via MekHQ (C-bills/mo). */
    SALARY_BASE: { mek_tech: 800, astech: 400, doctor: 1500, medic: 400, admin: 500 } as Record<SupportRole, number>,
    /** experience multiplier on base salary (CamOps/MekHQ). */
    XP_MULT: { green: 0.6, regular: 1.0, veteran: 1.6, elite: 3.2 } as Record<ExperienceBand, number>,
    /** 2d6 → experience band (MekHQ generation skew: green/regular-heavy, rare elite). Keyed by the 2d6 sum. */
    BAND_BY_2D6: {
        2: 'green', 3: 'green', 4: 'green', 5: 'green', 6: 'green',
        7: 'regular', 8: 'regular', 9: 'regular',
        10: 'veteran', 11: 'veteran',
        12: 'elite',
    } as Record<number, ExperienceBand>,
    /** governing-skill level for a band (display: target = baseTN − level; higher level = better). */
    SKILL_BY_BAND: { green: 3, regular: 5, veteran: 7, elite: 9 } as Record<ExperienceBand, number>,

    // ── D-059 HIRING HALL (the MekHQ personnel market, collapsed to BCE-tunable simplicity) ──
    /** candidate-pool size before tier scaling (a refreshing monthly hall). */
    poolSizeBase: 6,
    poolSizeByTier: { lean: 0.7, normal: 1.0, established: 1.4 } as Record<PersonnelTier, number>,
    /** clear-and-rebuild cadence — the pool is keyed by campaign month (forward-only-per-period). */
    refreshPeriod: 'monthly' as const,
    /** the role MIX of the hall: common roles common (many astechs/medics), specialists rare. */
    poolRoleWeights: { astech: 5, medic: 3, mek_tech: 2, admin: 1.5, doctor: 1 } as Record<SupportRole, number>,
    /** anti-munchkin: a hand whose skill is more than this many levels above the command AVERAGE usually
     *  declines an under-strength outfit (re-rolls down) — so the pool skews to ≤ the command's average. */
    recruitAboveAvgThreshold: 2,
    /** the "golden hello" — a one-time signing bonus = monthly salary × this, for the rare above-average hire. */
    signingBonusByBand: { veteran: 1.0, elite: 2.0 } as Partial<Record<ExperienceBand, number>>,
    /** firing pays this many months of salary as severance (a roster mutation, not a hard delete). */
    severanceMonths: 1,
} as const;

/** One governing skill per support role; astech/medic are level-0 helpers that don't advance (fixed regular). */
const ROLE_ADVANCES: Record<SupportRole, boolean> = { mek_tech: true, doctor: true, admin: true, astech: false, medic: false };
export const ROLE_LABEL: Record<SupportRole, string> = { mek_tech: 'Mech Tech', astech: 'Astech', doctor: 'Doctor', medic: 'Medic', admin: 'Admin' };
export const ROLE_SKILL: Record<SupportRole, string> = { mek_tech: 'Tech/Mech', astech: '—', doctor: 'Surgery', medic: '—', admin: 'Administration' };
export const BAND_LABEL: Record<ExperienceBand, string> = { green: 'Green', regular: 'Regular', veteran: 'Veteran', elite: 'Elite' };

/** MekHQ getShorthandedMod — helpers present on a 6-assistant team → target-number penalty (DISPLAY this slice). */
export function shorthandedMod(helpersPerTeam: number): number {
    if (helpersPerTeam <= 0) return 4;
    if (helpersPerTeam === 1) return 3;
    if (helpersPerTeam <= 3) return 2;
    if (helpersPerTeam <= 5) return 1;
    return 0;
}

// ── deterministic PRNG (mulberry32 over a cyrb-style string hash) — same seed → same roster, as starting-inventory.ts ──
function seedHash(s: string): number {
    let h = 1779033703 ^ s.length;
    for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
    return h >>> 0;
}
function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// A small, BCE-original name generator (faction-flavored names can come later — slice-1 placeholder per spec).
const FIRST = ['Mara', 'Jonah', 'Sela', 'Dane', 'Yuki', 'Tomas', 'Greta', 'Ravi', 'Lena', 'Cole', 'Ines', 'Boris', 'Pia', 'Hale', 'Noor', 'Sven', 'Tilda', 'Owen', 'Rosa', 'Kato', 'Mira', 'Dex', 'Ana', 'Vidal', 'Suki', 'Reza', 'Gwen', 'Otis', 'Lia', 'Marek'];
const LAST = ['Voss', 'Calderon', 'Okoye', 'Petrov', 'Singh', 'Hale', 'Mbeki', 'Reyes', 'Novak', 'Ferraro', 'Kane', 'Doyle', 'Sato', 'Larsen', 'Cruz', 'Webb', 'Ito', 'Frost', 'Banks', 'Yi', 'Hassan', 'Dvorak', 'Rourke', 'Quinn', 'Park', 'Alvi', 'Sterling', 'Boone', 'Ngata', 'Vance'];
const pick = <T>(arr: readonly T[], r: () => number): T => arr[Math.floor(r() * arr.length) % arr.length];

const tierOf = (t: string): PersonnelTier => (t === 'lean' || t === 'established' ? t : 'normal');

/**
 * Deterministic starting SUPPORT roster: headcounts scaled to force size × tier via the MekHQ 6:1 ratios, then
 * a named roster minted with 2d6→band skill + salary, the have-vs-need staffing readout, and the monthly payroll.
 * Realized state is meant to be STORED (reload reads it, never re-rolls). The RNG call ORDER is fixed → determinism.
 */
export function generateStartingPersonnel(input: { unitCount: number; tier: PersonnelTier; seed: string; generatedAt: string }): PersonnelState {
    const T = PERSONNEL_TUNABLES;
    const tier = tierOf(input.tier);
    const depth = T.depthByTier[tier];
    const rng = mulberry32(seedHash(input.seed));
    const jit = () => 1 + (rng() * 2 - 1) * T.jitter;
    const d6 = () => 1 + Math.floor(rng() * 6);
    const units = Math.max(1, input.unitCount);

    // ── headcounts (6:1 ratios × depth). HAVE scales with depth; NEED below uses the fixed 6:1 ratio. ──
    const techs = Math.max(1, Math.round((units / T.techPerUnits) * depth * jit()));
    const astechs = Math.round(techs * T.astechsPerTech * depth * jit()); // lean → short of the techs×6 need
    const admins = Math.max(1, Math.round((units / T.adminPerRoster) * depth * jit()));
    const totalPersonnel = units + techs + astechs + admins;
    const doctors = Math.round((totalPersonnel / T.personnelPerDoctor) * depth * jit());
    const medics = doctors > 0 ? Math.min(Math.round(doctors * T.medicsPerDoctor * depth * jit()), doctors * T.medicsPerDoctorCap) : 0;

    // ── mint the named roster (fixed order → deterministic RNG stream) ──
    const roster: SupportPerson[] = [];
    const mint = (role: SupportRole, n: number): void => {
        for (let i = 0; i < n; i++) {
            const band: ExperienceBand = ROLE_ADVANCES[role] ? T.BAND_BY_2D6[d6() + d6()] : 'regular';
            const skillLevel = ROLE_ADVANCES[role] ? T.SKILL_BY_BAND[band] : 0;
            const salary = Math.round(T.SALARY_BASE[role] * T.XP_MULT[band]);
            const name = `${pick(FIRST, rng)} ${pick(LAST, rng)}`;
            roster.push({ id: `${role}-${i}-${seedHash(input.seed + role + i).toString(36)}`, name, role, experienceBand: band, skillLevel, salary, status: 'active' });
        }
    };
    mint('mek_tech', techs);
    mint('astech', astechs);
    mint('doctor', doctors);
    mint('medic', medics);
    mint('admin', admins);

    // staffing + payroll are PURE derivations of the roster (so a D-059 hire/fire recomputes them identically).
    return { roster, staffing: computeStaffing(roster), monthlyPayroll: computePayroll(roster), generatedAt: input.generatedAt, tier };
}

/** Σ of ACTIVE salaries (C-bills/mo). Re-run on every roster mutation (hire/fire) → the payroll/ledger update live. */
export function computePayroll(roster: SupportPerson[]): number {
    return roster.filter((p) => p.status === 'active').reduce((s, p) => s + p.salary, 0);
}

/** The 6:1 have-vs-need staffing lines + short-staffed band, derived from the ACTIVE roster's role counts (so a
 *  hire/fire instantly re-reads "now ADEQUATE" / "SHORT-STAFFED +N"). */
export function computeStaffing(roster: SupportPerson[]): StaffingLine[] {
    const T = PERSONNEL_TUNABLES;
    const active = roster.filter((p) => p.status === 'active');
    const n = (role: SupportRole) => active.filter((p) => p.role === role).length;
    const techs = n('mek_tech'), astechs = n('astech'), doctors = n('doctor'), medics = n('medic');
    const lines: StaffingLine[] = [];
    const astechPerTeam = Math.floor(astechs / Math.max(1, techs));
    lines.push({
        label: 'Astech support', have: astechs, need: techs * T.astechsPerTech, shortMod: shorthandedMod(astechPerTeam),
        note: `${astechPerTeam}/team toward the 6:1 ratio · ${techs} mech tech${techs === 1 ? '' : 's'}`,
    });
    if (doctors > 0) {
        const medicPerTeam = Math.floor(medics / Math.max(1, doctors));
        lines.push({
            label: 'Medical support', have: medics, need: doctors * T.medicsPerDoctor, shortMod: shorthandedMod(medicPerTeam),
            note: `${medicPerTeam}/team toward the 6:1 ratio · ${doctors} doctor${doctors === 1 ? '' : 's'} · ${T.personnelPerDoctor} patients/doctor`,
        });
    }
    return lines;
}

/** The command's AVERAGE governing-skill level (advancing roles only) — the anti-munchkin reference. Regular if empty. */
export function commandAvgSkill(roster: SupportPerson[]): number {
    const adv = roster.filter((p) => p.status === 'active' && ROLE_ADVANCES[p.role] && p.skillLevel > 0);
    if (!adv.length) return PERSONNEL_TUNABLES.SKILL_BY_BAND.regular;
    return adv.reduce((s, p) => s + p.skillLevel, 0) / adv.length;
}

/**
 * The D-059 HIRING-HALL candidate pool — DETERMINISTIC per (seed, periodKey). Pool size scales by tier; the role
 * MIX is weighted to common roles; bands skew low via 2d6 AND the anti-munchkin gate (hands far above the command
 * average usually decline → re-roll down); the rare veteran/elite carry a signing bonus. MekHQ market, collapsed.
 */
export function generateCandidatePool(input: { unitCount: number; tier: PersonnelTier; periodKey: string; seed: string; commandAvgLevel: number }): HireCandidate[] {
    const T = PERSONNEL_TUNABLES;
    const tier = tierOf(input.tier);
    const rng = mulberry32(seedHash(`${input.seed}|${input.periodKey}|hiring`));
    const jit = () => 1 + (rng() * 2 - 1) * T.jitter;
    const d6 = () => 1 + Math.floor(rng() * 6);
    const poolSize = Math.max(1, Math.round(T.poolSizeBase * T.poolSizeByTier[tier] * jit()));
    const avg = input.commandAvgLevel;
    const roleEntries = Object.entries(T.poolRoleWeights) as [SupportRole, number][];
    const totalW = roleEntries.reduce((s, [, w]) => s + w, 0);
    const pickRole = (): SupportRole => { let r = rng() * totalW; for (const [role, w] of roleEntries) { if ((r -= w) < 0) return role; } return roleEntries[0][0]; };

    const pool: HireCandidate[] = [];
    for (let i = 0; i < poolSize; i++) {
        const role = pickRole();
        const advances = ROLE_ADVANCES[role];
        let band: ExperienceBand = advances ? T.BAND_BY_2D6[d6() + d6()] : 'regular';
        // anti-munchkin: a hand much above the command average usually declines an under-strength outfit.
        if (advances && T.SKILL_BY_BAND[band] > avg + T.recruitAboveAvgThreshold && rng() < 0.5) band = 'regular';
        const skillLevel = advances ? T.SKILL_BY_BAND[band] : 0;
        const salary = Math.round(T.SALARY_BASE[role] * T.XP_MULT[band]);
        // the seasoned hand asks a "golden hello" — a signing bonus only for the above-average veteran/elite.
        const bonusMult = T.SKILL_BY_BAND[band] > avg ? (T.signingBonusByBand[band] ?? 0) : 0;
        const signingBonus = Math.round(salary * bonusMult);
        const name = `${pick(FIRST, rng)} ${pick(LAST, rng)}`;
        pool.push({ id: `cand-${input.periodKey}-${i}-${seedHash(input.seed + input.periodKey + i).toString(36)}`, name, role, experienceBand: band, skillLevel, salary, status: 'active', signingBonus });
    }
    return pool;
}
