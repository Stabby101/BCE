import { unendedPickUnits } from './pending-phase';

describe('unendedPickUnits — P5 (count what you HOLD, not what you can see)', () => {
    const fu = (name: string, dirty: boolean) => ({ name, dirty });
    const dirty = (f: { dirty: boolean }) => f.dirty;
    const entry = (instanceId: string, f: { name: string; dirty: boolean } | null, status = 'ok') => ({ instanceId, status, fu: f });

    it('THE DEFECT: a VIEWER that holds nothing owes no END PHASE, however dirty its teammates\' units read', () => {
        const entries = [entry('mate-1', fu('Atlas', true)), entry('mate-2', fu('Locust', true))];
        expect(unendedPickUnits(entries, () => false, dirty)).toEqual([]);
    });
    it('a device owes END PHASE on its OWN dirty unit — and only on it', () => {
        const mine = fu('Ostscout', true);
        const entries = [entry('mine-1', mine), entry('mate-1', fu('Atlas', true)), entry('mine-2', fu('Stinger', false))];
        expect(unendedPickUnits(entries, (id) => id.startsWith('mine'), dirty)).toEqual([mine]);
    });
    it('a held unit that is not loaded (pending / broken / no sheet) is never counted', () => {
        const entries = [entry('mine-1', fu('Ostscout', true), 'pending'), entry('mine-2', null), entry('mine-3', fu('Rifleman', true), 'error')];
        expect(unendedPickUnits(entries, () => true, dirty)).toEqual([]);
    });
    it('the dirty probe runs ONLY for held, loaded units (it reads the unit\'s phase signal — never touch a teammate\'s)', () => {
        const probed: string[] = [];
        const entries = [entry('mate-1', fu('Atlas', true)), entry('mine-1', fu('Ostscout', false)), entry('mine-2', fu('Stinger', true), 'pending')];
        unendedPickUnits(entries, (id) => id.startsWith('mine'), (f) => { probed.push(f.name); return f.dirty; });
        expect(probed).toEqual(['Ostscout']);
    });
    it('order is the roster\'s; the input is never mutated', () => {
        const a = fu('A', true), b = fu('B', true);
        const entries = [entry('mine-b', b), entry('mine-a', a)];
        expect(unendedPickUnits(entries, () => true, dirty)).toEqual([b, a]);
        expect(entries.length).toBe(2);
    });
});
