/*
 * BCE — DIRECTIVE-COMPLIANCE-1 Part B/D: the "Legal & Attribution" page (/legal). Renders the FULL notices
 * verbatim from NOTICE.md — the sections: code/GPLv3 + the corresponding-source link, the MegaMek Data, the Sarna.net GFDL historical-data attribution (§2b, GAZETTEER-1 P2), the
 * CC BY-NC-SA 4.0 attribution block, the Microsoft Game Content Usage Rules notice + link, and the Topps /
 * Catalyst trademark lines. Reachable from the footer on every route of BOTH the GM and player bundles. The
 * text is embedded (not fetched) so it renders offline + under the strict Artifact/asset CSP. Part D: includes
 * the GPLv3 corresponding-source availability statement + a written offer of source (belt-and-suspenders in
 * case the public repo link is unavailable to a given user). Nothing here is removable branding — this is the
 * legal attribution that MUST stay present (DIRECTIVE Part E).
 */
import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { Location } from '@angular/common';

@Component({
    selector: 'bce-legal-page',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="lp">
            <button type="button" class="lp-back" (click)="back()">&larr; Back</button>
            <h1>BattleTech Campaign Engine (BCE) — Attribution &amp; Legal Notices</h1>
            <p class="lp-lead">BCE is an <b>unofficial, non-commercial fan project</b>. It is <b>not endorsed by or
                affiliated with</b> Microsoft, The Topps Company, Catalyst Game Labs / InMediaRes Productions, or the
                MegaMek project. BCE is provided free of charge for personal, non-commercial use — it is not sold,
                displays no advertising, and requires no subscription or fee.</p>

            <h2>1. Software (code)</h2>
            <p>The BCE web client (<code>apps/web</code>) is derived from <b>MekBay</b>
                (<a href="https://github.com/MegaMek/mekbay" target="_blank" rel="noopener noreferrer">https://github.com/MegaMek/mekbay</a>),
                part of the <b>MegaMek</b> project, which is licensed under the <b>GNU General Public License, version 3
                (GPLv3)</b>. BCE's frontend is and remains licensed under GPLv3. In accordance with the GPL, the complete
                corresponding source of the BCE web client is available at:
                <a href="https://github.com/Stabby101/BCE" target="_blank" rel="noopener noreferrer">https://github.com/Stabby101/BCE</a>.</p>
            <p>MegaMek, MegaMekLab, MekHQ, and MekBay &copy; the MegaMek Team, licensed under GPLv3.</p>
            <p class="lp-offer"><b>Written offer of source (GPLv3 §6):</b> the complete corresponding source for the BCE
                web client is available at the repository above; if that link is unavailable to you, you may request a
                copy of the corresponding source from the BCE maintainer at no charge beyond the cost of transmission.</p>

            <h2>2. Game data (unit files, record sheets, images, and derived data)</h2>
            <p>Unit data, record sheets, unit sprites/artwork, and related assets used by BCE are derived from the
                <b>MegaMek Data Repository</b>
                (<a href="https://github.com/MegaMek/mm-data" target="_blank" rel="noopener noreferrer">https://github.com/MegaMek/mm-data</a>),
                and carry the following notice:</p>
            <blockquote>
                <p>MegaMek Data (C) 2025 by The MegaMek Team is licensed under CC BY-NC-SA 4.0.
                    To view a copy of this license, visit
                    <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noopener noreferrer">https://creativecommons.org/licenses/by-nc-sa/4.0/</a></p>
                <p>NOTICE: The MegaMek organization is a non-profit group of volunteers creating free software for the
                    BattleTech community.</p>
                <p>MechWarrior, BattleMech, &#96;Mech and AeroTech are registered trademarks of The Topps Company, Inc.
                    All Rights Reserved.</p>
                <p>Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of InMediaRes Productions, LLC.</p>
                <p>MechWarrior Copyright Microsoft Corporation. MegaMek Data was created under Microsoft's "Game Content
                    Usage Rules" <a href="https://www.xbox.com/en-US/developers/rules" target="_blank" rel="noopener noreferrer">https://www.xbox.com/en-US/developers/rules</a>
                    and it is not endorsed by or affiliated with Microsoft.</p>
            </blockquote>
            <p>Any data BCE derives from or bases on MegaMek Data is likewise licensed <b>CC BY-NC-SA 4.0</b>
                (Attribution — NonCommercial — ShareAlike). Original BCE-authored prose and content (e.g. mission and
                campaign text) is original work by the BCE project.</p>

            <h2>2b. Historical and system data (Sarna.net BattleTechWiki)</h2>
            <p>Star-map history facts — per-world ownership changes, notable battles and events, and the flashpoint
                timeline — are <b>facts distilled from Sarna.net BattleTechWiki</b>
                (<a href="https://www.sarna.net/" target="_blank" rel="noopener noreferrer">https://www.sarna.net</a>)
                planet and battle articles, gathered through the wiki's public API. Sarna's contributed text is licensed
                under the <b>GNU Free Documentation License 1.2</b>
                (<a href="https://www.gnu.org/copyleft/fdl.html" target="_blank" rel="noopener noreferrer">https://www.gnu.org/copyleft/fdl.html</a>).
                BCE reproduces <b>no wiki text</b> — only dates, page titles, and participant names, which are not
                copyrightable — and every fact links back to its source page. In-app credit:
                <i>"Historical data: Sarna.net BattleTechWiki (cited facts)."</i></p>

            <h2>3. Microsoft Game Content Usage Rules</h2>
            <blockquote>
                <p>MechWarrior &copy; Microsoft Corporation. BattleTech Campaign Engine (BCE) was created under
                    Microsoft's "Game Content Usage Rules"
                    (<a href="https://www.xbox.com/en-US/developers/rules" target="_blank" rel="noopener noreferrer">https://www.xbox.com/en-US/developers/rules</a>)
                    using assets from the MechWarrior / BattleTech universe, and it is not endorsed by or affiliated with
                    Microsoft.</p>
            </blockquote>
            <p>This license from Microsoft is limited, non-commercial, and revocable at Microsoft's discretion.</p>

            <h2>4. Trademarks</h2>
            <p>MechWarrior, BattleMech, BattleTech, &#96;Mech and AeroTech are registered trademarks of
                <b>The Topps Company, Inc.</b> All Rights Reserved.</p>
            <p>Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of <b>InMediaRes Productions, LLC.</b></p>

            <p class="lp-foot"><i>Concerns about assets used in this project may be directed to the BCE maintainer, and —
                for MegaMek data — to the MegaMek Team at megamekteam&#64;gmail.com.</i></p>
        </div>
    `,
    styles: [`
        .lp { max-width:760px; margin:0 auto; padding:28px 20px 72px; color:#1a1407; background:#f4ecd8; min-height:100vh;
            font:15px/1.6 var(--type, system-ui), Segoe UI, Roboto, sans-serif; box-sizing:border-box; }
        .lp-back { background:none; border:1.4px solid #7a2d1e; color:#7a2d1e; border-radius:4px; padding:6px 12px;
            font-weight:600; letter-spacing:.04em; cursor:pointer; margin-bottom:18px; }
        .lp-back:hover, .lp-back:focus-visible { background:#7a2d1e; color:#f4ecd8; outline:none; }
        .lp h1 { font-size:22px; line-height:1.25; margin:0 0 14px; }
        .lp h2 { font-size:16px; margin:26px 0 8px; border-bottom:1px solid #cdbf9f; padding-bottom:4px; }
        .lp p { margin:8px 0; }
        .lp code { font-family:var(--mono, ui-monospace), monospace; font-size:13px; background:#e6dcc2; padding:1px 5px; border-radius:3px; }
        .lp a { color:#7a2d1e; }
        .lp blockquote { margin:10px 0; padding:10px 14px; border-left:3px solid #c79a3a; background:#efe6cd; }
        .lp blockquote p { margin:6px 0; font-size:14px; }
        .lp-lead { font-size:15.5px; }
        .lp-offer { border:1px dashed #7a2d1e; padding:10px 12px; background:#efe6cd; }
        .lp-foot { margin-top:24px; color:#5a4d2f; font-size:13.5px; }
    `],
})
export class LegalPageComponent {
    private readonly location = inject(Location);
    protected back(): void { this.location.back(); }
}
