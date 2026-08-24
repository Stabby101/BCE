/*
 * BCE — DIRECTIVE-110: the clean-room Chaos contract. A DISTINCT type from the Traditional C-bill ContractOffer:
 * the Hot Spots fork negotiates these via the 17-step Contract Steps Table, then runs them (Scale, monthly Base
 * Pay, support Cover on repairs, Transport on acceptance, Reputation +1 on completion). One active at a time.
 */
import { type ContractColumn, stepValue, CHAOS_CONTRACT_TYPES } from './chaos-contract-steps';
import type { CampaignStartDate } from '../new-campaign-state';
import type { ContractOffer } from '../contract/contract-market';
import { MISSION_TYPES, type MissionTypeId, type CommandRights, type SalvageTerms, type SupportTerms } from '../contract/contract-terms';

export interface ChaosContract {
    id: string;
    type: string; // ChaosContractType.id
    scale: number; // Contract Scale 1–3 (drives Base Pay / Maintenance / Transport / limits)
    intensity: number; // number of tracks (gating is D-110b)
    steps: Record<ContractColumn, number>; // 0-based step index per negotiated term
    status: 'active' | 'completed';
    acceptedDate: CampaignStartDate | null;
    tracksDone: number; // reserved for D-110b intensity gating
    enemyFaction?: string; // D-110c — the OpFor faction (bordering the current-system owner), picked at accept; undefined → generic OpFor
    hotspotId?: string; // D-124 — set when this contract is a PREMADE authored hotspot (else a negotiated/generic contract)
    offerSnapshot?: string[]; // D-128 — the offer-board hand (hotspot ids) that was on offer at signing; Back-to-contracts restores it. Old saves lack it → treated as empty.
    lengthMonths?: number; // D-131 — the authored hotspot contract length in months (the month WINDOW). Old saves lack it → the display falls back to `intensity`.
    // D-133 — two-sided contracts (Phase 1): the picked side. `enemyFaction` is now the OPPOSING side's faction (set at
    // accept). Old saves lack these → treated as single-sided legacy (side undefined = today's behavior).
    side?: 'a' | 'b';
    sideRole?: 'attacker' | 'defender';
    employer?: string; // who you signed with (the chosen side's employer)
}

/** IMPORT-6 Part A — the Intensity a hot spot's AUTHORED contract terms sign at: the authored track count, verbatim
 *  (integer ≥ 1). It is NEVER clamped into the mapped contract type's `intensityRange` — that range constrains the FREE
 *  negotiate only; clamping authored content silently rewrote a 5-track custom to 3 (expedition) / 2 (raid) so the
 *  contract auto-completed at chain end with the author's remaining tracks orphaned (tester round 3). */
export function authoredIntensity(terms: { intensity: unknown }): number {
    return Math.max(1, Math.round(Number(terms.intensity) || 1));
}

/** The negotiated terms resolved to their %/enum values. */
export interface ResolvedTerms {
    basePay: number; // %
    command: string; // Command Rights enum
    salvage: number | string; // % | 'None' | 'Exchange'
    support: string; // 'None' | 'Straight/X' | 'Battle/X'
    transport: number; // %
}

export function resolved(steps: Record<ContractColumn, number>): ResolvedTerms {
    return {
        basePay: Number(stepValue('basePay', steps.basePay) ?? 0),
        command: String(stepValue('command', steps.command) ?? '—'),
        salvage: stepValue('salvage', steps.salvage) ?? 'None',
        support: String(stepValue('support', steps.support) ?? 'None'),
        transport: Number(stepValue('transport', steps.transport) ?? 0),
    };
}

/**
 * The fraction of a repair/rearm/heal cost the employer reimburses under the Support term (the ledger's Cover).
 * `Straight/X%` → X/100 of the cost; `Battle/X%` → 100% of repairs (the X% battlefield-losses part is D-110b);
 * `None` / no contract → 0.
 */
export function supportCoverFraction(support: string | null | undefined): number {
    if (!support) return 0;
    if (support.startsWith('Battle/')) return 1;
    if (support.startsWith('Straight/')) return (parseInt(support.split('/')[1], 10) || 0) / 100;
    return 0;
}

// ── D-110b — synthetic Traditional ContractOffer, so the SHARED Forge can run for the Hot Spots fork ──

/** Chaos contract type id → the closest CamOps MissionTypeId (drives the mission spec + OpFor unit-type mix). */
const MISSION_TYPE_BY_CHAOS: Record<string, MissionTypeId> = {
    raid: 'OBJECTIVE_RAID',
    garrison: 'GARRISON_DUTY',
    invasion: 'PLANETARY_ASSAULT', // closest assault
    expedition: 'RECON_RAID', // closest recon
    'pirate-hunt': 'PIRATE_HUNTING',
    retainer: 'CADRE_DUTY', // garrison/cadre
};

function toCommandRights(command: string): CommandRights {
    return command === 'Integrated' || command === 'House' || command === 'Liaison' || command === 'Independent' ? command : 'House';
}
function toSalvageTerms(salvage: number | string): SalvageTerms {
    if (typeof salvage === 'number') return { exchange: false, pct: salvage };
    return salvage === 'Exchange' ? { exchange: true, pct: 0 } : { exchange: false, pct: 0 };
}
function toSupportTerms(support: string): SupportTerms {
    if (support.startsWith('Battle/')) return { kind: 'battle-loss', pct: parseInt(support.split('/')[1], 10) || 0 };
    if (support.startsWith('Straight/')) return { kind: 'straight', pct: parseInt(support.split('/')[1], 10) || 0 };
    return { kind: 'none', pct: 0 };
}

/**
 * D-110b — a MINIMAL Traditional `ContractOffer` synthesized from an active `ChaosContract`, so the SHARED
 * Forge (mission-generator + mission-tree) runs for a Hot Spots campaign (which has no Traditional
 * `acceptedContract`). Income is the Warchest's (SP), NEVER this offer: `pay` is all-zero and the payTick
 * C-bill credit is gated off for hotspots. `missionType` maps the chaos type → the closest CamOps mission;
 * the clauses carry the negotiated terms; `status: 'ACTIVE'` so `generate()` fires and the tree starts. D-110c —
 * `target` is the contract's picked `enemyFaction` (a plausible bordering faction) so the OpFor is faction-
 * appropriate; absent (nothing resolved), it falls back to the generic era-legal IS-union pool (D-102 A3).
 */
export function syntheticOfferFromChaos(c: ChaosContract): ContractOffer {
    const rt = resolved(c.steps);
    const missionType = MISSION_TYPE_BY_CHAOS[c.type] ?? 'GARRISON_DUTY';
    const label = CHAOS_CONTRACT_TYPES.find((t) => t.id === c.type)?.label ?? c.type;
    return {
        id: c.id,
        employer: { name: 'Hot Spots Command', tier: 'independent', generic: true, img: null },
        target: c.enemyFaction ?? `Opposing Force (${label})`, // D-110c — the picked enemy faction (else generic → era-legal IS-union OpFor, D-102 A3)
        missionType,
        missionName: MISSION_TYPES[missionType].name,
        durationMonths: Math.max(1, c.intensity), // ≈ intensity (# of tracks)
        command: toCommandRights(rt.command),
        salvage: toSalvageTerms(rt.salvage),
        support: toSupportTerms(rt.support),
        transportPct: rt.transport,
        rolls: { command: 0, salvage: 0, support: 0, transport: 0 }, // synthetic — no market rolls
        pay: { total: 0, monthly: 0, base: 0, multiplier: 0 }, // SP economy only — never a C-bill payout
        status: 'ACTIVE',
    };
}
