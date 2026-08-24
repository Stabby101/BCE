/*
 * DIRECTIVE-HARDEN-6 Part C — pins EVERY shipped HARDEN-5+5b authorization rule, now that the decisions are pure
 * (ws-authz.ts). isGmDecision, accessDecision (the P2/P3/DEPLOY-003 gate), and actionDecision (the per-message
 * gate, post-lazy-bind-removal). If a spec disagrees with the code it's a real regression or a spec error —
 * do NOT edit the code to match; the gateway's thin adapters must behave byte-identically to these deciders.
 */
import { isGmDecision, accessDecision, actionDecision, type AuthzUser } from './ws-authz';

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
