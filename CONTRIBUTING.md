# Contributing to BCE

Three ways in, in order of how much they help right now: **write missions**, **report what broke**, **code**. Discussions on this repo for questions and ideas; Issues for bugs and mission submissions.

## The one hard rule — your own words

BCE ships under a GPL for the code and CC BY-NC-SA for the unit data, inside Microsoft's Game Content Usage Rules. None of that covers text from a sourcebook. **Nothing copied or closely paraphrased from a Catalyst product goes into a mission** — not a situation paragraph, not a named character's backstory, not a table. Use the setting freely (worlds, factions, units, the shape of the era); write the words yourself. Planet facts come from Sarna (cite the page in the record's `_source` field). If you're not sure whether something is too close, it is — rewrite it.

Second rule, softer: **it has to work on a table.** Every objective is something a GM can adjudicate with a ruler and a die. "Hold the center — half your force within 4 hexes of the center at the end of Turn 6" is an objective. "Defeat the enemy's will to fight" is not.

## Reporting a bug

Open an issue with: what mode you were in (Classic / Hot Spots / a GM session), what you did, what you expected, what happened, and **the footer line** — the bottom of the app names the failing part when something goes wrong, and that one line usually locates the bug. Phone screenshots are welcome. If the app told you to use `bcengine.org/?fresh=1`, say whether that fixed it.

## Writing a Hot Spots mission

A Hot Spots mission is one record in a **pack** — a JSON file named `hotspots-<region>.json` with a `_meta` block and a `hotspots` array. The app loads every pack it ships with and deals contracts from the ones that match the campaign's era. You don't need to build the app to author one: write the record, validate it against a sibling, and submit it (below).

### What a record is

One **hot spot** = one world with a problem, offered as a **contract** with **two sides** (pick-a-side: the players can sign for either employer), a **system profile** (real planet data), a **mission brief** (the GM's behind-the-scenes, complications, named characters), and **tracks** — the fights, three or four of them, joined by **forks** so the next track depends on how the last one went.

### The skeleton

Copy a sibling record from an existing pack (`apps/web/src/app/campaign/mission/forge-data/hotspots-draconis-march.json` is the reference set) and replace every field. The shape, abbreviated:

```jsonc
{
  "id": "hs-<region>-<nn>",              // unique; region tag + number
  "title": "Hold the Academy Line",
  "world": "New Ivaarsen",               // the planet; must exist on the star map (Sarna name)
  "employer": "…",                       // side A's employer (legacy field; sides win)
  "type": "Garrison / Reactive Defense", // the contract type in plain words
  "situation": "…",                      // 2–3 paragraphs, the player-facing synopsis
  "sides": {
    "a": { "key": "a", "role": "defender", "employer": "…", "faction": "Federated Suns",
           "contract": { "scale": "2", "intensity": "3", "lengthMonths": "3",
                         "steps": { "basePay": 7, "support": 8, "transport": 8, "salvage": 3, "command": 4 },
                         "enemyFaction": "Draconis Combine",
                         "constraints": "…", "additionalRequirements": "…", "bonus": "…" },
           "blurb": "one line for the offer card", "situation": "this side's read of the same events" },
    "b": { "key": "b", "role": "attacker", "…": "the mirror — the other employer's contract" }
  },
  "systemProfile": { "starType": "K1V", "rechargeHours": "192", "timeToJumpPointDays": "5.18",
                     "surfaceGravity": "1.1", "climate": "…", "population": "…", "capitalCity": "…", "…": "…" },
  "contract": { "…": "side A's contract again (legacy mirror — keep identical to sides.a.contract)" },
  "missionBrief": {
    "behindScenes": "what's really going on — GM only",
    "complications": [ { "roll": "1-3", "effect": "None." }, { "roll": "4-5", "effect": "…" } ],
    "contractVictory": "what each side needs across the whole contract",
    "tally": "a running count the contract keeps (optional)",
    "namedCharacters": [ { "name": "…", "role": "OpFor commander", "chassis": "Grand Dragon",
                           "skill": "Gunnery 3 / Piloting 4", "rule": "when they appear, when they leave" } ],
    "purchaseOptions": "what the Market offers between tracks (optional)"
  },
  "tracks": [
    { "id": "t1", "name": "The Vestfold Plain", "templateId": "Defend", "root": true,
      "situation": "…", "deployment": "edges, forces held off-map, arrival turns",
      "objectives": [ { "text": "Hold the Center — …", "vp": 50, "side": "both" } ],
      "specialRules": "…", "trackEnd": "End of Turn 6 (Turn 8 AS at Scale 2+).",
      "salvagePolicy": "Winner-all / Exchange / …",
      "opfor": { "faction": "Draconis Combine", "armsMix": "COMBINED_ARMS", "vehicleShare": 0.3, "bvRatio": 1 },
      "forks": [ { "outcomeGate": "SUCCESS", "nextTrackId": "t2a", "trigger": "…", "consequence": "…", "threat": "MEDIUM" },
                 { "outcomeGate": "FAILURE", "nextTrackId": "t2b", "trigger": "…", "consequence": "…", "threat": "HIGH" } ] },
    { "id": "t2a", "…": "…" }
  ],
  "_source": "Sarna: https://www.sarna.net/wiki/New_Ivaarsen (system facts). All prose original."
}
```

### Field notes

- **`world`** must be a system the star map knows (Sarna's spelling). If it isn't on the map, say so in the submission and include the Sarna page — we'll add the system.
- **`scale`** (1–3) sizes the fight; **`intensity`** (1–3) is how many tracks the contract expects; **`lengthMonths`** is the employer's window.
- **`steps`** are the starting rows of the five negotiation terms (base pay, support, transport, salvage, command rights). When unsure, copy a sibling contract of the same type — they're calibrated.
- **`templateId`** is one of the twelve track templates the app knows: `Assault`, `Breakthrough`, `Defend`, `Duel`, `Flank`, `Meeting Engagement`, `Objective Raid`, `Pursuit`, `Pushback`, `Recon`, `Retreat`, `Strike`. The template sets the default track-end and VP shape; your objectives override. Spell it exactly.
- **`objectives[].side`** is `both`, `attacker`, or `defender`. `vp` is what it's worth. Two-sided resolve compares the sides' VP totals — give each side something to score.
- **`forks`**: every non-final track needs at least a `SUCCESS` and a `FAILURE` fork (`FULL_SUCCESS` and `PARTIAL` are optional gates). A track with no forks is a final track. **Every fork must point at a track that exists.**
- **`opfor.bvRatio`** is a multiplier on the players' fielded BV (1 = even). `vehicleShare` only matters with `COMBINED_ARMS`.
- **Named characters** are yours — invented people, not canon characters given new lines.

### Voice

Two or three paragraphs for the situation; two per track. Concrete nouns, a clock, a reason the employer cares, and one detail a GM can improvise from. The best authored records in the pack read like a briefing officer who has been there, not like a rulebook.

### Validating

The record must parse as JSON, every `nextTrackId` must resolve, every objective must have a `vp`, and the two sides' `enemyFaction` must be each other's `faction`. A quick check without the app:

```sh
node -e "const p=require('./hotspots-yours.json');for(const h of p.hotspots){const ids=new Set(h.tracks.map(t=>t.id));for(const t of h.tracks)for(const f of t.forks??[])if(!ids.has(f.nextTrackId))throw new Error(h.id+' '+t.id+' -> '+f.nextTrackId+' missing');}console.log('ok')"
```

### Submitting

Open an issue titled `Mission: <title> (<world>)` and attach the JSON (or open a PR adding it to a pack). Say which era it's for and where the planet facts came from. I run it through the ingest, check the IP line, and either merge it or come back with notes. Credit goes in the pack's `_meta.contributors` under whatever name you like.

## Code

TypeScript throughout: Angular 21 (standalone components, signals) in `apps/web`, NestJS 11 + SQLite in `apps/api`, Nx to hold it together. Build instructions are in the README. A few conventions worth knowing before a PR:

- `apps/web` is a vendored fork of MekBay; changes to the viewer itself are kept small and marked so they survive an upstream re-baseline.
- The server is authoritative for campaign state; the client never decides who owns what.
- Tests: `npx nx test api` (jest) and `npx nx test web` (jasmine); lint with `npx nx lint web`. A change to a game rule comes with a spec that pins the book value.
- Open a Discussion before a large change. Small fixes: just PR them.

## Conduct

Be the person you'd want at your table. That's the whole policy.
