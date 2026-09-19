import { isGmDecision, accessDecision, actionDecision, sideDecision, instanceSideOf, engagementWriteDecision, type AuthzUser, sidePrefDecision, sidePrefFactsOf, handTableDecision, seatDecision } from './ws-authz';
import { odmIntentSeats, pilotSeatOf, ODM_SEAT_VERBS, SEAT_KEY, activeEngagementKeyOf, odmClaimDecision, companyUnitIdsOf, seatAssignDecision, seatActorOf, seatLabelOf } from './odm-seats';

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
    it('a co-GM (coGmRead) is ALLOWED into a campaign it does not own — for READ', () => {
        expect(accessDecision({ ...base, user: gm, ownerId: 'other', coGmRead: true }).deny).toBe(false);
    });
    it('without coGmRead an approved GM is still denied a campaign it does not own (the widening is opt-in per-record)', () => {
        expect(accessDecision({ ...base, user: gm, ownerId: 'other', coGmRead: false }).deny).toBe(true);
        expect(accessDecision({ ...base, user: gm, ownerId: 'other' }).deny).toBe(true); // omitted ⇒ undefined ⇒ denied (default-closed)
    });
    it('coGmRead never rescues a banned/unapproved account (status is checked first)', () => {
        expect(accessDecision({ ...base, user: banned, ownerId: 'other', coGmRead: true }).deny).toBe(true);
        expect(accessDecision({ ...base, user: pending, ownerId: 'other', coGmRead: true }).deny).toBe(true);
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

describe('actionDecision — unit kind (P3: per-unit battle ownership, the close)', () => {
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

describe('sideDecision — ORDER-2 H15: the side is a SERVER rule at claim (SMOKE-S43)', () => {
    const auth = { authRequired: true, isGm: false };
    it('dev/LAN (authRequired=false) allows a cross-side claim — the short-circuit, untouched', () => {
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
        expect(sideDecision({ ...auth, rowSide: 'a', instanceSide: 'OPFOR' })).toBe(true);
    });
});

describe("instanceSideOf — the instance's side read off the opaque snapshot", () => {
    const snap = { startingForce: [{ instanceId: 'c1', condition: 'Deployed' }, { instanceId: 'c2', condition: 'Reserve' }], missionSpec: { opforForce: [{ instanceId: 'o1' }] } };
    it('a company hull is BLUFOR (any condition), an OpFor hull is OPFOR', () => {
        expect(instanceSideOf(snap, 'c1')).toBe('BLUFOR');
        expect(instanceSideOf(snap, 'c2')).toBe('BLUFOR');
        expect(instanceSideOf(snap, 'o1')).toBe('OPFOR');
    });
    it("a unit SEEDED to side B from a player's company (P4: copied into opforForce, the company copy left at Reserve) is OPFOR — the OpFor list wins, so the side-B player's own re-claim lands", () => {
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
    it('OPEN → delegates to the per-unit rule unchanged (holder writes, another bound participant does not, dev/LAN permissive)', () => {
        expect(engagementWriteDecision({ ...holder, authRequired: true, isGm: false, closed: false })).toBe(true);
        expect(engagementWriteDecision({ ...holder, instanceHolderToken: 'p2', authRequired: true, isGm: false, closed: false })).toBe(false);
        expect(engagementWriteDecision({ ...holder, instanceHolderToken: null, authRequired: false, isGm: false, closed: false })).toBe(true);
    });
});

describe('sidePrefDecision — P2 a side preference is a LOBBY thing (server-side, lockstep with sessionPhase)', () => {
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

describe('handTableDecision — L1 → P5 (PER DEVICE: the target is a connected GM-app DEVICE; the owner takes/hands, the holder moves)', () => {
    // the per-device cases (take · move · hand · deny · admin) are pinned in campaigns/writer-token-device.spec.ts beside the baton;
    // this block keeps the L1 laws in their new shape: an unconnected target, a stranger, an empty target, an unowned record.
    const readers = [{ userId: 'owner-1', deviceId: 'dev-tablet' }, { userId: 'cogm-1', deviceId: 'dev-c1' }, { userId: 'cogm-2', deviceId: 'dev-c2' }];
    it('the owner TAKES the table to its own connected device and HANDS it to a connected co-GM device', () => {
        expect(handTableDecision({ toUserId: 'owner-1', toDeviceId: 'dev-tablet', callerId: 'owner-1', ownerId: 'owner-1', holder: { userId: 'cogm-1', deviceId: 'dev-c1' }, readers })).toBe('take');
        expect(handTableDecision({ toUserId: 'cogm-2', toDeviceId: 'dev-c2', callerId: 'owner-1', ownerId: 'owner-1', holder: { userId: 'owner-1', deviceId: 'dev-desk' }, readers })).toBe('hand');
    });
    it('anyone NOT at the table is DENIED — a stranger, a mistyped id, a co-GM who has left, a device that is not connected', () => {
        expect(handTableDecision({ toUserId: 'stranger-9', toDeviceId: 'dev-s', callerId: 'owner-1', ownerId: 'owner-1', holder: null, readers })).toBe('deny');
        expect(handTableDecision({ toUserId: 'cogm-1 ', toDeviceId: 'dev-c1', callerId: 'owner-1', ownerId: 'owner-1', holder: null, readers })).toBe('deny');
        expect(handTableDecision({ toUserId: 'cogm-1', toDeviceId: 'dev-c1', callerId: 'owner-1', ownerId: 'owner-1', holder: null, readers: [] })).toBe('deny');
        expect(handTableDecision({ toUserId: 'cogm-1', toDeviceId: 'dev-c1-other', callerId: 'owner-1', ownerId: 'owner-1', holder: null, readers })).toBe('deny');
    });
    it('an empty target is denied; an UNOWNED record has nobody who may hand (dev/LAN: no accounts, callerIsGm decides)', () => {
        expect(handTableDecision({ toUserId: '', toDeviceId: 'dev-c1', callerId: 'owner-1', ownerId: 'owner-1', holder: null, readers })).toBe('deny');
        expect(handTableDecision({ toUserId: null, toDeviceId: 'dev-c1', callerId: 'owner-1', ownerId: 'owner-1', holder: null, readers })).toBe('deny');
        expect(handTableDecision({ toUserId: 'cogm-1', toDeviceId: 'dev-c1', callerId: 'anyone', ownerId: null, holder: null, readers })).toBe('deny');
        expect(handTableDecision({ toUserId: 'cogm-1', toDeviceId: 'dev-c1', callerId: 'anyone', ownerId: null, holder: null, readers, callerIsGm: true })).toBe('hand');
    });
});

describe('seatDecision — P1 EDITABLE-OWN (the seat is the unit; the claim rows are the seat→token map)', () => {
    const holders = { 'unit-A': 'tok-alpha', 'unit-B': 'tok-bravo' };
    const base = { authRequired: true, isGm: false, holders };
    it('OWN seat → allowed', () => {
        expect(seatDecision({ ...base, callerToken: 'tok-alpha', targetSeats: ['unit-A'] })).toEqual({ allow: true });
    });
    it('ANOTHER player\'s seat → DENIED "not your seat"', () => {
        expect(seatDecision({ ...base, callerToken: 'tok-alpha', targetSeats: ['unit-B'] })).toEqual({ allow: false, reason: 'not your seat' });
    });
    it('an UNCLAIMED seat → GM only (a player is denied even though nobody else holds it)', () => {
        expect(seatDecision({ ...base, callerToken: 'tok-alpha', targetSeats: ['unit-Z'] })).toEqual({ allow: false, reason: 'unclaimed seat — GM only' });
    });
    it('EVERY named seat must be the caller\'s — a crew move that pulls a pilot out of another\'s seat is denied', () => {
        expect(seatDecision({ ...base, callerToken: 'tok-alpha', targetSeats: ['unit-A', 'unit-B'] })).toEqual({ allow: false, reason: 'not your seat' });
        expect(seatDecision({ ...base, callerToken: 'tok-alpha', targetSeats: ['unit-A', 'unit-A'] })).toEqual({ allow: true });
    });
    it('the GM (owner/admin, or the baton holder) is UNRESTRICTED — any seat, an unclaimed seat, no token at all', () => {
        expect(seatDecision({ ...base, isGm: true, callerToken: undefined, targetSeats: ['unit-B'] })).toEqual({ allow: true });
        expect(seatDecision({ ...base, isGm: true, callerToken: undefined, targetSeats: ['unit-Z'] })).toEqual({ allow: true });
        expect(seatDecision({ ...base, isGm: true, callerToken: undefined, targetSeats: [] })).toEqual({ allow: true });
    });
    it('dev/LAN (auth OFF) is permissive — the posture, whoever asks for whatever', () => {
        expect(seatDecision({ authRequired: false, isGm: false, callerToken: undefined, targetSeats: ['unit-B'], holders })).toEqual({ allow: true });
    });
    it('a COMPANY verb (no seat) needs a caller who holds SOME seat — "no claimed seat = read-only"', () => {
        expect(seatDecision({ ...base, callerToken: 'tok-alpha', targetSeats: [] })).toEqual({ allow: true });
        expect(seatDecision({ ...base, callerToken: 'tok-nobody', targetSeats: [] })).toEqual({ allow: false, reason: 'no claimed seat — the company is read-only' });
    });
    it('no bound identity is denied before anything else; a holders key named like an Object member never matches', () => {
        expect(seatDecision({ ...base, callerToken: undefined, targetSeats: ['unit-A'] })).toEqual({ allow: false, reason: 'no bound identity' });
        expect(seatDecision({ ...base, callerToken: 'tok-alpha', targetSeats: ['constructor'] })).toEqual({ allow: false, reason: 'unclaimed seat — GM only' });
    });
});

describe('odmIntentSeats — P1 (what an intent is ABOUT; the pilot rides the seat)', () => {
    const snap = { pilots: [{ pilotId: 'p-spare' }, { pilotId: 'p-inB', assignedInstanceId: 'unit-B' }, { pilotId: 'p-inA', assignedInstanceId: 'unit-A' }] };
    it('the seat verbs are pinned — growth is a deliberate act', () => {
        expect([...ODM_SEAT_VERBS]).toEqual(['reassign-pilot', 'set-deploy', 'bay-assign', 'rename-pilot', 'seat-note', 'seat-request']);
    });
    it('a seat verb names ITS seat', () => {
        for (const verb of ['set-deploy', 'bay-assign', 'rename-pilot', 'seat-note', 'seat-request']) expect(odmIntentSeats(verb, { instanceId: 'unit-A' }, snap)).toEqual(['unit-A']);
    });
    it('reassign-pilot touches the seat it names AND the seat the pilot is leaving (resolved from the PRE-move snapshot)', () => {
        expect(odmIntentSeats('reassign-pilot', { instanceId: 'unit-A', pilotId: 'p-inB' }, snap)).toEqual(['unit-A', 'unit-B']);
        expect(odmIntentSeats('reassign-pilot', { instanceId: 'unit-A', pilotId: 'p-spare' }, snap)).toEqual(['unit-A']);   // a spare leaves no seat
        expect(odmIntentSeats('reassign-pilot', { instanceId: 'unit-A', pilotId: 'p-inA' }, snap)).toEqual(['unit-A']);     // already there
        expect(odmIntentSeats('reassign-pilot', { instanceId: 'unit-A', pilotId: '' }, snap)).toEqual(['unit-A']);          // stand the crew down
    });
    it('COMPANY verbs carry no seat — the bays by id, the bench, the two-key donor-strip REQUEST', () => {
        for (const verb of ['bay-unassign', 'bay-priority', 'bay-type', 'bench-assess', 'bench-inspect', 'bench-repair', 'bench-ammo-clear', 'donor-strip-request']) expect(odmIntentSeats(verb, { instanceId: 'unit-A', bayId: 'b1' }, snap)).toEqual([]);
    });
    it('a malformed blob / payload yields no EXTRA seat and never throws', () => {
        expect(odmIntentSeats('reassign-pilot', { instanceId: 'unit-A', pilotId: 'p-inB' }, null)).toEqual(['unit-A']);
        expect(odmIntentSeats('reassign-pilot', { instanceId: 'unit-A', pilotId: 'p-inB' }, { pilots: 'nope' })).toEqual(['unit-A']);
        expect(odmIntentSeats('set-deploy', {}, snap)).toEqual([]);
        expect(odmIntentSeats('set-deploy', null, snap)).toEqual([]);
        expect(pilotSeatOf({ pilots: [null, 7, { pilotId: 'x', assignedInstanceId: 12 }] }, 'x')).toBeNull();
    });
});

describe('odmClaimDecision — P5 (THE CLAIM DOOR: the cross-engagement seat map is only as strong as the door its rows come through)', () => {
    it('ODM: a non-GM claim lands ONLY under the LIVE engagement key', () => {
        expect(odmClaimDecision({ isOdm: true, engagementKey: 'PALE_CANDLE', activeKey: 'PALE_CANDLE' })).toEqual({ allow: true });
    });
    it('ODM: a made-up key, a PAST engagement\'s key, a missing key — all refused while another engagement is live (the seat-steal)', () => {
        for (const engagementKey of ['zz-forged-key', 'LAST_MISSION', 'none', '', undefined, null]) {
            expect(odmClaimDecision({ isOdm: true, engagementKey, activeKey: 'PALE_CANDLE' })).toEqual({ allow: false, reason: 'not the live engagement' });
        }
    });
    it('ODM: with NO active engagement nothing is claimable by a player — between missions seats move only by the GM\'s hand', () => {
        for (const engagementKey of ['none', 'PALE_CANDLE', 'zz']) expect(odmClaimDecision({ isOdm: true, engagementKey, activeKey: null })).toEqual({ allow: false, reason: 'no active engagement' });
    });
    it('the GM\'s RESERVED seat key is refused to a player in EVERY mode — even when it is somehow "the live key"', () => {
        expect(odmClaimDecision({ isOdm: true, engagementKey: SEAT_KEY, activeKey: SEAT_KEY })).toEqual({ allow: false, reason: 'reserved key' });
        expect(odmClaimDecision({ isOdm: false, engagementKey: SEAT_KEY, activeKey: null })).toEqual({ allow: false, reason: 'reserved key' });
    });
    it('OTHER modes have no seats: their claim door is unchanged (any key, frozen or live)', () => {
        for (const engagementKey of ['eng-1', 'none', '', undefined]) expect(odmClaimDecision({ isOdm: false, engagementKey, activeKey: null })).toEqual({ allow: true });
    });
    // ORDER-12 (2026-09-18) — the door reads the SEAT MAP too: a joined player claiming a unit ANOTHER player holds the seat of is
    // refused under the live key as well (the per-key guard cannot see a seat given under the reserved key or an older engagement).
    it('ORDER-12: under the LIVE key a unit whose SEAT another player holds is NOT claimable — "another player holds that seat"', () => {
        expect(odmClaimDecision({ isOdm: true, engagementKey: 'PALE_CANDLE', activeKey: 'PALE_CANDLE', seatHolderToken: 'tok-bravo', callerToken: 'tok-alpha' })).toEqual({ allow: false, reason: 'another player holds that seat' });
    });
    it('ORDER-12: a player may claim a FREE unit (the lobby pick) and its OWN seat (it carries into the live engagement)', () => {
        expect(odmClaimDecision({ isOdm: true, engagementKey: 'PALE_CANDLE', activeKey: 'PALE_CANDLE', seatHolderToken: null, callerToken: 'tok-alpha' })).toEqual({ allow: true });
        expect(odmClaimDecision({ isOdm: true, engagementKey: 'PALE_CANDLE', activeKey: 'PALE_CANDLE', seatHolderToken: '', callerToken: 'tok-alpha' })).toEqual({ allow: true });
        expect(odmClaimDecision({ isOdm: true, engagementKey: 'PALE_CANDLE', activeKey: 'PALE_CANDLE', seatHolderToken: 'tok-alpha', callerToken: 'tok-alpha' })).toEqual({ allow: true });
    });
    it('ORDER-12: the key checks come FIRST — a forged key on another\'s seat is refused for the key, not the seat; other modes ignore the seat map', () => {
        expect(odmClaimDecision({ isOdm: true, engagementKey: 'zz-forged', activeKey: 'PALE_CANDLE', seatHolderToken: 'tok-bravo', callerToken: 'tok-alpha' })).toEqual({ allow: false, reason: 'not the live engagement' });
        expect(odmClaimDecision({ isOdm: true, engagementKey: 'PALE_CANDLE', activeKey: null, seatHolderToken: 'tok-bravo', callerToken: 'tok-alpha' })).toEqual({ allow: false, reason: 'no active engagement' });
        expect(odmClaimDecision({ isOdm: false, engagementKey: 'eng-1', activeKey: null, seatHolderToken: 'tok-bravo', callerToken: 'tok-alpha' })).toEqual({ allow: true });
    });
});

describe('activeEngagementKeyOf / companyUnitIdsOf — P5 (narrow, defensive duck-reads)', () => {
    it('the LIVE key is the ACTIVE branch\'s id — LOCKSTEP with the client\'s engagementKeyOf ACTIVE rule', () => {
        expect(activeEngagementKeyOf({ missionTree: [{ branchId: 'A', state: 'RESOLVED' }, { branchId: 'B', state: 'ACTIVE' }, { branchId: 'C', state: 'LOCKED' }] })).toBe('B');
    });
    it('FROZEN (nothing ACTIVE) → null: the client\'s RESOLVED / \'none\' fallbacks name a record, not a claimable engagement', () => {
        expect(activeEngagementKeyOf({ missionTree: [{ branchId: 'A', state: 'RESOLVED' }] })).toBeNull();
        expect(activeEngagementKeyOf({ missionTree: [] })).toBeNull();
    });
    it('a malformed blob is frozen and fields nothing — never throws', () => {
        for (const s of [null, undefined, 7, 'x', {}, { missionTree: 'nope' }, { missionTree: [null, 3, { state: 'ACTIVE' }, { state: 'ACTIVE', branchId: 9 }] }]) expect(activeEngagementKeyOf(s)).toBeNull();
        expect(companyUnitIdsOf({ startingForce: [{ instanceId: 'u1' }, null, { instanceId: 4 }, { instanceId: 'u2' }] })).toEqual(['u1', 'u2']);
        expect(companyUnitIdsOf(null)).toEqual([]);
        expect(companyUnitIdsOf({ startingForce: 'nope' })).toEqual([]);
    });
});

describe('seatAssignDecision — P5 (THE GM SEATS A PLAYER: a unit of THIS company, a player of THIS lobby)', () => {
    const base = { unitIds: ['u1', 'u2'], lobbyTokens: ['tok-a', 'tok-b'] };
    it('a joined player onto a company unit → seat', () => {
        expect(seatAssignDecision({ ...base, instanceId: 'u1', toToken: 'tok-b' })).toEqual({ verdict: 'seat' });
    });
    it('the empty token clears the seat → unseat', () => {
        expect(seatAssignDecision({ ...base, instanceId: 'u2', toToken: '' })).toEqual({ verdict: 'unseat' });
    });
    it('a token that never joined THIS campaign is denied (a mistyped or foreign token can never hold a seat)', () => {
        expect(seatAssignDecision({ ...base, instanceId: 'u1', toToken: 'tok-stranger' })).toEqual({ verdict: 'deny', reason: 'not a joined player' });
    });
    it('a unit that is not in the company is denied — for a seat AND for an unseat (an OpFor id, a stale id)', () => {
        expect(seatAssignDecision({ ...base, instanceId: 'op-9', toToken: 'tok-a' })).toEqual({ verdict: 'deny', reason: 'no such unit in the company' });
        expect(seatAssignDecision({ ...base, instanceId: 'op-9', toToken: '' })).toEqual({ verdict: 'deny', reason: 'no such unit in the company' });
    });
});

describe('seatActorOf / seatLabelOf — ORDER-13 (WHO changed a seat, with the acting role the server knows)', () => {
    const anon = (s: string) => `h(${s})`;
    const OWNER = { userId: 'u-owner', displayName: 'James', admin: false };
    it('the OWNER on the WRITER device → role owner, named by account with the gm- handle', () => {
        expect(seatActorOf({ authRequired: true, gm: OWNER, ownerId: 'u-owner', isWriterDevice: true, player: null, anon })).toEqual({ actor: 'James (GM)', actorKey: 'gm-h(u-owner)', role: 'owner' });
        expect(seatActorOf({ authRequired: true, gm: OWNER, ownerId: 'u-owner', isWriterDevice: true, player: null, anon })).toEqual({ actor: 'James (GM)', actorKey: 'gm-h(u-owner)', role: 'owner' });
    });
    it('the OWNER whose DEVICE is not the writer (handed away, or its other device holds it — P5) → role owner-reading: it still seats, the server still records', () => {
        expect(seatActorOf({ authRequired: true, gm: OWNER, ownerId: 'u-owner', isWriterDevice: false, player: null, anon })).toEqual({ actor: 'James (GM)', actorKey: 'gm-h(u-owner)', role: 'owner-reading' });
    });
    it('an ADMIN who is not the owner → role admin; an admin who IS the owner is the owner', () => {
        expect(seatActorOf({ authRequired: true, gm: { userId: 'u-adm', displayName: 'Support', admin: true }, ownerId: 'u-owner', isWriterDevice: false, player: null, anon })).toEqual({ actor: 'Support (GM)', actorKey: 'gm-h(u-adm)', role: 'admin' });
        expect(seatActorOf({ authRequired: true, gm: { userId: 'u-owner', displayName: 'James', admin: true }, ownerId: 'u-owner', isWriterDevice: true, player: null, anon })).toEqual({ actor: 'James (GM)', actorKey: 'gm-h(u-owner)', role: 'owner' });
    });
    it('a PLAYER (a bound lobby identity, not a GM) → role player, named by callsign with the anon handle — never the token', () => {
        const opaque = (s: string) => `x${s.length}`; // a non-reversing stand-in for anonId — the handle must not carry the token
        const r = seatActorOf({ authRequired: true, gm: null, ownerId: 'u-owner', isWriterDevice: false, player: { token: 'tok-alpha', name: 'Alpha' }, anon: opaque });
        expect(r).toEqual({ actor: 'Alpha', actorKey: 'x9', role: 'player' });
        expect(JSON.stringify(r)).not.toContain('tok-alpha');
        expect(seatActorOf({ authRequired: true, gm: null, ownerId: 'u-owner', isWriterDevice: false, player: { token: 'tok-x', name: '  ' }, anon })).toEqual({ actor: 'Player', actorKey: 'h(tok-x)', role: 'player' });
    });
    it('a nameless GM account reads "GM (GM)"; no identity at all is still a line (never a throw)', () => {
        expect(seatActorOf({ authRequired: true, gm: { userId: 'u-o', displayName: null, admin: false }, ownerId: 'u-o', isWriterDevice: true, player: null, anon }).actor).toBe('GM (GM)');
        expect(seatActorOf({ authRequired: true, gm: null, ownerId: 'u-o', isWriterDevice: false, player: null, anon })).toEqual({ actor: 'Player', actorKey: '?', role: 'player' });
    });
    it('auth OFF (dev/LAN) → role dev: a bound player by callsign, anyone else as "GM"', () => {
        expect(seatActorOf({ authRequired: false, gm: null, ownerId: null, isWriterDevice: false, player: { token: 'tok-a', name: 'Alpha' }, anon })).toEqual({ actor: 'Alpha', actorKey: 'h(tok-a)', role: 'dev' });
        expect(seatActorOf({ authRequired: false, gm: OWNER, ownerId: 'u-owner', isWriterDevice: true, player: null, anon })).toEqual({ actor: 'GM', actorKey: 'gm', role: 'dev' });
    });
    it('seatLabelOf: "chassis model" off the company; the id when the blob does not know the unit or is malformed', () => {
        expect(seatLabelOf({ startingForce: [{ instanceId: 'u1', chassis: 'Atlas', model: 'AS7-D' }] }, 'u1')).toBe('Atlas AS7-D');
        expect(seatLabelOf({ startingForce: [{ instanceId: 'u1', chassis: 'Atlas' }] }, 'u1')).toBe('Atlas');
        expect(seatLabelOf({ startingForce: [{ instanceId: 'u1' }] }, 'u1')).toBe('u1');
        expect(seatLabelOf({ startingForce: [], missionSpec: { opforForce: [{ instanceId: 'op1', chassis: 'Locust', model: 'LCT-1V' }] } }, 'op1')).toBe('Locust LCT-1V'); // an OpFor seat (a player on the OPFOR side) is labelled too
        for (const s of [null, 3, {}, { startingForce: 'x' }]) expect(seatLabelOf(s, 'u9')).toBe('u9');
    });
});
