import { hsDamaged, hsDamagedCount } from './hs-damage';
import type { ProtoInstance } from '../force/force-generator';

const unit = (over: Partial<ProtoInstance> = {}): ProtoInstance => ({ instanceId: 'u', unitRef: 'Atlas AS7-D', chassis: 'Atlas', model: 'AS7-D', mulId: 31, tons: 100, bv: 1897, condition: 'Active', ...over } as ProtoInstance);
const env = (locations: Record<string, { armor?: number; internal?: number }>, crits: unknown[] = [], destroyed = false) =>
    ({ locations, crits, heat: { current: 0, previous: 0 }, crew: [], destroyed } as unknown as ProtoInstance['damage']);

describe('hsDamaged — the one damage truth ', () => {
    it('a reconcile envelope with armor loss counts', () => { expect(hsDamaged(unit({ damage: env({ CT: { armor: 3 } }) }))).toBeTrue(); });
    it('an internal breach counts', () => { expect(hsDamaged(unit({ damage: env({ LT: { internal: 1 } }) }))).toBeTrue(); });
    it('a destroyed crit counts', () => { expect(hsDamaged(unit({ damage: env({}, [{ location: 'RA', slot: 1, destroyed: 1 }]) }))).toBeTrue(); });
    it('the destroyed flag alone counts (no locations touched)', () => { expect(hsDamaged(unit({ damage: env({}, [], true) }))).toBeTrue(); });
    it('a tabletop level counts with NO envelope at all', () => { expect(hsDamaged(unit({ chaosDamage: 'armor' }))).toBeTrue(); });
    it('a pristine unit does not', () => { expect(hsDamaged(unit())).toBeFalse(); });
    it('an empty envelope (heat-only, the live-only mirror) does not', () => { expect(hsDamaged(unit({ damage: env({}) }))).toBeFalse(); });
    it("the Traditional 'In repair' condition ALONE is not HS damage (HS never sets it; the badge must not read it)", () => { expect(hsDamaged(unit({ condition: 'In repair' }))).toBeFalse(); });
    it('null / undefined are false', () => { expect(hsDamaged(null)).toBeFalse(); expect(hsDamaged(undefined)).toBeFalse(); });
});

describe('hsDamagedCount — the badge', () => {
    it('counts each damaged unit once, whatever the source', () => {
        const force = [unit({ instanceId: 'a', damage: env({ CT: { armor: 1 } }) }), unit({ instanceId: 'b', chaosDamage: 'structure' }), unit({ instanceId: 'c' }), unit({ instanceId: 'd', damage: env({ CT: { armor: 1 } }), chaosDamage: 'armor' })];
        expect(hsDamagedCount(force)).toBe(3);
        expect(hsDamagedCount([])).toBe(0);
        expect(hsDamagedCount(null)).toBe(0);
    });
});
