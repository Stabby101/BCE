import { applySlipToSnapshot, applyVoidToSnapshot, campaignMonthOf, slipLedgerEvent } from './apply-slip';
import type { CampaignSnapshot } from '../campaign-persistence.service';
import type { ResultsSlip, SlipUnitRow } from './results-slip';

const home = (): CampaignSnapshot => ({
    version: 1, savedAt: 1, era: null, startDate: { y: 3151, m: 2, d: 1 }, currentDate: { y: 3151, m: 4, d: 9 },
    hotSpotCampaign: 'generic', warchestSP: 1000, reputation: 2, warchestLedger: [{ month: 1, event: 'Starting Warchest', cost: 0, cover: 0, paid: 0, balance: 1000, rep: 2 }],
    startingForce: [
        { instanceId: 'h-1', unitRef: 'Atlas AS7-D', chassis: 'Atlas', model: 'AS7-D', mulId: 31, tons: 100, bv: 1897, condition: 'Active' },
        { instanceId: 'h-2', unitRef: 'Locust LCT-1V', chassis: 'Locust', model: 'LCT-1V', mulId: 1922, tons: 20, bv: 432, condition: 'Active' },
        { instanceId: 'h-3', unitRef: 'Wasp WSP-1A', chassis: 'Wasp', model: 'WSP-1A', mulId: 3500, tons: 20, bv: 300, condition: 'Reserve' },
    ],
    pilots: [
        { pilotId: 'hp-1', name: 'Kerensky Jr', gunnery: 3, piloting: 4, status: 'Active', assignedInstanceId: 'h-1' },
        { pilotId: 'hp-2', name: 'Bench Pilot', gunnery: 4, piloting: 5, status: 'Active', assignedInstanceId: 'h-2', hits: 0 },
    ],
} as unknown as CampaignSnapshot);

const slip = (over: Partial<ResultsSlip> = {}): ResultsSlip => ({
    slipId: 'a1b2c3d4-0000-4000-8000-000000000001', branchId: 'br-1', trackName: 'The Kobe Road', resolvedAt: 1, outcome: 'FULL_SUCCESS',
    combatPay: 1500, salvageSp: 250, sessionName: "James's Table", hotspotTitle: 'The Kado-guchi Valley', units: [], ...over,
});
const rowOk = (over: Partial<SlipUnitRow> = {}): SlipUnitRow => ({ instanceId: 'imp-x-1-0', label: 'Atlas AS7-D', status: 'ok', sourceCampaignId: 'home-pen', originInstanceId: 'h-1', originPilotId: 'hp-1', damage: { destroyed: false, crew: [{ hits: 2 }] } as never, crewHits: 2, ...over });
const rowLost = (fate: 'ok' | 'injured' | 'kia', status: 'destroyed' | 'abandoned' = 'destroyed'): SlipUnitRow => ({ instanceId: 'imp-x-1-1', label: 'Locust LCT-1V', status, pilotFate: fate, sourceCampaignId: 'home-pen', originInstanceId: 'h-2', originPilotId: 'hp-2', damage: null });

describe('applySlipToSnapshot — the returning unit', () => {
    it('matches by originInstanceId, applies the carried end-state, runs the home WALK rule on the pilot (2 hits → Injured, 5 days, unassigned), leaves everything else', () => {
        const r = applySlipToSnapshot(home(), slip(), [rowOk()]);
        expect(r.ok).toBeTrue(); if (!r.ok) return;
        expect(r.matched).toEqual(['h-1']); expect(r.removed).toEqual([]);
        const u = r.snapshot.startingForce!.find((x) => x.instanceId === 'h-1')!;
        expect((u.damage as { crew: { hits: number }[] }).crew[0].hits).toBe(2);
        const p = r.snapshot.pilots!.find((x) => x.pilotId === 'hp-1')!;
        expect(p.status).toBe('Injured'); expect(p.hits).toBe(2); expect(p.recoveryDays).toBe(5); /* WALK_TUNABLES.recoveryDaysByHits[2] */ expect(p.assignedInstanceId).toBeUndefined();
        expect(r.snapshot.startingForce!.length).toBe(3);
        expect(r.snapshot.startingForce!.find((x) => x.instanceId === 'h-3')).toEqual(home().startingForce![2]);
    });
    it('the walk rule end to end: crewHits alone (no carried end-state) still wounds the pilot; a dead crew is KIA and the unit is KEPT; an unwounded crew is untouched', () => {
        const wounded = applySlipToSnapshot(home(), slip(), [rowOk({ damage: null, crewHits: 4 })]);
        expect(wounded.ok).toBeTrue(); if (!wounded.ok) return;
        const p4 = wounded.snapshot.pilots!.find((x) => x.pilotId === 'hp-1')!;
        expect(p4.status).toBe('Injured'); expect(p4.hits).toBe(4); expect(p4.recoveryDays).toBe(20);
        const dead = applySlipToSnapshot(home(), slip(), [rowOk({ damage: { destroyed: false, crew: [{ hits: 6 }] } as never, crewHits: 6 })]);
        expect(dead.ok).toBeTrue(); if (!dead.ok) return;
        const p6 = dead.snapshot.pilots!.find((x) => x.pilotId === 'hp-1')!;
        expect(p6.status).toBe('KIA'); expect(p6.hits).toBe(6); expect(p6.kiaDate).toEqual({ y: 3151, m: 4, d: 9 }); expect(p6.assignedInstanceId).toBeUndefined();
        expect(dead.snapshot.startingForce!.some((x) => x.instanceId === 'h-1')).toBeTrue(); expect(dead.removed).toEqual([]);
        const fine = applySlipToSnapshot(home(), slip(), [rowOk({ damage: { destroyed: false, crew: [{ hits: 0 }] } as never, crewHits: undefined })]);
        expect(fine.ok).toBeTrue(); if (!fine.ok) return;
        expect(fine.snapshot.pilots!.find((x) => x.pilotId === 'hp-1')).toEqual(home().pilots![0]);
    });
    it('a null end-state leaves the home unit untouched (the GM never reconciled it)', () => {
        const r = applySlipToSnapshot(home(), slip(), [rowOk({ damage: null, crewHits: undefined })]);
        expect(r.ok).toBeTrue(); if (!r.ok) return;
        expect(r.snapshot.startingForce!.find((x) => x.instanceId === 'h-1')!.damage).toBeUndefined();
    });
});

describe('applySlipToSnapshot — the lost unit (applyHsSettlement verbatim)', () => {
    it('destroyed + pilot kia → the unit is REMOVED, the pilot KIA with 6 hits, kiaDate = the home date, unassigned', () => {
        const r = applySlipToSnapshot(home(), slip(), [rowLost('kia')]);
        expect(r.ok).toBeTrue(); if (!r.ok) return;
        expect(r.removed).toEqual(['h-2']);
        expect(r.snapshot.startingForce!.some((x) => x.instanceId === 'h-2')).toBeFalse();
        const p = r.snapshot.pilots!.find((x) => x.pilotId === 'hp-2')!;
        expect(p.status).toBe('KIA'); expect(p.hits).toBe(6); expect(p.kiaDate).toEqual({ y: 3151, m: 4, d: 9 }); expect(p.assignedInstanceId).toBeUndefined();
    });
    it('abandoned + pilot injured → removed, the pilot Injured with max(1, hits ?? 2) and recoveryDays ?? 14 (an unwounded pilot lands at 1; an unrecorded one at 2)', () => {
        const r = applySlipToSnapshot(home(), slip(), [rowLost('injured', 'abandoned')]);
        expect(r.ok).toBeTrue(); if (!r.ok) return;
        const p = r.snapshot.pilots!.find((x) => x.pilotId === 'hp-2')!;
        expect(p.status).toBe('Injured'); expect(p.hits).toBe(1); /* the fixture pilot has hits 0 → max(1, 0) */ expect(p.recoveryDays).toBe(14); expect(p.assignedInstanceId).toBeUndefined();
        const fresh = home(); delete (fresh.pilots![1] as { hits?: number }).hits;
        const r2 = applySlipToSnapshot(fresh, slip(), [rowLost('injured', 'abandoned')]);
        expect(r2.ok).toBeTrue(); if (!r2.ok) return;
        expect(r2.snapshot.pilots!.find((x) => x.pilotId === 'hp-2')!.hits).toBe(2);
    });
    it("lost + pilot 'ok' → removed, the pilot merely unassigned; a KIA pilot is never revived", () => {
        const r = applySlipToSnapshot(home(), slip(), [rowLost('ok')]);
        expect(r.ok).toBeTrue(); if (!r.ok) return;
        const p = r.snapshot.pilots!.find((x) => x.pilotId === 'hp-2')!;
        expect(p.status).toBe('Active'); expect(p.assignedInstanceId).toBeUndefined();
        const dead = home(); dead.pilots![1] = { ...dead.pilots![1], status: 'KIA' };
        const r2 = applySlipToSnapshot(dead, slip(), [rowLost('injured')]);
        expect(r2.ok).toBeTrue(); if (!r2.ok) return;
        expect(r2.snapshot.pilots!.find((x) => x.pilotId === 'hp-2')!.status).toBe('KIA');
    });
});

describe('applySlipToSnapshot — the ONE ledger line + the idempotency key', () => {
    it('posts combatPay + salvageSp as ONE income line (negative cost, balance raised) naming session · hot spot · track · outcome · slip, at the home campaign\'s month', () => {
        const r = applySlipToSnapshot(home(), slip(), [rowOk()]);
        expect(r.ok).toBeTrue(); if (!r.ok) return;
        expect(r.sp).toBe(1750);
        expect(r.snapshot.warchestSP).toBe(2750);
        expect(r.snapshot.warchestLedger!.length).toBe(2);
        const line = r.snapshot.warchestLedger![1];
        expect(line).toEqual({ month: 3, event: "Session — James's Table · The Kado-guchi Valley · The Kobe Road · FULL SUCCESS · slip a1b2c3d4", cost: -1750, cover: 0, paid: -1750, balance: 2750, rep: 2 });
        expect(r.snapshot.appliedSlips).toEqual(['a1b2c3d4-0000-4000-8000-000000000001']);
    });
    it('applying the same slip twice is a typed refusal — no second line, no second write', () => {
        const first = applySlipToSnapshot(home(), slip(), [rowOk()]);
        expect(first.ok).toBeTrue(); if (!first.ok) return;
        const second = applySlipToSnapshot(first.snapshot, slip(), [rowOk()]);
        expect(second).toEqual({ ok: false, reason: 'already-applied' });
    });
    it('a zero-pay slip still writes its ledger line (three sessions, three lines)', () => {
        const r = applySlipToSnapshot(home(), slip({ combatPay: 0, salvageSp: 0 }), [rowOk()]);
        expect(r.ok).toBeTrue(); if (!r.ok) return;
        expect(r.snapshot.warchestLedger!.length).toBe(2); expect(r.snapshot.warchestSP).toBe(1000);
    });
});

describe('applySlipToSnapshot — refusals, typed', () => {
    it('no slipId (a pre-P1 slip) · no rows · a non-Hot-Spots home (no Warchest) · no row matched', () => {
        expect(applySlipToSnapshot(home(), slip({ slipId: undefined }), [rowOk()])).toEqual({ ok: false, reason: 'no-slip-id' });
        expect(applySlipToSnapshot(home(), slip(), [])).toEqual({ ok: false, reason: 'no-rows' });
        const trad = { ...home(), hotSpotCampaign: null, warchestSP: null } as unknown as CampaignSnapshot;
        expect(applySlipToSnapshot(trad, slip(), [rowOk()])).toEqual({ ok: false, reason: 'not-hotspots' });
        expect(applySlipToSnapshot(home(), slip(), [rowOk({ originInstanceId: 'nope' })])).toEqual({ ok: false, reason: 'no-match', detail: 'Atlas AS7-D' });
    });
    it('a row from a pre-P1 mint (no originInstanceId) is reported unmatched, not applied', () => {
        const r = applySlipToSnapshot(home(), slip(), [rowOk(), rowOk({ originInstanceId: undefined, label: 'Ghost' })]);
        expect(r.ok).toBeTrue(); if (!r.ok) return;
        expect(r.unmatched).toEqual(['Ghost']); expect(r.matched).toEqual(['h-1']);
    });
});

describe('helpers', () => {
    it('campaignMonthOf mirrors warchest.service.campaignMonth', () => {
        expect(campaignMonthOf({ y: 3151, m: 2, d: 1 }, { y: 3151, m: 2, d: 20 })).toBe(1);
        expect(campaignMonthOf({ y: 3151, m: 2, d: 1 }, { y: 3152, m: 0, d: 1 })).toBe(11);
        expect(campaignMonthOf(null, { y: 3152, m: 0, d: 1 })).toBe(1);
        expect(campaignMonthOf({ y: 3151, m: 2, d: 1 }, null)).toBe(1);
    });
    it('slipLedgerEvent degrades honestly without the optional identity fields', () => {
        expect(slipLedgerEvent({ slipId: undefined, trackName: 'T', outcome: undefined })).toBe('Session — GM session · hot spot · T · resolved · slip —');
    });
});

describe('applySlipToSnapshot — P2a: per-player pay (S21)', () => {
    it('a slip carrying THIS home\'s own figure lands that figure, not the team share', () => {
        const r = applySlipToSnapshot(home(), slip({ pay: { 'home-pen': { combatPay: 3000, salvageSp: 500 } } }), [rowOk()]);
        expect(r.ok).toBeTrue(); if (!r.ok) return;
        expect(r.byTerms).toBeTrue(); expect(r.sp).toBe(3500); expect(r.snapshot.warchestSP).toBe(4500);
        expect(r.snapshot.warchestLedger![1].cost).toBe(-3500);
    });
    it('a slip whose pay names only ANOTHER home falls back to the team share (P1, byte-identical)', () => {
        const r = applySlipToSnapshot(home(), slip({ pay: { 'home-pen2': { combatPay: 3000, salvageSp: 500 } } }), [rowOk()]);
        expect(r.ok).toBeTrue(); if (!r.ok) return;
        expect(r.byTerms).toBeFalse(); expect(r.sp).toBe(1750); expect(r.snapshot.warchestSP).toBe(2750);
    });
    it('no pay key at all (a P1 slip) → the team share', () => {
        const r = applySlipToSnapshot(home(), slip(), [rowOk()]);
        expect(r.ok).toBeTrue(); if (!r.ok) return;
        expect(r.byTerms).toBeFalse(); expect(r.sp).toBe(1750);
    });
});

describe('applySlipToSnapshot — P2b: base pay + transport in the ONE line, the rep write-back', () => {
    it('own terms: combat + salvage + base pay − transport in ONE line; reputation = start + repDelta (floored at 0)', () => {
        const r = applySlipToSnapshot(home(), slip({ pay: { 'home-pen': { combatPay: 1000, salvageSp: 100, basePaySp: 700, transportSp: 420, repDelta: -1 } } }), [rowOk()]);
        expect(r.ok).toBeTrue(); if (!r.ok) return;
        expect(r.sp).toBe(1380); expect(r.repDelta).toBe(-1);
        expect(r.snapshot.warchestLedger!.length).toBe(2); expect(r.snapshot.warchestLedger![1].cost).toBe(-1380);
        expect(r.snapshot.warchestSP).toBe(2380); expect(r.snapshot.reputation).toBe(1); expect(r.snapshot.warchestLedger![1].rep).toBe(1);
        const floor = applySlipToSnapshot({ ...home(), reputation: 0 } as never, slip({ pay: { 'home-pen': { combatPay: 0, salvageSp: 0, repDelta: -3 } } }), [rowOk()]);
        expect(floor.ok && floor.snapshot.reputation).toBe(0);
    });
    it('a dear transport on a poor track is a COST line, never clamped to 0', () => {
        const r = applySlipToSnapshot(home(), slip({ pay: { 'home-pen': { combatPay: 0, salvageSp: 0, basePaySp: 100, transportSp: 420 } } }), [rowOk()]);
        expect(r.ok).toBeTrue(); if (!r.ok) return;
        expect(r.sp).toBe(-320); expect(r.snapshot.warchestLedger![1].cost).toBe(320); expect(r.snapshot.warchestSP).toBe(680);
    });
    it('no repDelta on the slip → reputation untouched (P1/P2a slips byte-identical)', () => {
        const r = applySlipToSnapshot(home(), slip({ pay: { 'home-pen': { combatPay: 500, salvageSp: 0 } } }), [rowOk()]);
        expect(r.ok).toBeTrue(); if (!r.ok) return;
        expect(r.repDelta).toBe(0); expect(r.snapshot.reputation).toBe(2);
    });
});

describe('applySlipToSnapshot — P3: career SP lands on the home pilot by originPilotId', () => {
    it('a slip crediting hp-1 375 SP initializes the card and lands exactly that; a second slip adds; another home\'s id is ignored', () => {
        const r = applySlipToSnapshot(home(), slip({ pilotSp: { 'hp-1': 375, 'bp-9': 500 } }), [rowOk()]);
        expect(r.ok).toBeTrue(); if (!r.ok) return;
        expect(r.pilotSp).toBe(375);
        const p = r.snapshot.pilots!.find((x) => x.pilotId === 'hp-1')!;
        expect(p.campaignPilot?.careerSP).toBe(375); expect(p.campaignPilot?.type).toBe('BM');
        expect(r.snapshot.pilots!.find((x) => x.pilotId === 'hp-2')!.campaignPilot).toBeUndefined();
        const again = applySlipToSnapshot(r.snapshot, slip({ slipId: 'a1b2c3d4-0000-4000-8000-000000000002', pilotSp: { 'hp-1': 125 } }), [rowOk()]);
        expect(again.ok && again.snapshot.pilots!.find((x) => x.pilotId === 'hp-1')!.campaignPilot?.careerSP).toBe(500);
    });
    it('a KIA home pilot earns nothing; no pilotSp on the slip → cards untouched (P1/P2 slips byte-identical)', () => {
        const dead = home(); dead.pilots![0] = { ...dead.pilots![0], status: 'KIA' };
        const r = applySlipToSnapshot(dead, slip({ pilotSp: { 'hp-1': 375 } }), [rowOk()]);
        expect(r.ok && r.pilotSp).toBe(0);
        const plain = applySlipToSnapshot(home(), slip(), [rowOk()]);
        expect(plain.ok && plain.snapshot.pilots!.every((p) => !p.campaignPilot)).toBeTrue();
    });
});

describe('applySlipToSnapshot — P1 (S27) the completion-only entry, and applyVoidToSnapshot (hook 5)', () => {
    it('a slip with NO rows of mine but a pay entry under my home key (the hint) applies as pay + rep alone: one line, the +1, the idempotency key', () => {
        const s = slip({ pay: { 'home-pen': { combatPay: 0, salvageSp: 0, basePaySp: 0, repDelta: 1 } } });
        const r = applySlipToSnapshot(home(), s, [], 'home-pen');
        expect(r.ok).toBeTrue(); if (!r.ok) return;
        expect(r.matched).toEqual([]); expect(r.removed).toEqual([]);
        expect(r.snapshot.reputation).toBe(3); expect(r.repDelta).toBe(1); expect(r.sp).toBe(0);
        expect(r.snapshot.warchestLedger!.length).toBe(2); expect(r.snapshot.appliedSlips).toEqual([s.slipId as string]);
        expect(r.snapshot.startingForce).toEqual(home().startingForce); // nothing of the force touched
    });
    it('no rows AND no entry under the hint → the no-rows refusal (byte-identical P1)', () => {
        expect(applySlipToSnapshot(home(), slip(), [], 'home-pen')).toEqual({ ok: false, reason: 'no-rows' });
        expect(applySlipToSnapshot(home(), slip(), [])).toEqual({ ok: false, reason: 'no-rows' });
    });
    it('applyVoidToSnapshot returns the settled rep once (idempotent by voidId), no ledger line, no SP moved', () => {
        const v = { voidId: 'void-pc-1-1', contractId: 'pc-1', repRefund: 1, at: 1 };
        const r = applyVoidToSnapshot(home(), v);
        expect(r.ok).toBeTrue(); if (!r.ok) return;
        expect(r.snapshot.reputation).toBe(3); expect(r.repRefund).toBe(1); expect(r.reputation).toBe(3);
        expect(r.snapshot.warchestSP).toBe(1000); expect(r.snapshot.warchestLedger!.length).toBe(1);
        expect(r.snapshot.appliedSlips).toEqual(['void-pc-1-1']);
        expect(applyVoidToSnapshot(r.snapshot, v)).toEqual({ ok: false, reason: 'already-applied' });
    });
    it('a void with nothing to return still records its voidId (never re-tried) and leaves the reputation untouched', () => {
        const r = applyVoidToSnapshot(home(), { voidId: 'void-0', repRefund: 0 });
        expect(r.ok).toBeTrue(); if (!r.ok) return;
        expect(r.snapshot.reputation).toBe(2); expect(r.snapshot.appliedSlips).toEqual(['void-0']);
    });
    it('a home that is not a Hot Spots campaign refuses the void', () => {
        expect(applyVoidToSnapshot({ ...home(), hotSpotCampaign: null } as never, { voidId: 'v', repRefund: 1 })).toEqual({ ok: false, reason: 'not-hotspots' });
    });
});

describe('applySlipToSnapshot — P1 damage comes home and is COUNTED', () => {
    it('a row carrying the tabletop chaosDamage lands it on the home unit (and triage rides), and the unit is counted damaged', () => {
        const r = applySlipToSnapshot(home(), slip(), [rowOk({ damage: null, crewHits: undefined, chaosDamage: 'structure', triage: 'Y' })]);
        expect(r.ok).toBeTrue(); if (!r.ok) return;
        const u = r.snapshot.startingForce!.find((x) => x.instanceId === 'h-1')!;
        expect(u.chaosDamage).toBe('structure'); expect(u.triage).toBe('Y');
        expect(r.damaged).toEqual(['h-1']);
    });
    it('a carried envelope with real damage counts as damaged; a crew-only envelope (no armor/internal/crits) does not', () => {
        const hurt = applySlipToSnapshot(home(), slip(), [rowOk({ damage: { locations: { CT: { armor: 4 } }, crits: [], heat: { current: 0, previous: 0 }, crew: [] } as never })]);
        expect(hurt.ok).toBeTrue(); if (!hurt.ok) return;
        expect(hurt.damaged).toEqual(['h-1']);
        const crewOnly = applySlipToSnapshot(home(), slip(), [rowOk()]); // the P1 fixture: crew hits only → the pilot is wounded, the MACHINE is not damaged
        expect(crewOnly.ok).toBeTrue(); if (!crewOnly.ok) return;
        expect(crewOnly.damaged).toEqual([]);
        expect(crewOnly.snapshot.startingForce!.find((x) => x.instanceId === 'h-1')!.chaosDamage).toBeUndefined();
    });
});
