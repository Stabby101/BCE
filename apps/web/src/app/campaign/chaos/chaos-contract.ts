import { type ContractColumn, stepValue, CHAOS_CONTRACT_TYPES } from './chaos-contract-steps';
import type { CampaignStartDate } from '../new-campaign-state';
import type { ContractOffer } from '../contract/contract-market';
import { MISSION_TYPES, type MissionTypeId, type CommandRights, type SalvageTerms, type SupportTerms } from '../contract/contract-terms';

export interface ChaosContract {
    id: string;
    type: string; // ChaosContractType.id
    scale: number; // Contract Scale 1–3 (drives Base Pay / Maintenance / Transport / limits)
    intensity: number;
    steps: Record<ContractColumn, number>; // 0-based step index per negotiated term
    status: 'active' | 'completed';
    acceptedDate: CampaignStartDate | null;
    groundDate?: CampaignStartDate | null;
    tracksDone: number;
    enemyFaction?: string;
    hotspotId?: string;
    offerSnapshot?: string[];
    lengthMonths?: number;
    // accept). Old saves lack these → treated as single-sided legacy (side undefined = today's behavior).
    side?: 'a' | 'b';
    sideRole?: 'attacker' | 'defender';
    employer?: string; // who you signed with (the chosen side's employer)
    // FIRST slip after signing — `repSettled` marks it), and who signed (the phone, or the GM as broker).
    repSpent?: number;
    transportSp?: number;
    signedBy?: 'gm' | 'player';
    repSettled?: boolean;
    // spot's authored terms (Scale · steps · lengthMonths · the chosen side's target). It sits where `contractFor(participant)
    // ?? primary` falls back, so every direct read gets a template and the six hooks BRANCH on it (tree at Present, no
    // GM money, no rep dock, +1 to every signed participant). A plain campaign never carries the mark → byte-identical.
    party?: 'session';
}

export const isSessionContract = (c: Pick<ChaosContract, 'party'> | null | undefined): boolean => c?.party === 'session';
export function participantSideFor(primary: Pick<ChaosContract, 'party' | 'side'> | null | undefined, deviceSide: string | null | undefined): 'a' | 'b' {
    const primarySide: 'a' | 'b' = primary?.side === 'b' ? 'b' : 'a';
    if (!isSessionContract(primary) && deviceSide === 'OPFOR') return primarySide === 'a' ? 'b' : 'a';
    return primarySide; // a session contract: the table's side, whatever the device's wire side
}
export const GM_SELF_KEY = 'gm-self';

//    window keyed on the presented brief alone (nothing clears it at completion) and the Briefing overlay read the raw spec (which
//    the presented brief · the (player-safe) contract · the mission tree · the spec — plus the TERMINAL contract record P2 adds
//    (`completedChaosContract`, written at both completion sites where the singular used to be nulled with no trace). Pure; the ONE
export type SessionPhase = 'none' | 'lobby' | 'committed' | 'complete';
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
export interface VoidedContract {
    voidId: string;     // the home campaign's idempotency key (appliedSlips) for the refund
    contractId: string;
    hotspotId?: string;
    repRefund: number;  // the rep spent at signing, IF a slip already settled it at home (else 0 — nothing was debited)
    at: number;         // epoch ms
}

export type ContractSummary = Omit<ChaosContract, 'steps' | 'offerSnapshot'> & { lockedCommand?: number }; // P2b — the ONE term a participant may see: Command, locked to the primary's value (displayed, never negotiable)
export function contractSummaryOf(c: ChaosContract | null | undefined): ContractSummary | null {
    if (!c) return null;
    const { steps: _s, offerSnapshot: _o, ...rest } = c; void _o;
    return { ...rest, ...(typeof _s?.command === 'number' ? { lockedCommand: _s.command } : {}) };
}

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

export function supportCoverFraction(support: string | null | undefined): number {
    if (!support) return 0;
    if (support.startsWith('Battle/')) return 1;
    if (support.startsWith('Straight/')) return (parseInt(support.split('/')[1], 10) || 0) / 100;
    return 0;
}


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

export const UNSIGNED_EMPLOYER = 'Independent employer';
export function syntheticOfferFromChaos(c: ChaosContract): ContractOffer {
    const rt = resolved(c.steps);
    const missionType = MISSION_TYPE_BY_CHAOS[c.type] ?? 'GARRISON_DUTY';
    const label = CHAOS_CONTRACT_TYPES.find((t) => t.id === c.type)?.label ?? c.type;
    const employer = (c.employer ?? '').trim();
    return {
        id: c.id,
        employer: { name: employer || UNSIGNED_EMPLOYER, tier: 'independent', generic: !employer, img: null },
        target: c.enemyFaction ?? `Opposing Force (${label})`,
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
