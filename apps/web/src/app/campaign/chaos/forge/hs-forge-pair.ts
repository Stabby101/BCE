/*
 * BCE — HSFORGE-1: the conflict-pair generator. Pure (no Angular): archetype draw + a plausible
 * opposed state pair via the D-102 oracle (isPlausibleMatchup over the era's factionAdjacency).
 * Same-faction archetypes (merc-vs-merc, clan-internal) bypass the oracle by explicit whitelist —
 * both have authored precedent (hs-drm-15, hs-drm-02). Non-state archetypes keep the STATE pair as
 * the combat factions and put the archetype in the employer STRINGS (the DR pack's own pattern).
 */
import { isPlausibleMatchup } from '../../contract/faction-matchup';
import type { EmployerArchetype } from './hs-forge-data';
import type { EraCtx } from './hs-forge-worlds';
import { pick, pickWeighted } from './hs-forge-rng';

export interface PairSide {
    faction: string;        // the side's COMBAT faction (C4 — must be catalog-resolvable; MUL-mappable in ilClan)
    employerFaction: string; // the faction whose name flavors the employer string ({FACTION_NAME})
}
export interface ConflictPair {
    archetype: EmployerArchetype;
    a: PairSide; // the offer's side A (role assigned by the root template downstream)
    b: PairSide;
    sameFaction: boolean;
}

export interface PairCtx {
    era: EraCtx;
    adjacency: Record<string, string[]>;      // star.factionAdjacency(wizardEraId)
    factionOk: (name: string) => boolean;     // resolvable in the unit catalog (getFactionByName) w/ a non-empty era pool
    mulOk: (name: string) => boolean;         // ilClan: hsFactionToMulFaction non-null (inert true off-ilClan)
    isClanFaction: (name: string) => boolean; // owner is a Clan (gates the clan-internal archetype)
    /** WORLD-LOCAL adjacency (the P2 FOLLOWUPS refinement, wave-shipped): factions owning ≥1 system
     *  near the CHOSEN world at the era. When provided, opponents are preferred from this set before
     *  the faction-level relax — a Draconis March offer stops drawing the Taurian Concordat just
     *  because FS borders TC somewhere ELSE. Soft: an empty intersection falls back to the full
     *  faction-level list (never a dead-end — the D-102 relax discipline). */
    localFactions?: ReadonlySet<string>;
    rng: () => number;
}

const combatOk = (ctx: PairCtx, name: string): boolean => ctx.factionOk(name) && ctx.mulOk(name);

/** Draw the conflict pair for a world owned by `owner` at the era. Returns null when no archetype can
 *  produce a legal pair for this owner (the orchestrator then re-picks the world — never a silent degrade). */
export function pickConflictPair(owner: string, archetypes: readonly EmployerArchetype[], ctx: PairCtx): ConflictPair | null {
    const eraOk = (a: EmployerArchetype): boolean =>
        !a.eraGroups?.length || a.eraGroups.includes('all') || a.eraGroups.includes(ctx.era.chamberTag);
    // Which archetypes CAN fire on this world? clan-internal needs a Clan owner; state archetypes need a
    // combat-legal owner + at least one plausible opponent; merc/pirate shapes need their fixed factions legal.
    const opponents = plausibleOpponents(owner, ctx);
    const candidates = archetypes.filter((a) => {
        if (!eraOk(a)) return false;
        switch (a.combatFactionRule) {
            case 'clan-internal': return ctx.isClanFaction(owner) && combatOk(ctx, owner);
            case 'merc-both': return combatOk(ctx, 'Mercenary');
            case 'pirates-attacker': return combatOk(ctx, owner) && combatOk(ctx, 'Pirates');
            case 'state-pair': default: return combatOk(ctx, owner) && opponents.length > 0;
        }
    });
    if (!candidates.length) return null;
    const archetype = pickWeighted(candidates, (a) => a.weight, ctx.rng);

    switch (archetype.combatFactionRule) {
        case 'clan-internal': // an internal trial: both sides the owning Clan (oracle bypass — authored precedent hs-drm-02)
            return { archetype, sameFaction: true, a: { faction: owner, employerFaction: owner }, b: { faction: owner, employerFaction: owner } };
        case 'merc-both': { // merc-vs-merc over a local dispute: both combat sides Mercenary (precedent hs-drm-15)
            const opp = opponents.length ? pick(opponents, ctx.rng) : owner;
            return { archetype, sameFaction: true, a: { faction: 'Mercenary', employerFaction: owner }, b: { faction: 'Mercenary', employerFaction: opp } };
        }
        case 'pirates-attacker': // a pirate raid on the owner's world: defender = owner, attacker = Pirates
            return { archetype, sameFaction: false, a: { faction: owner, employerFaction: owner }, b: { faction: 'Pirates', employerFaction: 'Pirates' } };
        case 'state-pair': default: { // house-vs-house (or corporate/noble/planetary-gov riding a state pair)
            const opp = pick(opponents, ctx.rng);
            return { archetype, sameFaction: false, a: { faction: owner, employerFaction: owner }, b: { faction: opp, employerFaction: opp } };
        }
    }
}

/** Combat-legal opponents plausibly opposed to `owner` at the era: the D-102 oracle over the real
 *  adjacency + Pirates always eligible (raiders cross any border). WORLD-LOCAL preference: when the
 *  ctx carries the chosen world's local-faction set, opponents actually present NEAR the world win
 *  over far-border matchups; empty intersection → the full faction-level list (soft, never dead-ends). */
export function plausibleOpponents(owner: string, ctx: PairCtx): string[] {
    const matchCtx = { adjacency: ctx.adjacency, year: ctx.era.year };
    const borders = (ctx.adjacency[owner] ?? []).filter((t) => combatOk(ctx, t) && isPlausibleMatchup(owner, t, matchCtx));
    if (combatOk(ctx, 'Pirates') && isPlausibleMatchup(owner, 'Pirates', matchCtx) && !borders.includes('Pirates')) borders.push('Pirates');
    if (ctx.localFactions?.size) {
        const local = borders.filter((t) => t === 'Pirates' || ctx.localFactions!.has(t)); // raiders are local everywhere
        if (local.length) return local;
    }
    return borders;
}
