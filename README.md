# BattleTech Campaign Engine (BCE)

A campaign manager and tabletop-session companion for BattleTech, built as an Nx monorepo:

- `apps/api` — the server-authoritative engine + REST/WebSocket API (NestJS + SQLite).
- `apps/web` — the web frontend and player companion, derived from the MekBay unit viewer (Angular).

## Build

```sh
npm install                    # the workspace root (Nx + the api toolchain)
npm --prefix apps/web install  # the web app's own toolchain (the vendored MekBay fork keeps its own package.json)
npx nx build api
npx nx build web
```

Requires Node 24.x and network access on the first `nx build web`: its `prerun` step
(`apps/web/package.json`) regenerates build metadata, asset indexes and sprites, then fetches the
**MekBay unit-catalog data** (`units.json`, `equipment2.json`, `quirks.json`, `factions.json`,
`eras.json`, `units_sources.json`) from MekBay's public data service (`https://db.mekbay.com`,
overridable via `BCE_MIRROR_SRC`) into `apps/web/public/mekbay/` and derives the per-era slices.
That catalog is **MegaMek/MekBay data (CC BY-NC-SA 4.0)** — it is deliberately **not stored in this
GPLv3 source repository**; the build fetches it from upstream, exactly as the deployed site's build
does. The optional R2 upload step inside the mirror is skipped automatically when no `R2_*`
credentials are present. Each app's `project.json` lists the full set of build/serve targets.

## License & Attribution

BCE is free software licensed under the **GNU General Public License v3.0** — see [`LICENSE`](LICENSE).
The complete corresponding source is published in this repository.

Unit data, record sheets, and sprites are derived from the **MegaMek Data Repository**
(https://github.com/MegaMek/mm-data) and are licensed **CC BY-NC-SA 4.0**. This frontend is derived from
**MekBay**; upstream MegaMek/MekBay copyright notices are retained in the source.

MechWarrior, BattleMech, `Mech, and BattleTech are trademarks of **The Topps Company, Inc.**
Catalyst Game Labs and its logo are trademarks of **InMediaRes Productions, LLC.**
MechWarrior © **Microsoft Corporation** — this project was created under Microsoft's
"Game Content Usage Rules" (https://www.xbox.com/en-US/developers/rules) and is not endorsed by or
affiliated with Microsoft.

Full notices: see [`NOTICE.md`](NOTICE.md) and the in-app **Legal & Attribution** page.
