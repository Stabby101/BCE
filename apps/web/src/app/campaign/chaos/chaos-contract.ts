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
    // GM-2 P2b — a PARTICIPANT contract's signing ledger: the rep spent at signing + the net transport (both settle on the
    // FIRST slip after signing — `repSettled` marks it), and who signed (the phone, or the GM as broker).
    repSpent?: number;
    transportSp?: number;
    signedBy?: 'gm' | 'player';
    repSettled?: boolean;
    // GM-3 P1 — THE SESSION CONTRACT: on a gmSession the singular is a PARTY-LESS template minted at Present ▸ from the hot
    // spot's authored terms (Scale · steps · lengthMonths · the chosen side's target). It sits where `contractFor(participant)
    // ?? primary` falls back, so every direct read gets a template and the six hooks BRANCH on it (tree at Present, no
    // GM money, no rep dock, +1 to every signed participant). A plain campaign never carries the mark → byte-identical.
    party?: 'session';
}

/** GM-3 P1 — is this the party-less session contract (a GM session's primary minted at Present ▸)? */
export const isSessionContract = (c: Pick<ChaosContract, 'party'> | null | undefined): boolean => c?.party === 'session';
/** GM-3 P1 (hook 3) — the side a participant signs on the primary. On a GM-signed primary (D-133), a wire-OPFOR player signs
 *  the OPPOSING side (the pair). On a SESSION contract there is no opposed pair in this phase — every participant signs the
 *  side the table plays, so the flip is SUPPRESSED (both-sides-player-run is the hiring hall, a later phase). Pure; the ONE
 *  place both the GM panel and the phone compute it — pinned by chaos-contract.spec.ts, mutation-killed there. */
export function participantSideFor(primary: Pick<ChaosContract, 'party' | 'side'> | null | undefined, deviceSide: string | null | undefined): 'a' | 'b' {
    const primarySide: 'a' | 'b' = primary?.side === 'b' ? 'b' : 'a';
    if (!isSessionContract(primary) && deviceSide === 'OPFOR') return primarySide === 'a' ? 'b' : 'a'; // the D-133 pair (GM-signed primary only)
    return primarySide; // a session contract: the table's side, whatever the device's wire side
}
/** GM-3 P1 — the participant key of the GM's OWN company when he fields (his participant contract pays him like anyone). */
export const GM_SELF_KEY = 'gm-self';

// ── DIRECTIVE-PD3 P2 (PD3-9 + PD3-11) — THE SESSION PHASE. The phone showed a phase that had passed twice over: the side-pick
//    window keyed on the presented brief alone (nothing clears it at completion) and the Briefing overlay read the raw spec (which
//    the H17 retention re-applies after the GM clears it). ONE pure decider over the four fields that already ride the fan —
//    the presented brief · the (player-safe) contract · the mission tree · the spec — plus the TERMINAL contract record P2 adds
//    (`completedChaosContract`, written at both completion sites where the singular used to be nulled with no trace). Pure; the ONE
//    place the pick window, the brief, the H17 retention and the api's side-pref guard (ws-authz, lockstep) compute it. ──
export type SessionPhase = 'none' | 'lobby' | 'committed' | 'complete';
/** D-128's "committed" rule, pure: a track was generated/built — any branch ACTIVE or RESOLVED, or a spec exists. */
export function hasGeneratedTrackOf(tree: readonly { state?: string }[] | null | undefined, spec: unknown): boolean {
    return (tree ?? []).some((b) => b.state === 'ACTIVE' || b.state === 'RESOLVED') || !!spec;
}
export function sessionPhase(a: {
    presented: unknown;                                  // the published brief (presentedHotspot)
    contract: Pick<ChaosContract, 'status'> | null | undefined; // the live singular (contractSummary on a phone, activeChaosContract elsewhere)
    completed: unknown;                                  // the terminal record (completedChaosContract) — a completion, not a never-minted
    tree: readonly { state?: string }[] | null | undefined;
    spec: unknown;
}): SessionPhase {
    const live = a.contract && a.contract.status !== 'completed' ? a.contract : null;
    if (live) return hasGeneratedTrackOf(a.tree, a.spec) ? 'committed' : 'lobby';
    if (a.completed || (a.contract && a.contract.status === 'completed')) return 'complete';
    if (a.presented) return 'complete'; // a brief with no contract: pre-P2 completions nulled the singular without a trace — never a live pick
    return 'none';
}
/** GM-3 P1 — a participant contract VOIDED by un-present: rides under gmOnly.voidedContracts, attached per recipient as
 *  `participantVoid`; the device shows the notice and returns the rep the slip already settled at home (repRefund). */
export interface VoidedContract {
    voidId: string;     // the home campaign's idempotency key (appliedSlips) for the refund
    contractId: string;
    hotspotId?: string;
    repRefund: number;  // the rep spent at signing, IF a slip already settled it at home (else 0 — nothing was debited)
    at: number;         // epoch ms
}

/** GM-2 P2a — the PLAYER-SAFE projection of a contract: its identity WITHOUT its terms (`steps` + `offerSnapshot` never
 *  leave the GM device — H14). The GM writers put it top-level in a GM session so `sideLabelsOf` on a player device reads
 *  the same employer / role / enemy it read before the singular moved under gmOnly. */
export type ContractSummary = Omit<ChaosContract, 'steps' | 'offerSnapshot'> & { lockedCommand?: number }; // P2b — the ONE term a participant may see: Command, locked to the primary's value (displayed, never negotiable)
export function contractSummaryOf(c: ChaosContract | null | undefined): ContractSummary | null {
    if (!c) return null;
    const { steps: _s, offerSnapshot: _o, ...rest } = c; void _o;
    return { ...rest, ...(typeof _s?.command === 'number' ? { lockedCommand: _s.command } : {}) };
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
