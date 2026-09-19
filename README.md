# BattleTech Campaign Engine (BCE)

Play it at https://bcengine.org. It's free. No ads, nothing sold. Sign in with Google or play as a guest with a recovery code.

BCE is a campaign manager and table companion for classic BattleTech. You run a mercenary company: take contracts, negotiate terms, fight the missions, get paid, fix what broke, watch your pilots get better or get hurt. When it's time to play the fight on the table, each player opens their record sheet on their phone and marks damage there. The results go back into the campaign when the fight is over. It sits on top of the MekBay unit viewer, so every unit in the MegaMek catalog is in it with a real record sheet.

I built it because I run a table and got tired of the bookkeeping. It has been played at my table every week for months. One very patient volunteer tested it hard along the way.

## What's in it

Classic campaign. The usual merc loop. Take a contract from the market, generate a mission, deploy a force, fight it, resolve it, repair, get paid. There's a combined arms switch if you want vehicles and infantry. After action reports are written from what actually happened in the fight.

Hot Spots. A Chaos Campaign style mode in the shape of Draconis Reach. A star map with real system data. An offer board of written contracts, most of them two sided so you can sign with either employer. Term negotiation that follows the book. A track tree where the next fight depends on how the last one went. Two sided victory point resolve. Pilot progression paid out of the warchest. The market and the enemy force are both held to each faction's Master Unit List for the era.

The table. A GM screen with a claims board showing who is flying what, a session code and QR for players to join, live damage coming in from every phone in the room, an End Phase step so nothing lands until the player says so, and a resolve that reads the sheets as they actually are.

The player phone. Your roster, your record sheet with heat and criticals, your results slip. Nothing to install.

## Screenshots

| | |
|---|---|
| ![Star map](docs/screenshots/10-hs-star-map.png) The star map | ![Mission tree](docs/screenshots/17-hs-mission-tree.png) A contract's track tree |
| ![Offer brief](docs/screenshots/12-hs-brief-preview.png) An offer brief | ![Negotiation](docs/screenshots/15-hs-negotiate-terms.png) Negotiating terms |
| ![Process rail](docs/screenshots/16-hs-contract-process-rail.png) A contract in progress | ![Resolve](docs/screenshots/22-hs-resolve.png) Resolving a mission |
| ![Claims board](docs/screenshots/21-hs-claims-board.png) The GM's claims board | ![Phone sheet](docs/screenshots/44-phone-record-sheet-heat.png) A record sheet on a phone |
| ![Roster](docs/screenshots/08-hs-unit-roster.png) The unit roster | ![Repair](docs/screenshots/24-hs-repair-refit.png) Repair and refit |
| ![Results slip](docs/screenshots/40-phone-roster-results-slip.png) A results slip | ![Classic Forge](docs/screenshots/31-classic-forge-brief.png) A Classic mission brief |

## Where it stands

Alpha. The core loop works and gets played every week. There are rough edges, mostly in corners one tester and one GM never wandered into. If something breaks, the footer of the app names the part that failed. Paste that line into an issue and it will get fixed fast.

One person builds and maintains this around a day job, with the usual modern developer tooling. Every mechanic in it has been run at a real table before it shipped. Judge it by whether it makes your campaign better.

## How to help

This needs more than one person's imagination.

Write missions. Hot Spots contracts live in a JSON pack: a world, an employer, two sides, a few tracks with objectives and forks. If you can write a good three paragraph situation and you know what a Defend or an Objective Raid feels like on the table, you can write one. CONTRIBUTING.md has the shape and the one rule I won't bend on, which is that the words have to be yours. Nothing copied from a book.

Play it and tell me what broke. An issue with what you did, what you expected, and the footer line is worth an hour of my time. Phone screenshots help.

Code. It's TypeScript all the way through. Angular on the front, NestJS on the back, SQLite under it. Build steps are below. Start a discussion before a big change so we don't collide.

Bring what you already have. If you ran a campaign somewhere the app doesn't cover yet, your ideas and your own written material are welcome. Book text isn't.

Discussions are open on this repo. Issues for bugs, Discussions for everything else.

## Build

```sh
npm install                    # the workspace root (Nx + the api toolchain)
npm --prefix apps/web install  # the web app's own toolchain (the vendored MekBay fork keeps its own package.json)
npx nx build api
npx nx build web
```

You need Node 24.x and network access on the first `nx build web`. Its `prerun` step regenerates build metadata, asset indexes and sprites, then fetches the MekBay unit catalog data (`units.json`, `equipment2.json`, `quirks.json`, `factions.json`, `eras.json`, `units_sources.json`) from MekBay's public data service at `https://db.mekbay.com` (override with `BCE_MIRROR_SRC`) into `apps/web/public/mekbay/` and derives the per era slices. That catalog is MegaMek/MekBay data under CC BY-NC-SA 4.0. It is deliberately not stored in this GPLv3 repository. The build fetches it from upstream, the same way the deployed site's build does. The optional R2 upload step is skipped when no `R2_*` credentials are present.

`apps/api` is the server side engine and REST/WebSocket API (NestJS + SQLite). `apps/web` is the web frontend and player companion (Angular, derived from MekBay). Each app's `project.json` lists its build and serve targets.

## License and attribution

BCE is free software under the GNU General Public License v3.0. See [`LICENSE`](LICENSE). The complete corresponding source is published in this repository. BCE is non-commercial and will stay that way.

Unit data, record sheets and sprites come from the MegaMek Data Repository (https://github.com/MegaMek/mm-data), licensed CC BY-NC-SA 4.0. The frontend is derived from MekBay (https://github.com/MegaMek/mekbay). Upstream MegaMek and MekBay copyright notices are kept in the source. Thank you to both projects. None of this exists without them.

MechWarrior, BattleMech, `Mech and BattleTech are trademarks of The Topps Company, Inc. Catalyst Game Labs and its logo are trademarks of InMediaRes Productions, LLC. MechWarrior is © Microsoft Corporation. This project was created under Microsoft's Game Content Usage Rules (https://www.xbox.com/en-US/developers/rules) and is not endorsed by or affiliated with Microsoft, Topps, Catalyst or MegaMek.

Full notices are in [`NOTICE.md`](NOTICE.md) and on the app's Legal and Attribution page.
