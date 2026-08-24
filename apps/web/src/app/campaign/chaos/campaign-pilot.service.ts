/*
 * DIRECTIVE-125 — Campaign Pilot advancement service (Hot Spots fork). Every action is a ledger-visible Warchest
 * debit (D-110), gated on funds, then an immutable pilot update (mirrors PilotService's map+spread pattern, KIA-guard):
 * raise Gunnery/Piloting (skill drops → the D-070 roster BV recompute picks it up reactively) · buy Edge tokens ·
 * learn an Edge Ability/SPA (from pilot-abilities.ts, but SP-priced, stored on campaignPilot.learnedAbilities — NOT
 * the free-slot `perks`) · heal a wound box (reuses D-036 hits/status) · train Formation Commander + Command Abilities.
 * Handicap is a stored accumulator: each bought rung adds its H-column. HS-only; the caller/UI is HS-gated.
 */
import { Injectable, inject } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { CampaignSaveStore } from '../campaign-save-store';
import { WarchestService } from './warchest.service';
import type { Pilot, CampaignPilot } from '../barracks/pilot-generator';
import { initCampaignPilot, nextGunneryRung, nextPilotingRung, nextEdgeRung, nextAbilityRung, nextCommandAbilityCost, PILOT_CARD_PRICES } from './pilot-card';

@Injectable({ providedIn: 'root' })
export class CampaignPilotService {
    private readonly state = inject(NewCampaignState);
    private readonly store = inject(CampaignSaveStore);
    private readonly warchest = inject(WarchestService);

    private pilot(pilotId: string): Pilot | undefined { return (this.state.pilots() ?? []).find((p) => p.pilotId === pilotId); }
    private afford(cost: number): boolean { return (this.state.warchestSP() ?? 0) >= cost; }
    /** The AS unit-class for a pilot from their assigned 'Mech/vehicle (BM / CV), else BM. */
    private typeFor(p: Pilot): string { const u = (this.state.startingForce() ?? []).find((i) => i.instanceId === p.assignedInstanceId); return u?.unitType === 'vehicle' ? 'CV' : 'BM'; }
    /** Immutable pilot update: ensure a card exists, apply fn(pilot, card), setPilots + persist. KIA-guarded. */
    private commit(pilotId: string, fn: (p: Pilot, cp: CampaignPilot) => Pilot): void {
        this.state.setPilots((this.state.pilots() ?? []).map((p) => {
            if (p.pilotId !== pilotId || p.status === 'KIA') return p;
            return fn(p, p.campaignPilot ?? initCampaignPilot(p, this.typeFor(p)));
        }));
        void this.store.persistCurrent();
    }

    /** Lazily give a named HS pilot a campaign card (idempotent; safe to call on render). */
    ensure(pilotId: string): void {
        const p = this.pilot(pilotId);
        if (!p || p.campaignPilot || p.status === 'KIA') return;
        this.commit(pilotId, (p, cp) => ({ ...p, campaignPilot: cp }));
    }

    raiseGunnery(pilotId: string): void {
        const p = this.pilot(pilotId); if (!p || p.status === 'KIA') return;
        const rung = nextGunneryRung(p.gunnery); if (!rung || !this.afford(rung.sp)) return;
        this.warchest.post(`Pilot training — ${p.name}: Gunnery ${p.gunnery}→${rung.to}`, rung.sp, 0);
        this.commit(pilotId, (p, cp) => ({ ...p, gunnery: rung.to!, campaignPilot: { ...cp, investedSP: { ...cp.investedSP, gunnery: cp.investedSP.gunnery + rung.sp }, handicap: cp.handicap + rung.h } }));
    }
    raisePiloting(pilotId: string): void {
        const p = this.pilot(pilotId); if (!p || p.status === 'KIA') return;
        const rung = nextPilotingRung(p.piloting); if (!rung || !this.afford(rung.sp)) return;
        this.warchest.post(`Pilot training — ${p.name}: Piloting ${p.piloting}→${rung.to}`, rung.sp, 0);
        this.commit(pilotId, (p, cp) => ({ ...p, piloting: rung.to!, campaignPilot: { ...cp, investedSP: { ...cp.investedSP, piloting: cp.investedSP.piloting + rung.sp }, handicap: cp.handicap + rung.h } }));
    }
    buyEdge(pilotId: string): void {
        const p = this.pilot(pilotId); if (!p || p.status === 'KIA') return;
        const cp0 = p.campaignPilot ?? initCampaignPilot(p, this.typeFor(p));
        const rung = nextEdgeRung(cp0.edgeTokens); if (!rung || !this.afford(rung.sp)) return;
        this.warchest.post(`Pilot Edge — ${p.name}: token ${rung.n}`, rung.sp, 0);
        this.commit(pilotId, (p, cp) => ({ ...p, campaignPilot: { ...cp, edgeTokens: cp.edgeTokens + 1, investedSP: { ...cp.investedSP, edge: cp.investedSP.edge + rung.sp }, handicap: cp.handicap + rung.h } }));
    }
    learnAbility(pilotId: string, abilityId: string, abilityName: string): void {
        const p = this.pilot(pilotId); if (!p || p.status === 'KIA') return;
        const cp0 = p.campaignPilot ?? initCampaignPilot(p, this.typeFor(p));
        if (cp0.learnedAbilities.includes(abilityId)) return;
        const rung = nextAbilityRung(cp0.learnedAbilities.length); if (!rung || !this.afford(rung.sp)) return;
        this.warchest.post(`Pilot SPA — ${p.name}: ${abilityName}`, rung.sp, 0);
        this.commit(pilotId, (p, cp) => ({ ...p, campaignPilot: { ...cp, learnedAbilities: [...cp.learnedAbilities, abilityId], investedSP: { ...cp.investedSP, abilities: cp.investedSP.abilities + rung.sp }, handicap: cp.handicap + rung.h } }));
    }
    healWound(pilotId: string): void {
        const p = this.pilot(pilotId); if (!p || p.status === 'KIA' || (p.hits ?? 0) <= 0) return;
        if (!this.afford(PILOT_CARD_PRICES.heal)) return;
        this.warchest.post(`Pilot heal — ${p.name} (1 box)`, PILOT_CARD_PRICES.heal, 0);
        this.commit(pilotId, (p, cp) => {
            const hits = Math.max(0, (p.hits ?? 0) - 1);
            const healed = hits === 0;
            return { ...p, hits, status: healed ? 'Active' : p.status, recoveryDays: healed ? undefined : p.recoveryDays, campaignPilot: { ...cp, wounds: hits } };
        });
    }
    trainFormationCommander(pilotId: string): void {
        const p = this.pilot(pilotId); if (!p || p.status === 'KIA' || p.campaignPilot?.formationCommander) return;
        if (!this.afford(PILOT_CARD_PRICES.formationCommander)) return;
        this.warchest.post(`Formation Commander — ${p.name}`, PILOT_CARD_PRICES.formationCommander, 0);
        this.commit(pilotId, (p, cp) => ({ ...p, campaignPilot: { ...cp, formationCommander: true } }));
    }
    learnCommandAbility(pilotId: string, ability: string): void {
        const p = this.pilot(pilotId); if (!p || p.status === 'KIA') return;
        const cp0 = p.campaignPilot ?? initCampaignPilot(p, this.typeFor(p));
        if (!cp0.formationCommander || cp0.commandAbilities.includes(ability)) return;
        const cost = nextCommandAbilityCost(cp0.commandAbilities.length); if (cost == null || !this.afford(cost)) return;
        this.warchest.post(`Command Ability — ${p.name}: ${ability}`, cost, 0);
        this.commit(pilotId, (p, cp) => ({ ...p, campaignPilot: { ...cp, commandAbilities: [...cp.commandAbilities, ability] } }));
    }
    replaceCommandAbility(pilotId: string, oldAbility: string, newAbility: string): void {
        const p = this.pilot(pilotId); if (!p || p.status === 'KIA') return;
        const cp0 = p.campaignPilot ?? initCampaignPilot(p, this.typeFor(p));
        if (!cp0.formationCommander || !cp0.commandAbilities.includes(oldAbility) || cp0.commandAbilities.includes(newAbility)) return;
        if (!this.afford(PILOT_CARD_PRICES.replaceCommandAbility)) return;
        this.warchest.post(`Command Ability swap — ${p.name}: ${oldAbility}→${newAbility}`, PILOT_CARD_PRICES.replaceCommandAbility, 0);
        this.commit(pilotId, (p, cp) => ({ ...p, campaignPilot: { ...cp, commandAbilities: cp.commandAbilities.map((a) => (a === oldAbility ? newAbility : a)) } }));
    }
}
