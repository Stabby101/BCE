/*
 * DIRECTIVE-ODM-21 — the ODM singleton gate, pinned as a pure decision (the pack-gate / custom-hotspot-gate
 * pattern: no Nest, no DB, so every branch is provable in isolation). The AUTH-OFF case is spec'd
 * explicitly, matching its three siblings — dev/LAN must stay byte-unchanged.
 */
import { odmSingletonRefused, packRefused } from './pack-gate';

const odm = { packId: 'odm' };
const plain = { startingForce: [] };
// (authRequired, ownerId, isCreate, ownerHasOdm, forceNew, snapshot)
type Opt = Partial<{ auth: boolean; owner: string | null | undefined; create: boolean; has: boolean; force: boolean; snap: unknown }>;
/* `in` checks, not ?? — a nullish default would coalesce the very values under test (snap:null and
   owner:null are the interesting cases, and `null ?? odm` silently becomes odm). */
const R = (o: Opt = {}) => odmSingletonRefused(
    'auth' in o ? o.auth as boolean : true,
    'owner' in o ? o.owner as string | null : 'gm-1',
    'create' in o ? o.create as boolean : true,
    'has' in o ? o.has as boolean : true,
    'force' in o ? o.force as boolean : false,
    'snap' in o ? o.snap : odm,
);

describe('odmSingletonRefused (ODM-21 — enforcement, not detection)', () => {
    it('REFUSES a second ODM campaign for an owner who already has one', () => {
        expect(R()).toBe(true);
    });
    it('allows the FIRST ODM campaign (owner has none)', () => {
        expect(R({ has: false })).toBe(false);
    });

    // ── the blast radius: everything that is not an ODM CREATE under auth fails the condition ──
    it('never refuses an UPDATE — ODM or otherwise (the 588 live campaigns keep saving)', () => {
        expect(R({ create: false })).toBe(false);
        expect(R({ create: false, snap: plain })).toBe(false);
    });
    it('never refuses a NON-ODM create, even when the owner has an ODM campaign', () => {
        expect(R({ snap: plain })).toBe(false);
        expect(R({ snap: { packId: 'other-pack' } })).toBe(false);
        expect(R({ snap: null })).toBe(false);
    });

    // ── the auth-off case, spec'd explicitly like its three siblings ──
    it('AUTH OFF (dev/LAN): never refuses — every local campaign is null-owner and would collide', () => {
        expect(R({ auth: false })).toBe(false);
        expect(R({ auth: false, owner: null })).toBe(false);
        expect(R({ auth: false, has: true, create: true })).toBe(false);
    });

    // ── the deliberate hole, pinned so it is a decision and not a bug ──
    it('a NULL-OWNER account is deliberately UNGUARDED (matching all nulls would collide)', () => {
        expect(R({ owner: null })).toBe(false);
        expect(R({ owner: undefined as unknown as null })).toBe(false);
    });
    /* …AND WHY THAT HOLE CANNOT SWALLOW A LIVE ODM CAMPAIGN. The worry was that the one person this guard
       is built for might be a legacy unowned row, so the guard would never fire for him. It cannot happen,
       and the reason is HERE rather than in a comment: under auth, an ODM snapshot is refused outright
       unless the saver is an admin or pack-entitled — and BOTH read off req.user (role is `req.user?.role`,
       entitled is `!!req.user && grants.has(...)`). No user ⇒ no ODM write. And a request WITH a user gets
       `viewer().ownerId = user.id`, which upsert stamps on create through the API's single INSERT. So an
       ODM row on an authed host is owned BY CONSTRUCTION. If this spec ever goes red, the deduction behind
       the null-owner clause has rotted and ODM-21 needs re-deciding, not patching. */
    it('an ODM save with NO user is refused upstream — so an authed ODM row is always owned', () => {
        expect(packRefused(undefined, true, false, odm)).toBe(true); // no user ⇒ not entitled, not admin
        expect(packRefused(null, true, false, odm)).toBe(true);
        expect(packRefused('gm', true, true, odm)).toBe(false);      // entitled ⇒ a user existed ⇒ ownerId stamped
    });

    // ── the one exception ──
    it('forceNew is the ONLY exception, and it is forgeable BY DESIGN (a guard, not a boundary)', () => {
        expect(R({ force: true })).toBe(false);
        expect(R({ force: true, has: true })).toBe(false);
    });
});
