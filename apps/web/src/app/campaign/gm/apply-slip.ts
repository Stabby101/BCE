import type { CampaignSnapshot } from '../campaign-persistence.service';
import type { CampaignStartDate, WarchestEntry } from '../new-campaign-state';
import type { Pilot } from '../barracks/pilot-generator';
import type { CBTSerializedState } from '../../models/force-serialization';
import { pilotOutcome } from '../walk/field-walk-core';
import { initCampaignPilot } from '../chaos/pilot-card';
import { hsDamaged } from '../battle/hs-damage'; // PD3 P1 — the one HS damage truth (counts what came home hurt)
import type { ResultsSlip, SlipUnitRow } from './results-slip';

export type ApplyRefusal = 'no-slip-id' | 'already-applied' | 'no-rows' | 'not-hotspots' | 'no-match';
export type ApplyResult =
    | { ok: true; snapshot: CampaignSnapshot; matched: string[]; removed: string[]; unmatched: string[]; damaged: string[]; ledgerEvent: string; sp: number; byTerms: boolean; repDelta: number; pilotSp: number }
    | { ok: false; reason: ApplyRefusal; detail?: string };

/** The ledger line's event text — the session's identity, so three sessions read as three lines. */
export function slipLedgerEvent(slip: Pick<ResultsSlip, 'slipId' | 'sessionName' | 'hotspotTitle' | 'trackName' | 'outcome'>): string {
    const id = (slip.slipId ?? '').slice(0, 8) || '—';
    return `Session — ${slip.sessionName ?? 'GM session'} · ${slip.hotspotTitle ?? 'hot spot'} · ${slip.trackName} · ${(slip.outcome ?? 'resolved').replace(/_/g, ' ')} · slip ${id}`;
}

/** The 1-based campaign month (Month 1 = the start month) — warchest.service.campaignMonth, verbatim. */
export function campaignMonthOf(start: CampaignStartDate | null | undefined, cur: CampaignStartDate | null | undefined): number {
    const c = cur ?? start;
    if (!start || !c) return 1;
    return Math.max(1, (c.y - start.y) * 12 + (c.m - start.m) + 1);
}

const KIA_DEFAULT: CampaignStartDate = { y: 3025, m: 0, d: 1 }; // applyHsSettlement's `today() ?? {3025,0,1}`

export function applySlipToSnapshot(snap: CampaignSnapshot, slip: ResultsSlip, rows: readonly SlipUnitRow[], homeKeyHint?: string | null): ApplyResult {
    if (!slip.slipId) return { ok: false, reason: 'no-slip-id' };
    const applied = Array.isArray(snap.appliedSlips) ? snap.appliedSlips : [];
    if (applied.includes(slip.slipId)) return { ok: false, reason: 'already-applied' };
    // completion) with no rows of its own — the company signed but did not field the last track. It applies as pay + rep
    // alone; the home key then comes from the hint (this device's own company), never from rows it does not have.
    const hintedOwn = !rows.length && homeKeyHint ? slip.pay?.[homeKeyHint] : undefined;
    if (!rows.length && !hintedOwn) return { ok: false, reason: 'no-rows' };
    if (!snap.hotSpotCampaign || typeof snap.warchestSP !== 'number') return { ok: false, reason: 'not-hotspots' };

    let force = [...(snap.startingForce ?? [])];
    let pilots: Pilot[] = [...(snap.pilots ?? [])];
    const today = snap.currentDate ?? snap.startDate ?? KIA_DEFAULT;
    const matched: string[] = [], removed: string[] = [], unmatched: string[] = [];
    const damaged: string[] = []; // PD3 P1 — the returning units that came home HURT (an envelope or a tabletop level landed)

    for (const row of rows) {
        const homeId = row.originInstanceId;
        const idx = homeId ? force.findIndex((u) => u.instanceId === homeId) : -1;
        if (idx < 0) { unmatched.push(row.label); continue; }
        matched.push(homeId as string);
        if (row.status === 'ok') {
            // the returning unit: the carried end-state, when there is one; its pilot through the home campaign's own
            // walk rule (pilotOutcome over the crew track — the slip's crewHits stands in when no end-state was carried)
            if (row.damage) force[idx] = { ...force[idx], damage: JSON.parse(JSON.stringify(row.damage)) };
            // Repair & Refit list sees a table-played hit exactly as it sees a digital one (the one damage truth, hs-damage.ts).
            if (row.chaosDamage) force[idx] = { ...force[idx], chaosDamage: row.chaosDamage };
            if (row.triage) force[idx] = { ...force[idx], triage: row.triage };
            if (row.chaosDamage || (row.damage && hsDamaged({ damage: row.damage as CBTSerializedState }))) damaged.push(homeId as string);
            const end: CBTSerializedState | null = row.damage ?? (row.crewHits ? ({ crew: [{ hits: row.crewHits }] } as unknown as CBTSerializedState) : null);
            if (end) {
                const outcome = pilotOutcome(end);
                pilots = pilots.map((p) => {
                    if (p.assignedInstanceId !== homeId) return p;
                    if (p.status === 'KIA') return p; // the reversibility guard — dead stays dead
                    if (outcome.status === 'KIA') return { ...p, status: 'KIA' as const, recoveryDays: undefined, hits: 6, kiaDate: today, assignedInstanceId: undefined };
                    if (outcome.status === 'Injured') return { ...p, status: 'Injured' as const, recoveryDays: outcome.recoveryDays, hits: outcome.hits, assignedInstanceId: undefined };
                    return p;
                });
            }
            continue;
        }
        // the lost unit — applyHsSettlement's loss branch, verbatim
        const fate = row.pilotFate ?? 'ok';
        pilots = pilots.map((p) => {
            if (p.assignedInstanceId !== homeId) return p;
            if (p.status === 'KIA') return p;
            if (fate === 'kia') return { ...p, status: 'KIA' as const, hits: 6, recoveryDays: undefined, kiaDate: today, assignedInstanceId: undefined };
            if (fate === 'injured') return { ...p, status: 'Injured' as const, hits: Math.max(1, p.hits ?? 2), recoveryDays: p.recoveryDays ?? 14, assignedInstanceId: undefined };
            return { ...p, assignedInstanceId: undefined }; // 'ok' — the pilot walked out; just free the lost 'Mech
        });
        force = force.filter((u) => u.instanceId !== homeId);
        removed.push(homeId as string);
    }
    if (rows.length && !matched.length) return { ok: false, reason: 'no-match', detail: unmatched.join(', ') };

    // the card is lazily initialized with the pilot's unit class exactly as the earn side does; a KIA pilot earns nothing.
    const spMap = slip.pilotSp ?? {};
    let pilotSp = 0;
    pilots = pilots.map((p) => {
        const sp = Math.round(spMap[p.pilotId] ?? 0);
        if (sp <= 0 || p.status === 'KIA') return p;
        const unit = (snap.startingForce ?? []).find((u) => u.instanceId === p.assignedInstanceId);
        const cp = p.campaignPilot ?? initCampaignPilot(p, unit?.unitType === 'vehicle' ? 'CV' : 'BM');
        pilotSp += sp;
        return { ...p, campaignPilot: { ...cp, careerSP: cp.careerSP + sp } };
    });

    // its OWN contract this session takes the per-player figure the slip carries under its home campaign id (paid by ITS
    // terms); any other company takes the TEAM share, exactly as P1 paid it.
    const homeKey = rows.find((r) => r.sourceCampaignId)?.sourceCampaignId ?? (rows.length ? undefined : homeKeyHint ?? undefined);
    const own = homeKey ? slip.pay?.[homeKey] : undefined;
    const byTerms = !!own;
    // first slip after signing); it MAY be negative (a poor track under a dear transport) — then the line is a cost.
    const sp = own
        ? Math.round((own.combatPay ?? 0) + (own.salvageSp ?? 0) + (own.basePaySp ?? 0) - (own.transportSp ?? 0))
        : Math.max(0, Math.round((slip.combatPay ?? 0) + (slip.salvageSp ?? 0)));
    const repDelta = Math.round(own?.repDelta ?? 0);
    const reputation = Math.max(0, (snap.reputation ?? 0) + repDelta);
    const prev = snap.warchestSP ?? 0;
    const cost = -sp, cover = 0, paid = cost - cover, balance = prev - paid;
    const event = slipLedgerEvent(slip);
    const entry: WarchestEntry = { month: campaignMonthOf(snap.startDate, snap.currentDate), event, cost, cover, paid, balance, rep: reputation };

    return {
        ok: true,
        snapshot: {
            ...snap,
            startingForce: force,
            pilots,
            warchestSP: balance,
            ...(repDelta ? { reputation } : {}), // P2b — untouched when the slip carries no delta (byte-identical P1/P2a)
            warchestLedger: [...(snap.warchestLedger ?? []), entry],
            appliedSlips: [...applied, slip.slipId],
        },
        matched, removed, unmatched, damaged, ledgerEvent: event, sp, byTerms, repDelta, pilotSp,
    };
}

export type ApplyVoidResult = { ok: true; snapshot: CampaignSnapshot; repRefund: number; reputation: number } | { ok: false; reason: 'already-applied' | 'not-hotspots' };
export function applyVoidToSnapshot(snap: CampaignSnapshot, v: { voidId: string; repRefund: number }): ApplyVoidResult {
    const applied = Array.isArray(snap.appliedSlips) ? snap.appliedSlips : [];
    if (applied.includes(v.voidId)) return { ok: false, reason: 'already-applied' };
    if (!snap.hotSpotCampaign || typeof snap.warchestSP !== 'number') return { ok: false, reason: 'not-hotspots' };
    const repRefund = Math.max(0, Math.round(v.repRefund ?? 0));
    const reputation = (snap.reputation ?? 0) + repRefund;
    return { ok: true, snapshot: { ...snap, ...(repRefund ? { reputation } : {}), appliedSlips: [...applied, v.voidId] }, repRefund, reputation };
}
