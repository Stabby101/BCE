/*
 * DIRECTIVE-HARDEN-6 Part C — pins EVERY shipped HARDEN-5+5b authorization rule, now that the decisions are pure
 * (ws-authz.ts). isGmDecision, accessDecision (the P2/P3/DEPLOY-003 gate), and actionDecision (the per-message
 * gate, post-lazy-bind-removal). If a spec disagrees with the code it's a real regression or a spec error —
 * do NOT edit the code to match; the gateway's thin adapters must behave byte-identically to these deciders.
 */
import { isGmDecision, accessDecision, actionDecision, sideDecision, instanceSideOf, engagementWriteDecision, type AuthzUser, sidePrefDecision, sidePrefFactsOf } from './ws-authz';

const admin: AuthzUser = { id: 'admin1', role: 'admin', status: 'approved' };
const gm: AuthzUser = { id: 'gm1', role: 'gm', status: 'approved' };       // an ordinary approved GM
const banned: AuthzUser = { id: 'gm1', role: 'gm', status: 'banned' };
const pending: AuthzUser = { id: 'gm1', role: 'gm', status: 'pending' };

describe('isGmDecision', () => {
    it('an approved admin is a GM of any campaign (ownerId ignored)', () => {
        expect(isGmDecision({ user: admin, ownerId: null })).toBe(true);
        expect(isGmDecision({ user: admin, ownerId: 'someone-else' })).toBe(true);
    });
    it('an approved owner is a GM; a non-owner is not', () => {
        expect(isGmDecision({ user: gm, ownerId: 'gm1' })).toBe(true);
        expect(isGmDecision({ user: gm, ownerId: 'other' })).toBe(false);
        expect(isGmDecision({ user: gm, ownerId: null })).toBe(false); // null owner ≠ owner-match for a non-admin
    });
    it('a non-approved user (banned/pending) or null is never a GM', () => {
        expect(isGmDecision({ user: banned, ownerId: 'gm1' })).toBe(false);
        expect(isGmDecision({ user: pending, ownerId: 'gm1' })).toBe(false);
        expect(isGmDecision({ user: null, ownerId: 'gm1' })).toBe(false);
    });
});

describe('accessDecision — the campaign ACCESS gate (P2 / P3 / DEPLOY-003)', () => {
    const base = { authRequired: true, campaignId: 'cA', boundCampaignId: undefined, campaignExists: true };
    it('dev/LAN (authRequired=false) → always allow, no bind', () => {
        expect(accessDecision({ ...base, authRequired: false, user: null, ownerId: null })).toEqual({ deny: false });
    });
    it('a banned/unapproved GM is denied EVERY event (the live ban check)', () => {
        expect(accessDecision({ ...base, user: banned, ownerId: 'gm1' }).deny).toBe(true);
        expect(accessDecision({ ...base, user: pending, ownerId: 'gm1' }).deny).toBe(true);
    });
    it('an approved admin is allowed any campaign', () => {
        expect(accessDecision({ ...base, user: admin, ownerId: 'other' }).deny).toBe(false);
    });
    it('an approved GM is allowed its OWN campaign, denied one it does not own', () => {
        expect(accessDecision({ ...base, user: gm, ownerId: 'gm1' }).deny).toBe(false);
        expect(accessDecision({ ...base, user: gm, ownerId: 'other' }).deny).toBe(true);
        expect(accessDecision({ ...base, user: gm, ownerId: null }).deny).toBe(false); // null-owner legacy row isn't GM-scoped
    });
    it('an account-less player binds its FIRST existing campaign (bind intent returned) then is rejected on another', () => {
        // first join: no bound campaign yet, campaign exists → allow + bind
        expect(accessDecision({ ...base, user: null, ownerId: null, boundCampaignId: undefined })).toEqual({ deny: false, bindCampaignId: 'cA' });
        // already bound to cA → the same campaign allowed, a DIFFERENT one denied
        expect(accessDecision({ ...base, user: null, ownerId: null, boundCampaignId: 'cA' }).deny).toBe(false);
        expect(accessDecision({ ...base, campaignId: 'cB', user: null, ownerId: null, boundCampaignId: 'cA' }).deny).toBe(true);
    });
    it('an account-less player cannot bind to a PHANTOM (non-existent) campaign id', () => {
        expect(accessDecision({ ...base, user: null, ownerId: null, campaignExists: false }).deny).toBe(true);
    });
});

describe('actionDecision — the per-message ACTION gate (post-lazy-bind-removal)', () => {
    const auth = { authRequired: true };
    it('dev/LAN (authRequired=false) → allow every kind regardless of identity', () => {
        expect(actionDecision({ authRequired: false, isGm: false, kind: 'gm', boundToken: undefined, msgToken: 'x' })).toBe(true);
        expect(actionDecision({ authRequired: false, isGm: false, kind: 'token', boundToken: undefined, msgToken: 'other' })).toBe(true);
        expect(actionDecision({ authRequired: false, isGm: false, kind: 'participant', boundToken: undefined, msgToken: undefined })).toBe(true);
    });
    it('a verified GM may perform ANY kind', () => {
        expect(actionDecision({ ...auth, isGm: true, kind: 'gm', boundToken: undefined, msgToken: 'anyone' })).toBe(true);
        expect(actionDecision({ ...auth, isGm: true, kind: 'token', boundToken: undefined, msgToken: 'anyone' })).toBe(true);
        expect(actionDecision({ ...auth, isGm: true, kind: 'participant', boundToken: undefined, msgToken: undefined })).toBe(true);
    });
    it('gm-kind from a non-GM is DENIED (kick/reassign are GM-only)', () => {
        expect(actionDecision({ ...auth, isGm: false, kind: 'gm', boundToken: 'p1', msgToken: 'p1' })).toBe(false);
    });
    it('token-kind: allowed ONLY when a bound token MATCHES the message token', () => {
        expect(actionDecision({ ...auth, isGm: false, kind: 'token', boundToken: 'p1', msgToken: 'p1' })).toBe(true);   // own
        expect(actionDecision({ ...auth, isGm: false, kind: 'token', boundToken: 'p1', msgToken: 'p2' })).toBe(false);  // cross-token
    });
    it('token-kind from an UNBOUND socket is DENIED (the lazy-bind removal — no adoption of an arbitrary token)', () => {
        expect(actionDecision({ ...auth, isGm: false, kind: 'token', boundToken: undefined, msgToken: 'ghost' })).toBe(false);
    });
    it('participant-kind requires a bound identity (any bound token), regardless of msgToken', () => {
        expect(actionDecision({ ...auth, isGm: false, kind: 'participant', boundToken: 'p1', msgToken: undefined })).toBe(true);
        expect(actionDecision({ ...auth, isGm: false, kind: 'participant', boundToken: undefined, msgToken: undefined })).toBe(false);
    });
});

describe('actionDecision — unit kind (GM-1 P3: per-unit battle ownership, the HARDEN-7 close)', () => {
    const auth = { authRequired: true, msgToken: undefined as unknown };
    it('dev/LAN (authRequired=false) allows regardless of claim state — the SACRED short-circuit untouched', () => {
        expect(actionDecision({ authRequired: false, isGm: false, kind: 'unit', boundToken: undefined, msgToken: undefined, instanceHolderToken: null })).toBe(true);
        expect(actionDecision({ authRequired: false, isGm: false, kind: 'unit', boundToken: 'p1', msgToken: undefined, instanceHolderToken: 'p2' })).toBe(true);
    });
    it('a verified GM writes ANY sheet — unclaimed and other-held alike (the GM edits OpFor from the same path)', () => {
        expect(actionDecision({ ...auth, isGm: true, kind: 'unit', boundToken: undefined, instanceHolderToken: null })).toBe(true);
        expect(actionDecision({ ...auth, isGm: true, kind: 'unit', boundToken: undefined, instanceHolderToken: 'p2' })).toBe(true);
    });
    it('the claim-row HOLDER writes its own sheet', () => {
        expect(actionDecision({ ...auth, isGm: false, kind: 'unit', boundToken: 'p1', instanceHolderToken: 'p1' })).toBe(true);
    });
    it("a bound participant may NOT write another holder's sheet (your opponent cannot edit your record)", () => {
        expect(actionDecision({ ...auth, isGm: false, kind: 'unit', boundToken: 'p1', instanceHolderToken: 'p2' })).toBe(false);
    });
    it('an UNCLAIMED instance is denied for non-GM (deny-unclaimed — the R5 ruling)', () => {
        expect(actionDecision({ ...auth, isGm: false, kind: 'unit', boundToken: 'p1', instanceHolderToken: null })).toBe(false);
    });
    it('an unbound socket is denied even against its "own" claim, and an empty-token row denies (the DECISION)', () => {
        expect(actionDecision({ ...auth, isGm: false, kind: 'unit', boundToken: undefined, instanceHolderToken: 'p1' })).toBe(false);
        expect(actionDecision({ ...auth, isGm: false, kind: 'unit', boundToken: 'p1', instanceHolderToken: '' })).toBe(false);
    });
});

describe('sideDecision — ORDER-2 H15: the side is a SERVER rule at claim (SMOKE-ODM-4P S43)', () => {
    const auth = { authRequired: true, isGm: false };
    it('dev/LAN (authRequired=false) allows a cross-side claim — the HARDEN-5 short-circuit, untouched', () => {
        expect(sideDecision({ authRequired: false, isGm: false, rowSide: 'BLUFOR', instanceSide: 'OPFOR' })).toBe(true);
        expect(sideDecision({ authRequired: false, isGm: false, rowSide: null, instanceSide: null })).toBe(true);
    });
    it("a verified GM claims across sides (reassign is the GM's tool; the GM is exempt)", () => {
        expect(sideDecision({ authRequired: true, isGm: true, rowSide: 'BLUFOR', instanceSide: 'OPFOR' })).toBe(true);
        expect(sideDecision({ authRequired: true, isGm: true, rowSide: null, instanceSide: 'OPFOR' })).toBe(true);
    });
    it('a BLUFOR row claiming an OPFOR instance is DENIED, and the mirror', () => {
        expect(sideDecision({ ...auth, rowSide: 'BLUFOR', instanceSide: 'OPFOR' })).toBe(false);
        expect(sideDecision({ ...auth, rowSide: 'OPFOR', instanceSide: 'BLUFOR' })).toBe(false);
    });
    it('a same-side claim lands on both sides', () => {
        expect(sideDecision({ ...auth, rowSide: 'BLUFOR', instanceSide: 'BLUFOR' })).toBe(true);
        expect(sideDecision({ ...auth, rowSide: 'OPFOR', instanceSide: 'OPFOR' })).toBe(true);
    });
    it('no side known on either end → no rule (an unplaced instance, a row-less or off-wire side is never invented)', () => {
        expect(sideDecision({ ...auth, rowSide: 'BLUFOR', instanceSide: null })).toBe(true);
        expect(sideDecision({ ...auth, rowSide: null, instanceSide: 'OPFOR' })).toBe(true);
        expect(sideDecision({ ...auth, rowSide: undefined, instanceSide: 'OPFOR' })).toBe(true);
        expect(sideDecision({ ...auth, rowSide: 'a', instanceSide: 'OPFOR' })).toBe(true); // GM-1 P4 labels never ride the wire; an off-wire string is unknown
    });
});

describe("instanceSideOf — the instance's side read off the opaque snapshot", () => {
    const snap = { startingForce: [{ instanceId: 'c1', condition: 'Deployed' }, { instanceId: 'c2', condition: 'Reserve' }], missionSpec: { opforForce: [{ instanceId: 'o1' }] } };
    it('a company hull is BLUFOR (any condition), an OpFor hull is OPFOR', () => {
        expect(instanceSideOf(snap, 'c1')).toBe('BLUFOR');
        expect(instanceSideOf(snap, 'c2')).toBe('BLUFOR');
        expect(instanceSideOf(snap, 'o1')).toBe('OPFOR');
    });
    it("a unit SEEDED to side B from a player's company (GM-1 P4: copied into opforForce, the company copy left at Reserve) is OPFOR — the OpFor list wins, so the side-B player's own re-claim lands", () => {
        const seeded = { startingForce: [{ instanceId: 'p1', condition: 'Reserve', provenance: { origin: 'player-import', owner: 'anon-x' } }], missionSpec: { opforForce: [{ instanceId: 'p1', provenance: { origin: 'player-import', owner: 'anon-x' } }] } };
        expect(instanceSideOf(seeded, 'p1')).toBe('OPFOR');
        expect(sideDecision({ authRequired: true, isGm: false, rowSide: 'OPFOR', instanceSide: instanceSideOf(seeded, 'p1') })).toBe(true);
    });
    it('an instance the snapshot does not place is null — and so is a missing / null / malformed snapshot', () => {
        expect(instanceSideOf(snap, 'ghost')).toBeNull();
        expect(instanceSideOf(null, 'c1')).toBeNull();
        expect(instanceSideOf(undefined, 'c1')).toBeNull();
        expect(instanceSideOf({ startingForce: 'nope', missionSpec: null }, 'c1')).toBeNull();
        expect(instanceSideOf({ startingForce: [null, 'x', { instanceId: 'c9' }] }, 'c1')).toBeNull();
    });
});

describe('engagementWriteDecision — ORDER-4 H18: a battle write to a CLOSED engagement is refused for everyone (a game rule, not an auth rule)', () => {
    const holder = { kind: 'unit' as const, boundToken: 'p1', msgToken: undefined as unknown, instanceHolderToken: 'p1' };
    it('CLOSED → refused in the dev/LAN posture (the authRequired short-circuit does NOT bypass the close)', () => {
        expect(engagementWriteDecision({ ...holder, authRequired: false, isGm: false, closed: true })).toBe(false);
    });
    it('CLOSED → refused for a verified GM (the GM ended it; a re-open is a re-generate = a new key)', () => {
        expect(engagementWriteDecision({ ...holder, authRequired: true, isGm: true, closed: true })).toBe(false);
    });
    it('CLOSED → refused for the claim-row holder (the claim row itself is untouched — only writes stop)', () => {
        expect(engagementWriteDecision({ ...holder, authRequired: true, isGm: false, closed: true })).toBe(false);
    });
    it('OPEN → delegates to the HARDEN-7 per-unit rule unchanged (holder writes, another bound participant does not, dev/LAN permissive)', () => {
        expect(engagementWriteDecision({ ...holder, authRequired: true, isGm: false, closed: false })).toBe(true);
        expect(engagementWriteDecision({ ...holder, instanceHolderToken: 'p2', authRequired: true, isGm: false, closed: false })).toBe(false);
        expect(engagementWriteDecision({ ...holder, instanceHolderToken: null, authRequired: false, isGm: false, closed: false })).toBe(true);
    });
});

describe('sidePrefDecision — DIRECTIVE-PD3 P2 (PD3-9): a side preference is a LOBBY thing (server-side, lockstep with sessionPhase)', () => {
    it('allowed in the lobby: a live contract with nothing generated', () => { expect(sidePrefDecision({ hasContract: true, hasGeneratedTrack: false, completed: false })).toBe(true); });
    it('allowed with nothing presented at all (none)', () => { expect(sidePrefDecision({ hasContract: false, hasGeneratedTrack: false, completed: false })).toBe(true); });
    it('REFUSED once a track is generated (committed) — the side is a fact', () => { expect(sidePrefDecision({ hasContract: true, hasGeneratedTrack: true, completed: false })).toBe(false); });
    it('REFUSED once the contract is complete (no live contract, a terminal record)', () => { expect(sidePrefDecision({ hasContract: false, hasGeneratedTrack: false, completed: true })).toBe(false); });
    it('a stale RESOLVED tree with no live contract and no terminal record is still allowed (none — a fresh session)', () => { expect(sidePrefDecision({ hasContract: false, hasGeneratedTrack: true, completed: false })).toBe(true); });
});
describe('sidePrefFactsOf — the three facts off the opaque snapshot (top-level, never gmOnly)', () => {
    it('reads the GM-session summary or the plain singular; a completed status counts as completed, not live', () => {
        expect(sidePrefFactsOf({ contractSummary: { status: 'active' }, missionTree: [{ state: 'AVAILABLE' }] })).toEqual({ hasContract: true, hasGeneratedTrack: false, completed: false });
        expect(sidePrefFactsOf({ activeChaosContract: { status: 'active' }, missionTree: [{ state: 'ACTIVE' }] })).toEqual({ hasContract: true, hasGeneratedTrack: true, completed: false });
        expect(sidePrefFactsOf({ activeChaosContract: { status: 'active' }, missionSpec: { x: 1 } })).toEqual({ hasContract: true, hasGeneratedTrack: true, completed: false });
        expect(sidePrefFactsOf({ completedChaosContract: { status: 'completed' } })).toEqual({ hasContract: false, hasGeneratedTrack: false, completed: true });
        expect(sidePrefFactsOf({ contractSummary: { status: 'completed' } })).toEqual({ hasContract: false, hasGeneratedTrack: false, completed: true });
        expect(sidePrefFactsOf(null)).toEqual({ hasContract: false, hasGeneratedTrack: false, completed: false });
    });
});
