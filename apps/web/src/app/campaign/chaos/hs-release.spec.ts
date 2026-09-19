import { releaseFromForce } from './hs-release';
import type { ProtoInstance } from '../force/force-generator';
import type { Pilot } from '../barracks/pilot-generator';
import type { ForceStructure } from '../force/force-structure';

const unit = (id: string, over: Partial<ProtoInstance> = {}): ProtoInstance => ({ instanceId: id, unitRef: 'Atlas AS7-D', chassis: 'Atlas', model: 'AS7-D', mulId: 31, tons: 100, bv: 1897, condition: 'Active', ...over } as ProtoInstance);
const pilot = (id: string, assigned?: string): Pilot => ({ pilotId: id, name: `P ${id}`, gunnery: 4, piloting: 5, status: 'Active', assignedInstanceId: assigned } as Pilot);
const structure = (): ForceStructure => ({ lances: [{ id: 'L0', name: 'Command', ordinal: 0 }, { id: 'L1', name: 'Second', ordinal: 1 }] } as unknown as ForceStructure);

describe('releaseFromForce — PD3 P4 ', () => {
    it('releases a DEPLOYED unit too (any condition), frees its pilot (kept on the roster), leaves the rest untouched', () => {
        const force = [unit('a', { condition: 'Deployed', lanceId: 'L0', isCommander: true }), unit('b', { condition: 'Reserve', lanceId: 'L1', tons: 50 })];
        const r = releaseFromForce({ force, pilots: [pilot('p1', 'b'), pilot('p2', 'a')], structure: structure(), instanceId: 'b' });
        expect(r.ok).toBeTrue(); if (!r.ok) return;
        expect(r.force.map((u) => u.instanceId)).toEqual(['a']);
        expect(r.pilots!.length).toBe(2);
        expect(r.pilots!.find((p) => p.pilotId === 'p1')!.assignedInstanceId).toBeUndefined();
        expect(r.pilots!.find((p) => p.pilotId === 'p2')!.assignedInstanceId).toBe('a');
        expect(r.pilotFreed).toBe('p1'); expect(r.released.instanceId).toBe('b');
    });
    it('re-designates the commander when the released unit was the commander (heaviest tonnage wins)', () => {
        const force = [unit('a', { isCommander: true, tons: 100 }), unit('b', { tons: 75 }), unit('c', { tons: 50 })];
        const r = releaseFromForce({ force, pilots: [], structure: null, instanceId: 'a' });
        expect(r.ok).toBeTrue(); if (!r.ok) return;
        expect(r.force.find((u) => u.isCommander)!.instanceId).toBe('b');
    });
    it('prunes an emptied non-command lance; never the Command Lance; a still-occupied lance stays', () => {
        const force = [unit('a', { lanceId: 'L0' }), unit('b', { lanceId: 'L1' })];
        const r = releaseFromForce({ force, pilots: null, structure: structure(), instanceId: 'b' });
        expect(r.ok).toBeTrue(); if (!r.ok) return;
        expect(r.structure!.lances.map((l) => l.id)).toEqual(['L0']);
        const r2 = releaseFromForce({ force, pilots: null, structure: structure(), instanceId: 'a' });
        expect(r2.ok).toBeTrue(); if (!r2.ok) return;
        expect(r2.structure!.lances.map((l) => l.id)).toEqual(['L0', 'L1']);
    });
    it('an unknown instance is a typed refusal — nothing moves', () => { expect(releaseFromForce({ force: [unit('a')], pilots: [], structure: null, instanceId: 'zz' })).toEqual({ ok: false, reason: 'not-found' }); });
});
