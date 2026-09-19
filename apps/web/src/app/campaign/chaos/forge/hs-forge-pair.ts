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
    localFactions?: ReadonlySet<string>;
    /** ERA-1 (ruling 2) — does this faction HIRE mercenaries (hotspots-catalog `factionHiresMercenaries`)? A faction
     *  that does not (an Invasion Clan) is never side A / the employer's flavor faction; on a world it HOLDS the
     *  contract comes from the state fighting for it (the CLAN FRONT), and as an opponent it outweighs the
     *  neighbors (the invasion is the existential threat). Optional: absent = everyone hires (pre-ERA-1 behavior). */
    hiresMercs?: (name: string) => boolean;
    rng: () => number;
}

const combatOk = (ctx: PairCtx, name: string): boolean => ctx.factionOk(name) && ctx.mulOk(name);
/** ERA-1 — a non-hiring opponent (an Invasion Clan on the front) is drawn this many times as often as a
 *  hiring neighbor. Only consulted when such an opponent is actually in the local list, so every world
 *  off the front draws byte-identically to before (plain `pick`, same RNG consumption). */
const CLAN_FRONT_WEIGHT = 3;

/** Draw the conflict pair for a world owned by `owner` at the era. Returns null when no archetype can
 *  produce a legal pair for this owner (the orchestrator then re-picks the world — never a silent degrade). */
export function pickConflictPair(owner: string, archetypes: readonly EmployerArchetype[], ctx: PairCtx): ConflictPair | null {
    const eraOk = (a: EmployerArchetype): boolean =>
        !a.eraGroups?.length || a.eraGroups.includes('all') || a.eraGroups.includes(ctx.era.chamberTag);
    const hires = (n: string): boolean => ctx.hiresMercs?.(n) ?? true;
    const ownerHires = hires(owner);
    // Which archetypes CAN fire on this world? clan-internal needs a Clan owner; state archetypes need a
    // combat-legal owner + at least one plausible opponent; merc/pirate shapes need their fixed factions legal.
    // ERA-1: every archetype whose EMPLOYER is the owner needs an owner that hires; a non-hiring owner (a Clan
    // holding the world) can only be the ENEMY of a state-pair whose employer is a hiring opponent (never Pirates).
    const opponents = plausibleOpponents(owner, ctx);
    const employers = ownerHires ? [] : opponents.filter((o) => o !== 'Pirates' && hires(o));
    const candidates = archetypes.filter((a) => {
        if (!eraOk(a)) return false;
        switch (a.combatFactionRule) {
            case 'clan-internal': return ownerHires && ctx.isClanFaction(owner) && combatOk(ctx, owner);
            case 'merc-both': return ownerHires && combatOk(ctx, 'Mercenary');
            case 'pirates-attacker': return ownerHires && combatOk(ctx, owner) && combatOk(ctx, 'Pirates');
            case 'state-pair': default: return combatOk(ctx, owner) && (ownerHires ? opponents.length > 0 : employers.length > 0);
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
            if (!ownerHires) { // ERA-1 — the CLAN FRONT, held side: the world is Clan-held; the state fighting for it hires
                const emp = pick(employers, ctx.rng);
                return { archetype, sameFaction: false, a: { faction: emp, employerFaction: emp }, b: { faction: owner, employerFaction: owner } };
            }
            const front = opponents.some((o) => !hires(o)); // ERA-1 — the CLAN FRONT, threatened side: the Clan outweighs the neighbors
            const opp = front ? pickWeighted(opponents, (o) => (hires(o) ? 1 : CLAN_FRONT_WEIGHT), ctx.rng) : pick(opponents, ctx.rng);
            return { archetype, sameFaction: false, a: { faction: owner, employerFaction: owner }, b: { faction: opp, employerFaction: opp } };
        }
    }
}

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
