/*
 * GM-3 P0 — pins the TELL-THE-TABLE decision: a gmSession snapshot whose date differs from the device's acknowledged
 * date produces the notice; a plain campaign never does; the first sight is a silent ack; the same date is silence.
 */
import { dateKey, sessionClockNotice, sessionClockPlayerText, sessionClockGmText } from './session-clock-notice';

const d = (y: number, m: number, dd: number) => ({ y, m, d: dd });

describe('sessionClockNotice (GM-3 P0 — tell the table)', () => {
    it('a PLAIN campaign fans nothing new: no notice and no ack, whatever the date or the seen key', () => {
        expect(sessionClockNotice({ gmSession: false, currentDate: d(3151, 4, 1) }, null)).toEqual({ notice: null, ack: null });
        expect(sessionClockNotice({ currentDate: d(3151, 4, 1) }, '3151-3-1')).toEqual({ notice: null, ack: null });
        expect(sessionClockNotice(null, '3151-3-1')).toEqual({ notice: null, ack: null });
    });
    it('the FIRST sight of a gmSession date is acknowledged silently (a device joining after an advance was not at the table)', () => {
        expect(sessionClockNotice({ gmSession: true, currentDate: d(3151, 4, 1) }, null)).toEqual({ notice: null, ack: '3151-4-1' });
    });
    it('the SAME date as acknowledged is silence', () => {
        expect(sessionClockNotice({ gmSession: true, currentDate: d(3151, 4, 1) }, '3151-4-1')).toEqual({ notice: null, ack: null });
    });
    it('a DIFFERENT date than acknowledged is the notice, in the player\'s words, and no silent ack (it stands until dismissed)', () => {
        const r = sessionClockNotice({ gmSession: true, currentDate: d(3151, 4, 1) }, '3151-3-1');
        expect(r.ack).toBeNull();
        expect(r.notice).toEqual({ key: '3151-4-1', date: '01 MAY 3151', text: 'Session date → 01 MAY 3151. Your base pay lands with each track\'s results slip.' });
    });
    it('a missing or malformed date never notifies and never acks', () => {
        expect(sessionClockNotice({ gmSession: true, currentDate: null }, '3151-3-1')).toEqual({ notice: null, ack: null });
        expect(sessionClockNotice({ gmSession: true, currentDate: { y: 3151 } as never }, null)).toEqual({ notice: null, ack: null });
        expect(dateKey(undefined)).toBeNull();
    });
    it('the two voices name the same fact: the date and the base-pay rule (S22)', () => {
        expect(sessionClockPlayerText('01 MAY 3151')).toContain('Session date → 01 MAY 3151');
        expect(sessionClockGmText('01 MAY 3151')).toContain('Session date → 01 MAY 3151');
        expect(sessionClockGmText('01 MAY 3151')).toMatch(/base pay lands with each track's results slip/);
    });
});
