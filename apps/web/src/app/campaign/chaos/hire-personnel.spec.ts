import { mercHireCharge, canAffordHire, buildMercInstance, buildMercPilot, hiredWithYouRows } from './hire-personnel';
import type { HotSpotHireable } from './hotspots-catalog';

const merc = (over: Partial<HotSpotHireable> = {}): HotSpotHireable => ({
    name: 'Ace', role: 'Duelist', gunnery: 2, piloting: 3, edge: 2, chassis: 'Marauder', bv: 1400, spCost: 300, ...over,
});

describe('mercHireCharge (per-track vs one-time)', () => {
    it('charges spCost per track by default', () => {
        expect(mercHireCharge(merc(), [])).toBe(300);
        expect(mercHireCharge(merc(), ['Ace'])).toBe(300); // no oneTimeHire → the paid-set is irrelevant, re-charges each track
    });
    it('a one-time hire charges once, then is free for the contract', () => {
        const h = merc({ oneTimeHire: true });
        expect(mercHireCharge(h, [])).toBe(300);        // first hire → charged
        expect(mercHireCharge(h, ['Ace'])).toBe(0);     // already paid this contract → free re-field
    });
    it('floors a negative/garbage cost at 0', () => {
        expect(mercHireCharge(merc({ spCost: -50 }), [])).toBe(0);
    });
});

describe('canAffordHire (no debt)', () => {
    it('blocks an unaffordable hire, allows an affordable one, and a 0 charge always passes', () => {
        expect(canAffordHire(299, 300)).toBe(false);
        expect(canAffordHire(300, 300)).toBe(true);
        expect(canAffordHire(0, 0)).toBe(true);   // free one-time re-field
    });
});

describe('buildMercInstance / buildMercPilot (mint)', () => {
    it('mints a DEPLOYED merc unit from the hireable data', () => {
        const inst = buildMercInstance(merc());
        expect(inst.chassis).toBe('Marauder');
        expect(inst.bv).toBe(1400);
        expect(inst.condition).toBe('Deployed');
        expect(inst.unitType).toBe('mech');
        expect(inst.provenance?.origin).toBe('hired-merc');
        expect(inst.instanceId).toBeTruthy();
    });
    it('a catalog-resolved unit wins for bv/model/mulId', () => {
        const inst = buildMercInstance(merc(), { name: 'Marauder MAD-3R', chassis: 'Marauder', model: 'MAD-3R', id: 999, tons: 75, bv: 1363, type: 'BattleMech' });
        expect(inst.model).toBe('MAD-3R');
        expect(inst.bv).toBe(1363);
        expect(inst.mulId).toBe(999);
    });
    it('mints a NAMED pilot linked to the instance with Edge from the hireable', () => {
        const inst = buildMercInstance(merc());
        const p = buildMercPilot(merc(), inst.instanceId);
        expect(p.name).toBe('Ace');
        expect(p.gunnery).toBe(2);
        expect(p.piloting).toBe(3);
        expect(p.named).toBe(true);
        expect(p.assignedInstanceId).toBe(inst.instanceId);
        expect(p.campaignPilot?.edgeTokens).toBe(2);
        expect(p.status).toBe('Active');
    });
});

describe('hiredWithYouRows (FOLLOWUPS — results-only player render)', () => {
    const merc: HotSpotHireable = { name: 'Captain Vasquez', role: 'Ace lance leader', gunnery: 2, piloting: 3, edge: 2, chassis: 'Marauder', model: 'MAD-3R', spCost: 300, oneTimeHire: true };
    it('joins the hire record to its minted unit + pilot; carries NO cost / one-time / edge (offer data stays GM-side)', () => {
        const inst = buildMercInstance(merc);
        const pilot = buildMercPilot(merc, inst.instanceId);
        const rows = hiredWithYouRows([{ key: merc.name, name: merc.name, instanceId: inst.instanceId, pilotId: pilot.pilotId, charged: 300, oneTimeHire: true, branchId: null, role: merc.role }], [inst], [pilot]);
        expect(rows).toEqual([{ name: 'Captain Vasquez', role: 'Ace lance leader', chassis: 'Marauder', model: 'MAD-3R', gunnery: 2, piloting: 3 }]);
        expect(Object.keys(rows[0])).not.toContain('spCost');
        expect(Object.keys(rows[0])).not.toContain('oneTimeHire');
        expect(Object.keys(rows[0])).not.toContain('edge');
    });
    it('no hires → no rows (the spec key stays absent); a record whose unit/pilot are gone degrades to name/role + 0/0', () => {
        expect(hiredWithYouRows([], [], [])).toEqual([]);
        expect(hiredWithYouRows(null, undefined, null)).toEqual([]);
        expect(hiredWithYouRows([{ key: 'X', name: 'X', instanceId: 'gone', pilotId: 'gone', charged: 0, oneTimeHire: false, branchId: null }], [], [])).toEqual([{ name: 'X', role: '', gunnery: 0, piloting: 0 }]);
    });
});
