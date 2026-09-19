import { odmSingletonRefused, packRefused } from './pack-gate';

const odm = { packId: 'odm' };
const plain = { startingForce: [] };
// (authRequired, isCreate, anyOdmExists, forceNew, isOwner, snapshot)
type Opt = Partial<{ auth: boolean; create: boolean; any: boolean; force: boolean; owner: boolean; snap: unknown }>;
/* `in` checks, not ?? — a nullish default would coalesce the values under test (snap:null is interesting). */
const R = (o: Opt = {}) => odmSingletonRefused(
    'auth' in o ? o.auth as boolean : true,
    'create' in o ? o.create as boolean : true,
    'any' in o ? o.any as boolean : true,
    'force' in o ? o.force as boolean : false,
    'owner' in o ? o.owner as boolean : false,
    'snap' in o ? o.snap : odm,
);

describe('odmSingletonRefused (Brick 0 — ONE ODM in the world, keyed by PACK)', () => {
    it('REFUSES a second ODM create when one already exists — for ANYONE (THE KEY: not per-owner)', () => {
        // The mutation-kill: under the old owner-keyed logic a DIFFERENT account minted its own; the pack key refuses.
        expect(R()).toBe(true);                 // any exists, not the owner → refused
        expect(R({ owner: true })).toBe(true);  // even the owner cannot silently mint a second (only forceNew can)
    });
    it('allows the FIRST ODM create (none exists yet)', () => {
        expect(R({ any: false })).toBe(false);
        expect(R({ any: false, owner: true })).toBe(false);
    });

    // ── the blast radius: everything that is not an ODM CREATE under auth fails the condition ──
    it('never refuses an UPDATE — ODM or otherwise (the live campaigns keep saving)', () => {
        expect(R({ create: false })).toBe(false);
        expect(R({ create: false, snap: plain })).toBe(false);
    });
    it('never refuses a NON-ODM create, even when an ODM record exists', () => {
        expect(R({ snap: plain })).toBe(false);
        expect(R({ snap: { packId: 'other-pack' } })).toBe(false);
        expect(R({ snap: null })).toBe(false);
    });

    // ── the auth-off case, spec'd explicitly like its siblings ──
    it('AUTH OFF (dev/LAN): never refuses — single-tenant unchanged', () => {
        expect(R({ auth: false })).toBe(false);
        expect(R({ auth: false, any: true, create: true })).toBe(false);
    });

    it('forceNew is the OWNER\'s escape only — a co-GM (not owner) can never forceNew', () => {
        expect(R({ force: true, owner: true })).toBe(false);
        expect(R({ force: true, owner: false })).toBe(true);  // a co-GM's forceNew is refused
    });

    /* WHY an authed ODM row is always OWNED (so the pinned ownerId is real): under auth an ODM snapshot is
       refused outright unless the saver is admin or pack-entitled, and BOTH read off req.user; the request's
       viewer().ownerId = user.id, which upsert stamps on create. No user ⇒ no ODM write. */
    it('an ODM save with NO user is refused upstream — so an authed ODM row is always owned', () => {
        expect(packRefused(undefined, true, false, odm)).toBe(true);
        expect(packRefused(null, true, false, odm)).toBe(true);
        expect(packRefused('gm', true, true, odm)).toBe(false);
    });
});
