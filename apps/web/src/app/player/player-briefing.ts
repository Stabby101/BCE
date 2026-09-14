/*
 * BCE PLAYER — the BRIEFING card (DIRECTIVE-048 phase C). The player's read-only mission brief, rendered
 * from the PERSISTED MissionSpec ALONE (objectives/terrain/OpFor/deployment/victory/window/slots + the
 * optional D-035 theater + comms) — NOT the GM MissionPackageComponent (which pulls the narrator + the
 * costs/gates/accept machinery, out of D-048 scope), so the player bundle stays off that graph (DATA-003:
 * prose from the record). A "Print my brief" button isolates this card (ViewEncapsulation.None + @media
 * print, the D-025 pattern) so a player can take a paper copy to the table. Shown inside the overlay shell.
 *
 * DIRECTIVE-117 — Hot Spots: when the campaign runs the Chaos/Hot Spots system, the brief renders the rulebook
 * FIVE-PART TRACK layout (name → italic blurb → GAME SETUP → OBJECTIVES w/ VP → SPECIAL RULES incl. Track End +
 * Salvage + the standing track rules) from the record + the additive spec.forge fields bound at generation, then
 * the same player addendum (deployment · window · comms). Traditional stays byte-identical (the @else branch).
 */
import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, inject, input } from '@angular/core';
import type { MissionSpec } from '../campaign/mission/mission-spec';
import { NewCampaignState } from '../campaign/new-campaign-state';
import { trackArchetypeForSpec, templateTrackEnd, playerRoleLabel, opposingRoleLabel, TRACK_VP, SALVAGE_POLICY_LABEL, type TrackArchetype } from '../campaign/chaos/track-setup'; // IMPORT-6 Part E — picked-template-aware
import { CHAOS_STANDING_RULES } from '../campaign/chaos/chaos-complications';

@Component({
    selector: 'bce-player-briefing',
    changeDetection: ChangeDetectionStrategy.OnPush,
    encapsulation: ViewEncapsulation.None, // the @media print rule below must reach the whole page
    template: `
        @if (phase() === 'complete') {
            <!-- PD3 P2 (PD3-11) — the contract is COMPLETE: the brief says so instead of the last track (the phase gate, shared with the pick window) -->
            <div class="pbrief pb-complete" data-testid="pb-complete"><div class="pb-tk-tag">HOT SPOT</div><p class="pb-tk-lead">Contract complete — {{ result() }}. Waiting for the GM's next contract.</p></div>
        } @else if (spec(); as s) {
            @if (isHotspots()) {
              @if (hotspotBrief(); as hb) {
                <!-- DIRECTIVE-124 — the AUTHORED premade-hotspot brief: the SAME single brief the GM deploy view shows,
                     read directly from the persisted forge.hotspot (no slot-fill). One version, both surfaces. -->
                <div class="pbrief pb-track pb-hs">
                    <div class="pb-tk-tag">HOT SPOT</div>
                    <div class="pb-tk-name">{{ hb.trackName }}</div>
                    <div class="pb-sub pb-tk-meta">{{ hb.world }} · {{ hb.employer }} · {{ hb.type }}</div>
                    @if (sysProfileRows().length) {
                        <section class="pb-sec"><h4>System Profile — {{ hb.world }}</h4>
                            <div class="pb-hs-sys">@for (r of sysProfileRows(); track r.label) { <div class="pb-hs-kv"><span>{{ r.label }}</span><b>{{ r.value }}</b></div> }</div>
                        </section>
                    }
                    <section class="pb-sec"><h4>Situation</h4>
                        <p>{{ hb.situation }}</p>
                        <p class="pb-tk-blurb">{{ hb.trackSituation }}</p>
                    </section>
                    <section class="pb-sec"><h4>Objectives</h4>
                        @for (o of hb.objectives; track $index) {
                            <div class="pb-tk-obj"><span class="pb-tk-olabel">{{ o.kind }}</span><span class="pb-tk-otext">{{ o.text }}@if (o.side) {  <span class="pb-dim">({{ o.side }})</span> }</span><span class="pb-tk-ovp">[{{ o.vp }}]</span></div>
                        }
                    </section>
                    <section class="pb-sec"><h4>Special Rules</h4>
                        @if (hb.templateRules) { <p class="pb-tk-rule"><b>Template.</b> {{ hb.templateRules }}</p> }
                        @if (hb.specialRules) { <p class="pb-tk-rule"><b>This track.</b> {{ hb.specialRules }}</p> }
                        <!-- IMPORT-6 Part E — same blank-field fallbacks as the GM Full Package (one brief, both surfaces) -->
                        <p class="pb-tk-rule"><b>Track End.</b> {{ hb.trackEnd || templateTrackEnd(hb.trackTemplate) }}</p>
                        <p class="pb-tk-rule"><b>Salvage.</b> {{ hb.salvagePolicy || '—' }}</p>
                    </section>
                    <section class="pb-sec"><h4>Briefing</h4>
                        <p class="pb-tk-rule"><b>Contract victory.</b> {{ hb.contractVictory }}</p>
                        @if (hb.tally) { <p class="pb-tk-rule"><b>Tally.</b> {{ hb.tally }}</p> }
                        @if (hb.bonus) { <p class="pb-tk-rule"><b>Bonus.</b> {{ hb.bonus }}</p> }
                        @if (hb.constraints) { <p class="pb-tk-rule"><b>Constraints.</b> {{ hb.constraints }}</p> }
                        <!-- IMPORT-7 Part D — authored requirements as provenance + the live signed Scale (mirrors the GM package) -->
                        @if (hb.additionalRequirements) { <p class="pb-tk-rule"><b>Requirements@if (hb.authoredScale) { (authored at Track Scale {{ hb.authoredScale }})}.</b> {{ hb.additionalRequirements }}@if (hb.authoredScale && hb.signedScale && hb.signedScale !== hb.authoredScale) { <span class="pb-dim"> · Signed at Scale {{ hb.signedScale }} — the scale-dependent figures are the author's for Scale {{ hb.authoredScale }}.</span> }</p> }
                        @if (hb.purchaseOptions) { <p class="pb-tk-rule"><b>Purchases.</b> {{ hb.purchaseOptions }}</p> }
                        @if (hb.complications.length) {
                            <p class="pb-dim pb-tk-lead">Complications:</p>
                            @for (c of hb.complications; track $index) { <div class="pb-tk-obj"><span class="pb-tk-olabel">{{ c.roll }}</span><span class="pb-tk-otext">{{ c.effect }}</span></div> }
                        }
                        @if (hb.namedCharacters?.length) {
                            <p class="pb-dim pb-tk-lead">Named characters:</p>
                            @for (n of hb.namedCharacters; track $index) { <p class="pb-tk-rule"><b>{{ n.name }}</b> — {{ n.role }}@if (n.chassis) { · {{ n.chassis }} }@if (n.skill) { · {{ n.skill }} }</p> }
                        }
                        <!-- IMPORT-6 FOLLOWUPS — RESULTS ONLY: the special personnel actually HIRED and fielding with you (persisted
                             forge.hiredWithYou); the hire OFFERS (hb.hireable) are never rendered player-side. -->
                        @if (hiredWithYou().length) {
                            <p class="pb-dim pb-tk-lead" data-testid="pb-hired-lead">Special personnel fielding with you:</p>
                            @for (m of hiredWithYou(); track $index) { <p class="pb-tk-rule" data-testid="pb-hired-row"><b>{{ m.name }}</b>@if (m.role) { — {{ m.role }} }@if (m.chassis) { · {{ m.chassis }} {{ m.model || '' }} } · G {{ m.gunnery }} / P {{ m.piloting }}</p> }
                        }
                    </section>
                    <div class="pb-grid">
                        <div><h4>Your deployment</h4><p>{{ s.deployment.player }}</p></div>
                        <div><h4>Hostile posture</h4><p>{{ s.deployment.opfor }}</p></div>
                    </div>
                    <section class="pb-sec pb-window"><h4>Window</h4>
                        <p>Deploy by ~{{ s.window.deployByDays }}d · engagement ~{{ s.window.engagementDays }}d@if (s.window.note) { · {{ s.window.note }} }</p>
                    </section>
                    <button type="button" class="pb-print pb-noprint" (click)="print()">Print my brief</button>
                </div>
              } @else if (track(); as t) {
                <!-- DIRECTIVE-117 — the Hot Spots TRACK: the rulebook five-part layout, then the player addendum. -->
                <div class="pbrief pb-track">
                    <div class="pb-tk-tag">TRACK</div>
                    <div class="pb-tk-name">{{ t.name }}</div>
                    <div class="pb-sub pb-tk-meta">{{ t.meta }}</div>
                    @if (t.blurb) { <p class="pb-tk-blurb">{{ t.blurb }}</p> }

                    <section class="pb-sec">
                        <h4>Game Setup</h4>
                        <p>{{ t.setupText }}</p>
                        @if (t.terrain) { <p class="pb-tk-terrain">Terrain — {{ t.terrain }}</p> }
                        @for (sd of t.sides; track sd.role) {
                            <div class="pb-tk-side" [class.mine]="sd.isPlayer">
                                <div class="pb-tk-role">{{ sd.role }}@if (sd.isPlayer) { <span class="pb-tk-you">— you</span> }</div>
                                <p>{{ sd.text }}</p>
                                @if (sd.extra) { <p class="pb-dim">{{ sd.extra }}</p> }
                            </div>
                        }
                    </section>

                    <section class="pb-sec">
                        <h4>Objectives</h4>
                        @for (o of t.objectives; track $index) {
                            <div class="pb-tk-obj"><span class="pb-tk-olabel">{{ o.label }}</span><span class="pb-tk-otext">{{ o.text }}</span><span class="pb-tk-ovp">[{{ o.vp }}]</span></div>
                        }
                    </section>

                    <section class="pb-sec">
                        <h4>Special Rules</h4>
                        <p class="pb-dim pb-tk-lead">The following rules are in effect for this track:</p>
                        @for (cx of t.complications; track cx.name) {
                            <p class="pb-tk-rule"><b>{{ cx.name }}.</b> {{ cx.effect || cx.text }}</p>
                        }
                        <!-- IMPORT-6 Part C/E — a preset's authored special rules line (mirrors the GM sheet) -->
                        @if (t.specialRules) { <p class="pb-tk-rule"><b>Special Rules.</b> {{ t.specialRules }}</p> }
                        <p class="pb-tk-rule"><b>Track End.</b> {{ t.trackEnd }}</p>
                        <p class="pb-tk-rule"><b>Salvage.</b> {{ t.salvage }}</p>
                    </section>

                    <section class="pb-sec">
                        <h4>Standing Track Rules</h4>
                        @for (r of t.standingRules; track r.name) {
                            <p class="pb-tk-rule"><b>{{ r.name }}.</b> {{ r.text }}</p>
                        }
                    </section>

                    <!-- IMPORT-6 FOLLOWUPS — RESULTS ONLY: special personnel actually fielding with you (persisted forge.hiredWithYou). -->
                    @if (hiredWithYou().length) {
                        <section class="pb-sec">
                            <h4>Special personnel fielding with you</h4>
                            @for (m of hiredWithYou(); track $index) { <p class="pb-tk-rule" data-testid="pb-hired-row"><b>{{ m.name }}</b>@if (m.role) { — {{ m.role }} }@if (m.chassis) { · {{ m.chassis }} {{ m.model || '' }} } · G {{ m.gunnery }} / P {{ m.piloting }}</p> }
                        </section>
                    }

                    <!-- IMPORT-6 Part E — deployment lines from the same rule as the GM sheet (a preset's authored line wins;
                         the contract type's lines only while the rendered template IS the contract type's) -->
                    @if (t.deployment.player || t.deployment.opfor) {
                    <div class="pb-grid">
                        @if (t.deployment.player) { <div><h4>Your deployment</h4><p>{{ t.deployment.player }}</p></div> }
                        @if (t.deployment.opfor) { <div><h4>Hostile posture</h4><p>{{ t.deployment.opfor }}</p></div> }
                    </div>
                    }

                    <section class="pb-sec pb-window">
                        <h4>Window</h4>
                        <p>Deploy by ~{{ s.window.deployByDays }}d · engagement ~{{ s.window.engagementDays }}d@if (s.window.note) { · {{ s.window.note }} }</p>
                    </section>

                    @if (s.comms; as c) {
                        <section class="pb-sec">
                            <h4>Comms</h4>
                            <table class="pb-cw">@for (cw of c.codewords; track $index) { <tr><td class="pb-word">{{ cw.word }}</td><td>{{ cw.meaning }}</td></tr> }</table>
                            @for (e of c.emergency; track $index) { <p class="pb-emer">{{ e }}</p> }
                        </section>
                    }

                    <button type="button" class="pb-print pb-noprint" (click)="print()">Print my brief</button>
                </div>
            } } @else {
                <div class="pbrief">
                    <div class="pb-warn">
                        <span class="pb-emp">{{ slot(s, 'EMPLOYER') }}</span>
                        <span class="pb-vs">vs</span>
                        <span class="pb-tgt">{{ slot(s, 'TARGET_FACTION') }}</span>
                    </div>
                    <div class="pb-sub">{{ s.typeName }} · {{ slot(s, 'WORLD') }} · {{ slot(s, 'YEAR') }}</div>

                    @if (occupation(); as occ) { <p class="pb-occ">{{ occ }}</p> }

                    <section class="pb-sec">
                        <h4>Objectives</h4>
                        <ol class="pb-obj">@for (o of s.objectives; track $index) { <li>{{ o }}</li> }</ol>
                    </section>

                    <div class="pb-grid">
                        <div><h4>Terrain</h4><p>{{ s.terrain.biome }}@if (s.terrain.note) { — {{ s.terrain.note }} }</p></div>
                        <div><h4>Opposition</h4><p>{{ s.opforForce.length }} units · {{ fmt(s.opforBv) }} BV <span class="pb-dim">(your force ~{{ fmt(s.playerBv) }} BV)</span></p></div>
                        <div><h4>Your deployment</h4><p>{{ s.deployment.player }}</p></div>
                        <div><h4>Hostile posture</h4><p>{{ s.deployment.opfor }}</p></div>
                    </div>

                    <section class="pb-sec">
                        <h4>Victory conditions</h4>
                        <ul class="pb-vc">@for (v of s.victoryConditions; track $index) { <li>{{ v }}</li> }</ul>
                    </section>

                    <section class="pb-sec pb-window">
                        <h4>Window</h4>
                        <p>Deploy by ~{{ s.window.deployByDays }}d · engagement ~{{ s.window.engagementDays }}d@if (s.window.note) { · {{ s.window.note }} }</p>
                    </section>

                    @if (s.comms; as c) {
                        <section class="pb-sec">
                            <h4>Comms</h4>
                            <table class="pb-cw">@for (cw of c.codewords; track $index) { <tr><td class="pb-word">{{ cw.word }}</td><td>{{ cw.meaning }}</td></tr> }</table>
                            @for (e of c.emergency; track $index) { <p class="pb-emer">{{ e }}</p> }
                        </section>
                    }

                    <button type="button" class="pb-print pb-noprint" (click)="print()">Print my brief</button>
                </div>
            }
        } @else {
            <p class="pb-none">No active mission to brief.</p>
        }
    `,
    styles: [`
        .pbrief { color: #e7edf3; }
        .pb-warn { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; font-weight: 800; letter-spacing: .04em; font-size: 18px; }
        .pb-emp { color: #bcd6f2; } .pb-tgt { color: #f2c4bc; } .pb-vs { color: #6b7682; font-size: 13px; font-weight: 400; }
        .pb-sub { color: #9fb2c4; font-size: 13px; margin: 4px 0 14px; }
        .pb-occ { color: #b9c6d4; font-style: italic; border-left: 3px solid #2a3340; padding-left: 12px; margin: 0 0 14px; }
        .pb-sec { margin: 14px 0; }
        .pbrief h4 { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: #7f8a96; margin: 0 0 6px; }
        .pb-obj, .pb-vc { margin: 0; padding-left: 20px; } .pb-obj li, .pb-vc li { margin: 3px 0; }
        .pb-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 16px; margin: 14px 0; }
        .pb-grid p { margin: 0; } .pb-dim { color: #7f8a96; }
        .pb-cw { width: 100%; border-collapse: collapse; font-size: 13px; }
        .pb-cw td { border-bottom: 1px solid #232c37; padding: 4px 6px; } .pb-word { font-weight: 700; color: #bcd6f2; white-space: nowrap; }
        .pb-emer { font-size: 12px; color: #e7a86b; margin: 4px 0 0; }
        .pb-print { margin-top: 16px; background: #2f5a6b; color: #fff; border: none; border-radius: 9px; padding: 12px 18px; font-size: 14px; font-weight: 700; cursor: pointer; }
        .pb-none { color: #7f8a96; font-style: italic; }
        /* DIRECTIVE-117 — Hot Spots TRACK layout (phone-formatted; scrolls inside the overlay shell). */
        .pb-tk-tag { text-align: center; letter-spacing: .3em; font-weight: 800; font-size: 12px; color: #8fb0cf; margin-bottom: 8px; }
        .pb-tk-name { text-align: center; font-weight: 800; font-size: 20px; letter-spacing: .03em; text-transform: uppercase; }
        .pb-tk-meta { text-align: center; }
        .pb-tk-blurb { font-style: italic; color: #b9c6d4; text-align: center; margin: 10px 0 16px; white-space: pre-line; } /* HOTSPOT-BRIEF v1 Amendment A */
        .pb-sec p { white-space: pre-line; } /* HOTSPOT-BRIEF v1 Amendment A — the Situation paragraphs render */
        .pb-tk-terrain { color: #9fb2c4; margin: 4px 0 10px; }
        .pb-tk-side { border-left: 3px solid #2a3340; background: #141a22; padding: 8px 12px; margin: 8px 0; border-radius: 6px; }
        .pb-tk-side.mine { border-left-color: #2f5a6b; }
        .pb-tk-role { font-weight: 700; letter-spacing: .08em; font-size: 12px; text-transform: uppercase; color: #bcd6f2; margin-bottom: 3px; }
        .pb-tk-you { color: #8fb0cf; font-weight: 400; letter-spacing: .02em; }
        .pb-tk-side p { margin: 0 0 4px; }
        .pb-tk-obj { display: grid; grid-template-columns: 84px 1fr auto; gap: 8px; padding: 5px 0; align-items: baseline; border-bottom: 1px solid #1c242e; }
        .pb-tk-olabel { font-weight: 700; text-transform: uppercase; font-size: 11px; letter-spacing: .06em; color: #9fb2c4; }
        .pb-tk-ovp { font-weight: 800; color: #8fb0cf; }
        .pb-tk-lead { font-style: italic; margin: 0 0 6px; }
        .pb-tk-rule { margin: 5px 0; line-height: 1.5; } .pb-tk-rule b { color: #cdd8e3; }
        /* DIRECTIVE-124 — the authored hotspot system-profile grid (player) */
        .pb-hs-sys { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 14px; }
        .pb-hs-kv { display: flex; justify-content: space-between; gap: 8px; border-bottom: 1px solid #1c242e; padding: 2px 0; font-size: 12.5px; }
        .pb-hs-kv span { color: #7f8a96; text-transform: uppercase; letter-spacing: .03em; font-size: 10px; }
        .pb-hs-kv b { color: #cdd8e3; }
        @media print {
            body * { visibility: hidden !important; }
            .pbrief, .pbrief * { visibility: visible !important; color: #000 !important; }
            .pbrief { position: fixed !important; inset: 0 !important; margin: 0 !important; padding: 18px 18px calc(18px + var(--bce-footer-h, 0px)) !important; /* IMPORT-7 A — clear the legal footer */
                      background: #fff !important; max-height: none !important; overflow: visible !important; }
            .pb-emp, .pb-tgt, .pb-word { color: #000 !important; }
            .pb-occ, .pb-tk-side { border-left-color: #000 !important; }
            .pb-noprint { display: none !important; }
        }
    `],
})
export class PlayerBriefingComponent {
    private readonly state = inject(NewCampaignState);
    readonly spec = input<MissionSpec | null>(null);
    /** PD3 P2 — the session phase (player-sheet computes it through the shared decider) + the last outcome for the terminal line. */
    readonly phase = input<'none' | 'lobby' | 'committed' | 'complete'>('none');
    readonly result = input<string>('resolved');

    protected readonly occupation = computed(() => this.spec()?.theater?.occupation || null);
    protected readonly isHotspots = computed(() => this.state.campaignSystem() === 'hotspots');

    // ── DIRECTIVE-124 — the authored premade-hotspot brief (the SAME single brief the GM shows; read from the
    //    persisted forge.hotspot). Its presence renders the authored layout instead of the D-117 generic track. ──
    protected readonly hotspotBrief = computed(() => this.spec()?.forge?.hotspot ?? null);
    /** IMPORT-6 FOLLOWUPS — RESULTS ONLY: the special personnel actually fielded (persisted forge.hiredWithYou); never the offers. */
    protected readonly hiredWithYou = computed(() => this.spec()?.forge?.hiredWithYou ?? []);
    protected readonly sysProfileRows = computed(() => {
        const sp = this.hotspotBrief()?.systemProfile;
        if (!sp) return [] as { label: string; value: string }[];
        const rows: [string, unknown][] = [
            ['Star', sp.starType], ['Recharge', sp.rechargeHours != null ? `${sp.rechargeHours} h` : undefined],
            ['Position', sp.positionInSystem], ['Jump point', sp.timeToJumpPointDays != null ? `${sp.timeToJumpPointDays} d` : undefined],
            ['Gravity', sp.surfaceGravity != null ? `${sp.surfaceGravity} g` : undefined], ['Atmosphere', sp.atmPressure],
            ['Climate', sp.climate], ['Water', sp.surfaceWaterPct != null ? `${sp.surfaceWaterPct}%` : undefined],
            ['HPG', sp.hpgClass], ['Population', sp.population != null ? sp.population.toLocaleString('en-US') : undefined],
            ['Socio-industrial', sp.socioIndustrial], ['Capital', sp.capitalCity],
        ];
        return rows.filter(([, v]) => v != null && v !== '').map(([label, v]) => ({ label, value: String(v) }));
    });

    /** DIRECTIVE-117 — the Hot Spots TRACK view-model, rendered from the persisted spec + additive forge fields
     *  ALONE (no seed/pack access). Book layout is the static track-setup archetype keyed by the mission family. */
    protected readonly track = computed(() => {
        const s = this.spec();
        if (!s) return null;
        const sheet = s.forge?.trackSheet; // IMPORT-6 Part C/E — a preset's authored sheet overrides (else the archetype)
        const arch = trackArchetypeForSpec(s.forge?.trackTemplate, s.type, sheet?.playerRole); // IMPORT-6 Part E — a picked §18 template / authored role wins over the contract type (value-identical otherwise)
        const attacker = arch.playerSide === 'attacker';
        const forceSize = s.forge?.slots?.FORCE_SIZE || '';
        // Deployment lines: the preset's authored line wins; the contract type's lines only while the rendered template IS
        // the contract type's (mirrors mission-package.track()).
        const deployment = sheet?.deployment
            ? { player: sheet.deployment, opfor: '' }
            : arch.templateKey === trackArchetypeForSpec(undefined, s.type).templateKey ? s.deployment : { player: '', opfor: '' };
        // IMPORT-6 Part B/C — a preset track's FULL authored objective list (persisted at bind) — every objective + its VP,
        // the same list the GM resolves against; else the three generic slots as before.
        const authored = s.forge?.trackObjectives ?? [];
        const playerBlock = {
            role: playerRoleLabel(arch), text: attacker ? arch.attackerText : arch.defenderText,
            extra: forceSize ? `Your force — ${forceSize}; ${this.fmt(s.playerBv)} BV committed.` : `Your force — ${this.fmt(s.playerBv)} BV committed.`,
            isPlayer: true,
        };
        const opposingBlock = { role: opposingRoleLabel(arch), text: attacker ? arch.defenderText : arch.attackerText, extra: this.opforSummary(s), isPlayer: false };
        return {
            name: s.forge?.opName || s.typeName,
            meta: `${s.typeName} · ${this.slot(s, 'WORLD')} · ${this.slot(s, 'YEAR')}`,
            blurb: s.forge?.situationLead || '',
            setupText: arch.setupText,
            terrain: s.terrain?.biome ? (s.terrain.note ? `${s.terrain.biome} — ${s.terrain.note}` : s.terrain.biome) : '',
            sides: attacker ? [opposingBlock, playerBlock] : [playerBlock, opposingBlock], // book order: DEFENDER then ATTACKER
            objectives: authored.length
                ? authored.map((o) => ({ label: o.kind.charAt(0).toUpperCase() + o.kind.slice(1), text: o.text, vp: o.vp }))
                : (s.objectives ?? []).map((text, i) => ({ label: this.vpLabel(i), text, vp: this.objVp(s, i) })),
            complications: s.forge?.trackComplications ?? [],
            specialRules: sheet?.specialRules ?? '', // IMPORT-6 Part C/E
            trackEnd: sheet?.trackEnd || arch.trackEndText,
            salvage: this.salvageSentence(s, arch, sheet?.salvagePolicy),
            standingRules: CHAOS_STANDING_RULES,
            deployment,
        };
    });

    private opforSummary(s: MissionSpec): string {
        const f = s.opforForce ?? [];
        if (!f.length) return '';
        const veh = f.filter((u) => u.unitType === 'vehicle').length;
        const mechs = f.length - veh;
        const parts = [`${mechs} BattleMech${mechs === 1 ? '' : 's'}`];
        if (veh) parts.push(`${veh} combat vehicle${veh === 1 ? '' : 's'}`);
        return `Assessed order of battle — ${parts.join(' and ')} (${f.length} units, ${this.fmt(s.opforBv)} BV).`;
    }
    private vpLabel(i: number): string { return i === 0 ? 'Primary' : i === 1 ? 'Secondary' : 'Bonus'; }
    private objVp(s: MissionSpec, i: number): number {
        const vp = s.forge?.objectiveVp;
        if (i === 0) return vp?.primary ?? TRACK_VP.primary;
        if (i === 1) return vp?.secondary ?? TRACK_VP.secondary;
        return vp?.bonus ?? TRACK_VP.bonus;
    }
    private salvageSentence(s: MissionSpec, arch: TrackArchetype, authoredPolicy?: string): string {
        const cl = s.clauses;
        const pctPart = cl.salvageExchange
            ? `Salvage exchange in effect — recovered materiel converts to a ${cl.salvagePct}% cash bonus rather than kept units`
            : `Your command retains ${cl.salvagePct}% of recovered materiel under the contract's negotiated terms`;
        // IMPORT-6 Part C/E — a preset's authored salvage policy replaces the template default (mirrors the GM sheet).
        return `${pctPart}. ${authoredPolicy ? `Track policy: ${authoredPolicy.replace(/\.$/, '')}.` : `Track default: ${SALVAGE_POLICY_LABEL[arch.salvagePolicy]}.`}`;
    }
    protected readonly templateTrackEnd = templateTrackEnd; // IMPORT-6 Part E — template-aware Track End fallback for a blank authored field

    protected slot(s: MissionSpec, key: 'EMPLOYER' | 'TARGET_FACTION' | 'WORLD' | 'YEAR'): string {
        return s.forge?.slots?.[key] || '—';
    }
    protected fmt(n: number): string {
        return (n ?? 0).toLocaleString('en-US');
    }
    protected print(): void {
        try { window.print(); } catch { /* print unavailable */ }
    }
}
