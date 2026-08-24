/*
 * BCE — custom-hotspot authoring. DIRECTIVE-124 shipped the JSON import/export; DIRECTIVE-IMPORT-1 extends it
 * into a private homebrew/owned-content importer with THREE ways in, one review surface:
 *   B1 — a manual field-by-field FORM (the HotSpot shape: identity + contract terms + repeatable tracks);
 *   B2 — PASTE-and-parse: a "Paste your mission text" box parses (lenient, §16 label map) → pre-fills the form
 *        (never blind-saves; the GM reviews + corrects, then saves);
 *   B3 — JSON import + a downloadable template (the power-user path; Export still round-trips to JSON).
 * Saving is STRICT (needs a title + a root track with an objective); the parser is lenient (pre-fill only).
 *
 * GATE (IMPORT-1 Part A): the whole panel is hidden for GUEST accounts (a nudge to sign in with Google shows
 * instead); the server is the authoritative gate (a guest campaign-save carrying custom hotspots is 403'd —
 * see campaigns/custom-hotspot-gate.ts). When auth is off (dev/LAN) there is no guest tier → the panel shows.
 *
 * The draft/JSON state lives in HotspotIoState, PROVIDED ON THE TAB — the original signals' lifetime: it
 * survives the active-contract ↔ offer-board branch flip (sign → back out keeps your draft) and dies with the
 * tab. The parent's per-card Export button drives exportHotspot() through a viewChild ref.
 */
import { Component, ChangeDetectionStrategy, Injectable, computed, inject, signal } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { CampaignSaveStore } from '../campaign-save-store';
import { AuthService } from '../../auth/auth.service'; // IMPORT-1 — the guest gate (panel hidden for guests)
import type { HotSpot, HotSpotHireable } from './hotspots-catalog';
import { validStepOptions, snapValidStep, CONTRACT_COLUMNS, type ContractColumn } from './chaos-contract-steps'; // IMPORT-5 Part D — valid-step dropdown options; HSFORGE-1 rider — snap imported steps
import {
    type HotSpotDraft, type DraftSide, type DraftHireable,
    emptyDraft, emptyTrack, emptyHireable, parseHotspotText, draftToHotSpot, validateDraft, oppositeRole,
} from './hotspot-text-parser';
import { TrackEditorComponent, type TrackUpdater } from './track-editor'; // IMPORT-6 Part C — the ONE shared per-track editor (also mounted by the D-116 preset builder)

/** HSFORGE-1 rider (1) — the JSON-IMPORT path never snapped contract steps (only the form builder did,
 *  via draftToHotSpot), so a pasted hotspot could land on dead `—` rows (blank, non-negotiable transport —
 *  the exact IMPORT-5 Part D bug class). Snap every steps column on the top-level contract AND each
 *  authored side. Idempotent for already-valid indices (exports/authored packs re-import byte-identical). */
export function snapImportedSteps(h: HotSpot): HotSpot {
    const snap = (steps: Record<ContractColumn, number>): Record<ContractColumn, number> => {
        const out = { ...steps };
        for (const col of CONTRACT_COLUMNS) out[col] = snapValidStep(col, Number(out[col] ?? 0));
        return out;
    };
    const fixSide = <S extends { contract?: { steps?: Record<ContractColumn, number> } }>(s: S | undefined): S | undefined =>
        s?.contract?.steps ? { ...s, contract: { ...s.contract, steps: snap(s.contract.steps) } } : s;
    return {
        ...h,
        ...(h.contract?.steps ? { contract: { ...h.contract, steps: snap(h.contract.steps) } } : {}),
        ...(h.sides ? { sides: { a: fixSide(h.sides.a) ?? h.sides.a, b: fixSide(h.sides.b) ?? h.sides.b } } : {}),
    };
}

type IoMode = 'form' | 'paste' | 'json';

/** The I/O panel's draft state — provided by the TAB component (original lifetime), injected by the panel. */
@Injectable()
export class HotspotIoState {
    readonly ioOpen = signal<boolean>(false);
    readonly ioText = signal<string>('');
    readonly ioMsg = signal<string>('');
    // IMPORT-1 — the form draft + active input mode + paste buffer (survive the branch flip like ioText).
    readonly mode = signal<IoMode>('form');
    readonly draft = signal<HotSpotDraft>(emptyDraft());
    readonly pasteText = signal<string>('');
}

@Component({
    selector: 'bce-hotspot-io',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [TrackEditorComponent], // IMPORT-6 Part C
    template: `
        <button type="button" class="cc-btn ghost small" (click)="toggleIo()">{{ ioOpen() ? 'Hide' : '＋ Import / author a hotspot' }}</button>
        @if (ioOpen()) {
            @if (blockedGuest()) {
                <div class="hi-nudge">
                    <b>Sign in with Google to import your own missions.</b>
                    <span>Guest campaigns can't save custom missions — they're tied to a signed-in account.</span>
                </div>
            } @else {
                <p class="hi-rights">Import only content you have the right to use. Imported missions are private to your campaign.</p>
                <div class="hi-modes">
                    <button type="button" class="cc-btn small" [class.go]="mode() === 'form'" (click)="setMode('form')">Fill a form</button>
                    <button type="button" class="cc-btn small" [class.go]="mode() === 'paste'" (click)="setMode('paste')">Paste mission text</button>
                    <button type="button" class="cc-btn small" [class.go]="mode() === 'json'" (click)="setMode('json')">JSON</button>
                </div>

                @switch (mode()) {
                    @case ('paste') {
                        <textarea class="cc-io-ta" [value]="pasteText()" (input)="pasteText.set($any($event.target).value)" rows="8"
                            placeholder="Paste your mission text here. We'll recognise the labelled sections (Employer, Type, Length, Base Pay/Support/…, Situation, Attacker/Defender, Objectives + VP, Special Rules, Track End, Salvage) and pre-fill the form for you to review."></textarea>
                        <div class="cc-hs-acts">
                            <button type="button" class="cc-btn small go" (click)="parsePaste()">Parse → fill the form</button>
                            @if (ioMsg()) { <span class="cc-io-msg">{{ ioMsg() }}</span> }
                        </div>
                    }
                    @case ('json') {
                        <textarea class="cc-io-ta" [value]="ioText()" (input)="ioText.set($any($event.target).value)" rows="7"
                            placeholder="Paste a hotspot JSON (or Export one above, edit, and paste it back)…"></textarea>
                        <div class="cc-hs-acts">
                            <button type="button" class="cc-btn small go" (click)="importHotspot()">Import JSON</button>
                            <button type="button" class="cc-btn small" (click)="downloadTemplate()">Download a template</button>
                            @if (ioMsg()) { <span class="cc-io-msg">{{ ioMsg() }}</span> }
                        </div>
                    }
                    @default {
                        <!-- B1 — the manual form (the review surface the paste-parser also fills) -->
                        <div class="hi-form">
                            <!-- IMPORT-4 — single offer vs two opposing offers (opposed-pair). Two-sided reveals the A/B panels below. -->
                            <label class="hi-tog"><input type="checkbox" [checked]="d().twoSided" (change)="setTwoSided($event)" data-testid="cc-two-sided"> Two opposing offers (opposed-pair contract)</label>
                            <!-- IMPORT-5 Part E — SHARED across both sides: World, Intensity, Length (one hot spot, one world).
                                 Title/Type/Employer-desc/Situation are PER-SIDE in two-sided mode (each employer frames the op). -->
                            <div class="hi-grid">
                                @if (!d().twoSided) {
                                    <label>Title<input class="hi-in" [value]="d().title" (input)="setStr('title', $event)" placeholder="Operation name"></label>
                                }
                                <label>World<input class="hi-in" [value]="d().world" (input)="setStr('world', $event)" placeholder="Planet / system"></label>
                                @if (!d().twoSided) {
                                    <label>Employer<input class="hi-in" [value]="d().employer" (input)="setStr('employer', $event)"></label>
                                    <label>Enemy faction<input class="hi-in" [value]="d().enemyFaction" (input)="setStr('enemyFaction', $event)"></label>
                                    <label>Type<input class="hi-in" [value]="d().type" (input)="setStr('type', $event)" placeholder="Objective Raid"></label>
                                }
                                <label>Intensity (tracks)<input class="hi-in" type="number" min="1" [value]="d().intensity" (input)="setNum('intensity', $event)"></label>
                                <label>Length (months)<input class="hi-in" type="number" min="1" [value]="d().lengthMonths" (input)="setNum('lengthMonths', $event)"></label>
                            </div>
                            @if (!d().twoSided) {
                                <label class="hi-wide">Summary / teaser<input class="hi-in" [value]="d().blurb" (input)="setStr('blurb', $event)"></label>
                                <label class="hi-wide">Employer description<textarea class="hi-ta" rows="2" [value]="d().employerDesc" (input)="setStr('employerDesc', $event)" placeholder="Who the employer is — their nature, aims, reputation (free text)."></textarea></label>
                                <label class="hi-wide">Situation<textarea class="hi-ta" rows="2" [value]="d().situation" (input)="setStr('situation', $event)"></textarea></label>
                            }

                            <div class="hi-sec">Planet / hot-spot detail <span class="hi-opt">(optional — shared across both sides)</span></div>
                            <div class="hi-grid">
                                <label>Star type<input class="hi-in" [value]="d().starType" (input)="setStr('starType', $event)" placeholder="e.g. G2V"></label>
                                <label>Position in system<input class="hi-in" [value]="d().positionInSystem" (input)="setStr('positionInSystem', $event)" placeholder="e.g. 3rd"></label>
                                <label>Surface gravity<input class="hi-in" [value]="d().surfaceGravity" (input)="setStr('surfaceGravity', $event)" placeholder="e.g. 1.0"></label>
                                <label>Atmosphere<input class="hi-in" [value]="d().atmPressure" (input)="setStr('atmPressure', $event)" placeholder="e.g. Breathable"></label>
                                <label>Mean temp (°C)<input class="hi-in" type="number" [value]="d().equatorialTempC" (input)="setStr('equatorialTempC', $event)" placeholder="e.g. 30"></label>
                                <label>Climate<input class="hi-in" [value]="d().climate" (input)="setStr('climate', $event)"></label>
                                <label>Surface water (%)<input class="hi-in" type="number" [value]="d().surfaceWaterPct" (input)="setStr('surfaceWaterPct', $event)" placeholder="e.g. 70"></label>
                                <label>Satellites<input class="hi-in" [value]="d().satellites" (input)="setStr('satellites', $event)" placeholder="e.g. 2 (Luna, Diana)"></label>
                                <label>HPG class<input class="hi-in" [value]="d().hpgClass" (input)="setStr('hpgClass', $event)" placeholder="e.g. B"></label>
                                <label>Socio-industrial<input class="hi-in" [value]="d().socioIndustrial" (input)="setStr('socioIndustrial', $event)" placeholder="e.g. A-B-A-B-B"></label>
                                <label>Jump-point transit (days)<input class="hi-in" type="number" [value]="d().timeToJumpPointDays" (input)="setStr('timeToJumpPointDays', $event)" placeholder="e.g. 6"></label>
                                <label>Jump-sail recharge (hrs)<input class="hi-in" type="number" [value]="d().rechargeHours" (input)="setStr('rechargeHours', $event)" placeholder="e.g. 180"></label>
                                <label>Population<input class="hi-in" [value]="d().population" (input)="setStr('population', $event)" placeholder="e.g. 2500000000"></label>
                                <label>Capital city<input class="hi-in" [value]="d().capitalCity" (input)="setStr('capitalCity', $event)"></label>
                            </div>
                            <label class="hi-wide">Planet description<textarea class="hi-ta" rows="2" [value]="d().planetDescription" (input)="setStr('planetDescription', $event)" placeholder="A few sentences of colour about the world — history, terrain, why it matters (free text)."></textarea></label>

                            @if (!d().twoSided) {
                                <!-- IMPORT-5 Part D — pick a REAL contract-terms value per column (the starting negotiation
                                     position). Dropdowns of valid steps only → transport (and command) can't land on a dead em-dash step. -->
                                <div class="hi-sec">Contract terms <span class="hi-opt">(the starting position — raise/sacrifice further at signing)</span></div>
                                <div class="hi-grid">
                                    <label>Base Pay<select class="hi-in" (change)="setNum('basePay', $event)">@for (o of stepOptions('basePay'); track o.index) { <option [value]="o.index" [selected]="o.index === d().basePay">{{ o.label }}</option> }</select></label>
                                    <label>Support<select class="hi-in" (change)="setNum('support', $event)">@for (o of stepOptions('support'); track o.index) { <option [value]="o.index" [selected]="o.index === d().support">{{ o.label }}</option> }</select></label>
                                    <label>Transport<select class="hi-in" (change)="setNum('transport', $event)">@for (o of stepOptions('transport'); track o.index) { <option [value]="o.index" [selected]="o.index === d().transport">{{ o.label }}</option> }</select></label>
                                    <label>Salvage<select class="hi-in" (change)="setNum('salvage', $event)">@for (o of stepOptions('salvage'); track o.index) { <option [value]="o.index" [selected]="o.index === d().salvage">{{ o.label }}</option> }</select></label>
                                    <label>Command<select class="hi-in" (change)="setNum('command', $event)">@for (o of stepOptions('command'); track o.index) { <option [value]="o.index" [selected]="o.index === d().command">{{ o.label }}</option> }</select></label>
                                </div>
                            } @else {
                                <!-- IMPORT-4 — two opposing offers. OpFor is DERIVED (each side faces the OTHER side's faction) — never a field. -->
                                <div class="hi-sec">Two opposing offers <span class="hi-help">objectives tagged <b>attacker</b>/<b>defender</b> score for that side; <b>both</b> = either. OpFor = the opposing side's faction (automatic).</span></div>
                                <div class="hi-track">
                                    <div class="hi-thead"><b>Side A</b> <span class="hi-opt">you play {{ d().sideA.role }} · OpFor: {{ d().sideB.faction || '(Side B faction)' }}</span></div>
                                    <div class="hi-grid">
                                        <label>Title<input class="hi-in" [value]="d().sideA.title" (input)="setSideStr('sideA', 'title', $event)" placeholder="This side's operation name"></label>
                                        <label>Type<input class="hi-in" [value]="d().sideA.type" (input)="setSideStr('sideA', 'type', $event)" placeholder="Objective Raid"></label>
                                        <label>Role
                                            <select class="hi-in" (change)="setSideRole($event)" data-testid="cc-sideA-role">
                                                <option value="attacker" [selected]="d().sideA.role === 'attacker'">Attacker</option>
                                                <option value="defender" [selected]="d().sideA.role === 'defender'">Defender</option>
                                            </select>
                                        </label>
                                        <label>Employer<input class="hi-in" [value]="d().sideA.employer" (input)="setSideStr('sideA', 'employer', $event)"></label>
                                        <label>Faction (your force)<input class="hi-in" [value]="d().sideA.faction" (input)="setSideStr('sideA', 'faction', $event)"></label>
                                    </div>
                                    <div class="hi-grid">
                                        <label>Base Pay<select class="hi-in" (change)="setSideNum('sideA', 'basePay', $event)">@for (o of stepOptions('basePay'); track o.index) { <option [value]="o.index" [selected]="o.index === d().sideA.basePay">{{ o.label }}</option> }</select></label>
                                        <label>Support<select class="hi-in" (change)="setSideNum('sideA', 'support', $event)">@for (o of stepOptions('support'); track o.index) { <option [value]="o.index" [selected]="o.index === d().sideA.support">{{ o.label }}</option> }</select></label>
                                        <label>Transport<select class="hi-in" (change)="setSideNum('sideA', 'transport', $event)">@for (o of stepOptions('transport'); track o.index) { <option [value]="o.index" [selected]="o.index === d().sideA.transport">{{ o.label }}</option> }</select></label>
                                        <label>Salvage<select class="hi-in" (change)="setSideNum('sideA', 'salvage', $event)">@for (o of stepOptions('salvage'); track o.index) { <option [value]="o.index" [selected]="o.index === d().sideA.salvage">{{ o.label }}</option> }</select></label>
                                        <label>Command<select class="hi-in" (change)="setSideNum('sideA', 'command', $event)">@for (o of stepOptions('command'); track o.index) { <option [value]="o.index" [selected]="o.index === d().sideA.command">{{ o.label }}</option> }</select></label>
                                    </div>
                                    <label class="hi-wide">Employer description (Side A)<textarea class="hi-ta" rows="2" [value]="d().sideA.employerDesc" (input)="setSideStr('sideA', 'employerDesc', $event)" placeholder="Who this employer is — their nature, aims, reputation."></textarea></label>
                                    <label class="hi-wide">Situation (Side A)<textarea class="hi-ta" rows="2" [value]="d().sideA.situation" (input)="setSideStr('sideA', 'situation', $event)" placeholder="How this employer frames the op."></textarea></label>
                                    <label class="hi-wide">Blurb (Side A)<input class="hi-in" [value]="d().sideA.blurb" (input)="setSideStr('sideA', 'blurb', $event)"></label>
                                </div>
                                <div class="hi-track">
                                    <div class="hi-thead"><b>Side B</b> <span class="hi-opt">you play {{ d().sideB.role }} (opposite of Side A) · OpFor: {{ d().sideA.faction || '(Side A faction)' }}</span></div>
                                    <div class="hi-grid">
                                        <label>Title<input class="hi-in" [value]="d().sideB.title" (input)="setSideStr('sideB', 'title', $event)" placeholder="This side's operation name"></label>
                                        <label>Type<input class="hi-in" [value]="d().sideB.type" (input)="setSideStr('sideB', 'type', $event)" placeholder="Objective Raid"></label>
                                        <label>Role<input class="hi-in" [value]="d().sideB.role" readonly title="Auto-set opposite to Side A" data-testid="cc-sideB-role"></label>
                                        <label>Employer<input class="hi-in" [value]="d().sideB.employer" (input)="setSideStr('sideB', 'employer', $event)"></label>
                                        <label>Faction (your force)<input class="hi-in" [value]="d().sideB.faction" (input)="setSideStr('sideB', 'faction', $event)"></label>
                                    </div>
                                    <div class="hi-grid">
                                        <label>Base Pay<select class="hi-in" (change)="setSideNum('sideB', 'basePay', $event)">@for (o of stepOptions('basePay'); track o.index) { <option [value]="o.index" [selected]="o.index === d().sideB.basePay">{{ o.label }}</option> }</select></label>
                                        <label>Support<select class="hi-in" (change)="setSideNum('sideB', 'support', $event)">@for (o of stepOptions('support'); track o.index) { <option [value]="o.index" [selected]="o.index === d().sideB.support">{{ o.label }}</option> }</select></label>
                                        <label>Transport<select class="hi-in" (change)="setSideNum('sideB', 'transport', $event)">@for (o of stepOptions('transport'); track o.index) { <option [value]="o.index" [selected]="o.index === d().sideB.transport">{{ o.label }}</option> }</select></label>
                                        <label>Salvage<select class="hi-in" (change)="setSideNum('sideB', 'salvage', $event)">@for (o of stepOptions('salvage'); track o.index) { <option [value]="o.index" [selected]="o.index === d().sideB.salvage">{{ o.label }}</option> }</select></label>
                                        <label>Command<select class="hi-in" (change)="setSideNum('sideB', 'command', $event)">@for (o of stepOptions('command'); track o.index) { <option [value]="o.index" [selected]="o.index === d().sideB.command">{{ o.label }}</option> }</select></label>
                                    </div>
                                    <label class="hi-wide">Employer description (Side B)<textarea class="hi-ta" rows="2" [value]="d().sideB.employerDesc" (input)="setSideStr('sideB', 'employerDesc', $event)" placeholder="Who this employer is — their nature, aims, reputation."></textarea></label>
                                    <label class="hi-wide">Situation (Side B)<textarea class="hi-ta" rows="2" [value]="d().sideB.situation" (input)="setSideStr('sideB', 'situation', $event)" placeholder="How this employer frames the op."></textarea></label>
                                    <label class="hi-wide">Blurb (Side B)<input class="hi-in" [value]="d().sideB.blurb" (input)="setSideStr('sideB', 'blurb', $event)"></label>
                                </div>
                            }
                            <label class="hi-wide">Contract victory
                                <span class="hi-help">What counts as winning the OVERALL contract (its end-state), distinct from each track's objectives. Leave blank if the per-track objectives already say it.</span>
                                <input class="hi-in" [value]="d().contractVictory" (input)="setStr('contractVictory', $event)" placeholder="e.g. The Combine thrust is broken and the world stays Federated Suns.">
                            </label>

                            <!-- IMPORT-6 Part D — hireable special personnel (→ HotSpot.hireable[], the IMPORT-3 P2 deploy hire panel reads it).
                                 SHARED across both sides (hireable is top-level on HotSpot, not per SideOffer) → sits OUTSIDE the A/B panels. -->
                            <div class="hi-sec">Special personnel — for hire <span class="hi-opt">(optional — offered at deploy for Support Points)</span>
                                <button type="button" class="cc-btn small" (click)="addMerc()" data-testid="cc-add-hireable">＋ Add specialist</button></div>
                            @if (!d().hireable.length) {
                                <p class="hi-rights">No hireable specialists — the deploy hire panel stays hidden for this hot spot.</p>
                            }
                            @for (m of d().hireable; track $index; let mi = $index) {
                                <div class="hi-merc">
                                    <input class="hi-in nm" [value]="m.name" (input)="updMercStr(mi, 'name', $event)" placeholder="Name (unique)" title="Name — must be unique">
                                    <input class="hi-in role" [value]="m.role" (input)="updMercStr(mi, 'role', $event)" placeholder="Role">
                                    <input class="hi-in sk" type="number" min="0" [value]="m.gunnery" (input)="updMercNum(mi, 'gunnery', $event)" title="Gunnery">
                                    <input class="hi-in sk" type="number" min="0" [value]="m.piloting" (input)="updMercNum(mi, 'piloting', $event)" title="Piloting">
                                    <input class="hi-in sk" type="number" min="0" [value]="m.edge" (input)="updMercNum(mi, 'edge', $event)" title="Edge (starting tokens)">
                                    <input class="hi-in ch" [value]="m.chassis" (input)="updMercStr(mi, 'chassis', $event)" placeholder="'Mech chassis">
                                    <input class="hi-in md" [value]="m.model" (input)="updMercStr(mi, 'model', $event)" placeholder="Variant">
                                    <input class="hi-in sp" type="number" min="0" [value]="m.bv || ''" (input)="updMercNum(mi, 'bv', $event)" placeholder="BV" title="The 'Mech's Battle Value (feeds roster BV + the next track's OpFor sizing; blank = 0/advisory)">
                                    <input class="hi-in sp" type="number" min="1" [value]="m.spCost" (input)="updMercNum(mi, 'spCost', $event)" title="Support-Point cost to field (≥ 1)">
                                    <label class="hi-tog small"><input type="checkbox" [checked]="m.oneTimeHire" (change)="updMercBool(mi, 'oneTimeHire', $event)" title="Charged ONCE for the contract (else per track fielded)"> one-time</label>
                                    <button type="button" class="cc-btn small" (click)="removeMerc(mi)" title="Remove this specialist">×</button>
                                </div>
                            }

                            <div class="hi-sec">Tracks <span class="hi-opt">(optional)</span> <button type="button" class="cc-btn small" (click)="addTrack()">＋ Add track</button></div>
                            @if (!d().tracks.length) {
                                <p class="hi-rights">No embedded tracks — at play time you'll pick each track from the universal library (or a saved Custom Track), and can advance a month between tracks. Add tracks here only for bespoke, authored content.</p>
                            }
                            <!-- IMPORT-6 Part C — each track is the SHARED <bce-track-editor> (also mounted by the D-116 preset builder);
                                 the list (add / remove / order) stays here, the per-track fields + objective rows live in the editor. -->
                            @for (t of d().tracks; track $index; let ti = $index) {
                                <bce-track-editor [track]="t" [index]="ti" (trackChange)="updTrack(ti, $event)" (remove)="removeTrack(ti)" />
                            }

                            <div class="cc-hs-acts">
                                <button type="button" class="cc-btn small go" (click)="saveForm()">Save custom hotspot</button>
                                <button type="button" class="cc-btn small" (click)="resetForm()">Clear form</button>
                                @if (ioMsg()) { <span class="cc-io-msg">{{ ioMsg() }}</span> }
                            </div>
                        </div>
                    }
                }
            }
        }
    `,
    styles: [`
        :host { display:block; margin-top:10px; }
        .hi-nudge { padding:12px 14px; border:1.3px dashed var(--ink); background:var(--paper); margin-top:8px; font-family:var(--type); font-size:13px; }
        .hi-nudge b { display:block; margin-bottom:4px; } .hi-nudge span { color:var(--ink2); }
        .hi-rights { font-family:var(--type); font-size:11px; color:var(--ink2); margin:8px 0 4px; font-style:italic; }
        .hi-modes { display:flex; gap:6px; margin:6px 0 8px; flex-wrap:wrap; }
        .cc-io-ta { width:100%; font-family:var(--mono); font-size:12px; padding:8px; border:1.3px solid var(--ink); background:var(--paper); color:var(--ink); margin:8px 0; box-sizing:border-box; }
        .cc-io-msg { font-family:var(--type); font-size:12px; color:var(--ink2); align-self:center; }
        .hi-form { border:1.3px solid var(--ink); padding:10px; background:var(--paper); max-height:60vh; overflow:auto; }
        .hi-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:8px; }
        .hi-form label { display:flex; flex-direction:column; font-family:var(--type); font-size:11px; color:var(--ink2); gap:3px; }
        .hi-wide { display:block; margin-top:8px; }
        .hi-in, .hi-ta { font-family:var(--mono); font-size:12px; padding:6px; border:1.2px solid var(--ink); background:var(--paper); color:var(--ink); box-sizing:border-box; width:100%; }
        .hi-sec { font-family:var(--type); font-weight:700; font-size:12px; margin:12px 0 6px; display:flex; align-items:center; gap:8px; }
        .hi-opt { font-weight:400; color:var(--ink2); font-size:10px; text-transform:none; letter-spacing:0; }
        .hi-tog { display:flex; align-items:center; gap:6px; font-family:var(--type); font-size:12px; font-weight:600; margin:0 0 10px; cursor:pointer; }
        .hi-help { font-family:var(--type); font-weight:400; font-size:10.5px; color:var(--ink2); font-style:italic; margin:2px 0; }
        .hi-track { border:1.2px solid var(--ink); padding:8px; margin:8px 0; } /* still used by the IMPORT-4 Side A/B panels (the track rows moved to <bce-track-editor>) */
        .hi-thead { display:flex; justify-content:space-between; align-items:center; font-family:var(--type); font-size:12px; margin-bottom:6px; }
        /* IMPORT-6 Part D — one hireable-specialist row (name · role · G/P/Edge · 'Mech · variant · SP · one-time · ×) */
        .hi-merc { display:flex; gap:5px; margin:3px 0; align-items:center; flex-wrap:wrap; }
        .hi-in.sk { width:56px; } .hi-in.sp { width:72px; } .hi-in.nm, .hi-in.role, .hi-in.ch, .hi-in.md { flex:1 1 110px; width:auto; }
        .hi-merc .hi-tog { flex-direction:row; margin:0; font-size:11px; font-weight:400; white-space:nowrap; }
    `],
})
export class HotspotIoComponent {
    private readonly state = inject(NewCampaignState);
    private readonly store = inject(CampaignSaveStore);
    private readonly auth = inject(AuthService); // IMPORT-1 — guest gate
    private readonly st = inject(HotspotIoState); // tab-provided — the draft survives branch flips (see header)

    protected readonly ioOpen = this.st.ioOpen;
    protected readonly ioText = this.st.ioText;
    protected readonly ioMsg = this.st.ioMsg;
    protected readonly mode = this.st.mode;
    protected readonly pasteText = this.st.pasteText;
    protected readonly d = this.st.draft; // the form model

    /** IMPORT-1 gate — a signed-in GUEST cannot import (server-enforced too). When auth is off (dev/LAN) there is
     *  no guest tier → the panel shows. Only a guest with auth ON is blocked. */
    protected readonly blockedGuest = computed(() => this.auth.authRequired() && this.auth.user()?.role === 'guest');

    protected toggleIo(): void { this.ioOpen.update((v) => !v); this.ioMsg.set(''); }
    protected setMode(m: IoMode): void { this.mode.set(m); this.ioMsg.set(''); }
    /** IMPORT-5 Part D — the VALID steps of a contract column for a builder <select> (label = the % / enum it resolves to). */
    protected stepOptions(col: ContractColumn): { index: number; label: string }[] { return validStepOptions(col); }

    /** Public — the parent offer card's Export button drives this through a viewChild ref (JSON round-trip). */
    exportHotspot(h: HotSpot): void {
        this.ioOpen.set(true); this.mode.set('json');
        this.ioText.set(JSON.stringify(h, null, 2)); this.ioMsg.set(`Exported "${h.title}" — edit + re-import to customise.`);
    }

    // ── B2 paste-parse: fill the form, switch to it for review (never blind-saves) ──
    protected parsePaste(): void {
        const text = this.pasteText().trim();
        if (!text) { this.ioMsg.set('Paste your mission text first.'); return; }
        this.st.draft.set(parseHotspotText(text));
        this.mode.set('form');
        this.ioMsg.set('Parsed — review every field below, then Save.');
    }

    // ── B1 form editing ──
    private patch(p: Partial<HotSpotDraft>): void { this.st.draft.update((d) => ({ ...d, ...p })); }
    protected setStr(key: keyof HotSpotDraft, e: Event): void { this.patch({ [key]: (e.target as HTMLInputElement).value } as Partial<HotSpotDraft>); }
    // ── IMPORT-4 — two-sided (opposed pair) editing ──
    protected setTwoSided(e: Event): void {
        const on = (e.target as HTMLInputElement).checked;
        // ensure the pair is opposed the moment two-sided turns on
        this.st.draft.update((d) => ({ ...d, twoSided: on, ...(on ? { sideB: { ...d.sideB, role: oppositeRole(d.sideA.role) } } : {}) }));
    }
    private patchSide(side: 'sideA' | 'sideB', p: Partial<DraftSide>): void { this.st.draft.update((d) => ({ ...d, [side]: { ...d[side], ...p } })); }
    protected setSideStr(side: 'sideA' | 'sideB', key: keyof DraftSide, e: Event): void { this.patchSide(side, { [key]: (e.target as HTMLInputElement).value } as Partial<DraftSide>); }
    protected setSideNum(side: 'sideA' | 'sideB', key: keyof DraftSide, e: Event): void { this.patchSide(side, { [key]: Number((e.target as HTMLInputElement).value) || 0 } as Partial<DraftSide>); }
    /** Side A drives the pair: Side B is enforced OPPOSITE (an opposed pair is the whole point). */
    protected setSideRole(e: Event): void {
        const role = (e.target as HTMLSelectElement).value as 'attacker' | 'defender';
        this.st.draft.update((d) => ({ ...d, sideA: { ...d.sideA, role }, sideB: { ...d.sideB, role: oppositeRole(role) } }));
    }
    protected setNum(key: keyof HotSpotDraft, e: Event): void { this.patch({ [key]: Number((e.target as HTMLInputElement).value) || 0 } as Partial<HotSpotDraft>); }

    // ── tracks: the LIST is owned here; the per-track fields + objective rows are the shared <bce-track-editor>
    //    (IMPORT-6 Part C), which emits an UPDATER applied to the CURRENT track in place (never a stale snapshot). ──
    protected updTrack(i: number, upd: TrackUpdater): void {
        this.st.draft.update((d) => ({ ...d, tracks: d.tracks.map((t, idx) => (idx === i ? upd(t) : t)) }));
    }
    protected addTrack(): void { this.st.draft.update((d) => ({ ...d, tracks: [...d.tracks, emptyTrack()] })); }
    protected removeTrack(i: number): void { this.st.draft.update((d) => ({ ...d, tracks: d.tracks.filter((_, idx) => idx !== i) })); } // IMPORT-3 — tracks optional: may remove to 0 (universal-library play)
    // ── IMPORT-6 Part D — hireable special-personnel rows (mirror updObj*; immutable patches on the tab-provided draft) ──
    private updMerc(i: number, patch: Partial<DraftHireable>): void {
        this.st.draft.update((d) => ({ ...d, hireable: (d.hireable ?? []).map((m, idx) => (idx === i ? { ...m, ...patch } : m)) }));
    }
    protected updMercStr(i: number, key: keyof DraftHireable, e: Event): void { this.updMerc(i, { [key]: (e.target as HTMLInputElement).value } as Partial<DraftHireable>); }
    protected updMercNum(i: number, key: keyof DraftHireable, e: Event): void { this.updMerc(i, { [key]: Number((e.target as HTMLInputElement).value) || 0 } as Partial<DraftHireable>); }
    protected updMercBool(i: number, key: keyof DraftHireable, e: Event): void { this.updMerc(i, { [key]: (e.target as HTMLInputElement).checked } as Partial<DraftHireable>); }
    protected addMerc(): void { this.st.draft.update((d) => ({ ...d, hireable: [...(d.hireable ?? []), emptyHireable()] })); }
    protected removeMerc(i: number): void { this.st.draft.update((d) => ({ ...d, hireable: (d.hireable ?? []).filter((_, idx) => idx !== i) })); }
    protected resetForm(): void { this.st.draft.set(emptyDraft()); this.ioMsg.set('Form cleared.'); }

    /** SAVE (strict) — validate, build the HotSpot, mint id + custom flag, add to the catalog + persist. */
    protected saveForm(): void {
        const draft = this.st.draft();
        const errs = validateDraft(draft);
        if (errs.length) { this.ioMsg.set(errs[0]); return; }
        const id = 'hs-custom-' + this.state.warchestLedger().length + '-' + this.state.customHotSpots().length;
        this.state.addCustomHotSpot({ ...draftToHotSpot(draft), id, custom: true });
        void this.store.persistCurrent();
        this.ioMsg.set(`Saved "${draft.title.trim()}" — it's now in your hotspot picker.`);
        this.st.draft.set(emptyDraft());
    }

    // ── B3 — JSON import (blind, power-user) + a downloadable template ──
    /** Import a hotspot (or array) from JSON → mint fresh ids + custom flag → the catalog + registry, persisted. */
    protected importHotspot(): void {
        try {
            const raw = JSON.parse(this.ioText().trim());
            const list: HotSpot[] = Array.isArray(raw) ? raw : (Array.isArray(raw?.hotspots) ? raw.hotspots : [raw]);
            let n = 0;
            for (const h of list) {
                // IMPORT-5 — tracks are OPTIONAL (a 0-track hot spot plays from the universal library, matching saveForm);
                // only a NON-empty tracks array must include a root. Accept `tracks: []` so an exported 0-track custom re-imports.
                if (!h || !Array.isArray(h.tracks) || !h.contract || (h.tracks.length > 0 && !h.tracks.some((t: { root?: boolean }) => t.root))) continue;
                const id = 'hs-custom-' + (this.state.warchestLedger().length) + '-' + (this.state.customHotSpots().length + n);
                // IMPORT-6 Part D — `hireable` rides the spread untouched (export→import round-trip); a malformed value is
                // DROPPED rather than crashing the deploy hire panel: non-array → gone; rows that aren't objects with a
                // non-empty name → gone (the panel tracks by name). // DECISION: shape-guard only (no per-field schema).
                const snapped = snapImportedSteps(h);
                if (snapped.hireable !== undefined) {
                    const rows = Array.isArray(snapped.hireable)
                        ? (snapped.hireable as unknown[]).filter((r): r is HotSpotHireable => !!r && typeof r === 'object' && typeof (r as { name?: unknown }).name === 'string' && !!(r as { name: string }).name.trim())
                        : [];
                    if (rows.length) snapped.hireable = rows; else delete snapped.hireable;
                }
                this.state.addCustomHotSpot({ ...snapped, id, custom: true }); n++;
            }
            this.ioMsg.set(n ? `Imported ${n} custom hotspot${n === 1 ? '' : 's'} — now in the picker.` : 'No valid hotspot found (needs a contract).');
            if (n) { void this.store.persistCurrent(); this.ioText.set(''); }
        } catch { this.ioMsg.set('Invalid JSON.'); }
    }

    /** A filled example the GM can edit offline + re-import (the field guide is the labels themselves). */
    protected downloadTemplate(): void {
        const example: Omit<HotSpot, 'id'> & { id: string } = { ...draftToHotSpot(sampleDraft()), id: 'hs-custom-example', custom: true };
        try {
            const blob = new Blob([JSON.stringify(example, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = 'bce-hotspot-template.json';
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            this.ioMsg.set('Template downloaded — edit it and paste it back here (or use it as a field guide).');
        } catch { this.ioMsg.set('Could not download — copy the Export JSON instead.'); }
    }
}

/** A representative filled draft for the downloadable template (a field guide by example). */
function sampleDraft(): HotSpotDraft {
    const d = emptyDraft();
    d.title = 'Your Operation Name'; d.world = 'Your World'; d.employer = 'Your Employer';
    d.type = 'Objective Raid'; d.blurb = 'A one-line teaser for the offer card.';
    d.situation = 'Set the scene for the whole contract here.';
    d.enemyFaction = 'The opposing faction'; d.scale = 1; d.intensity = 1; d.lengthMonths = 1;
    d.basePay = 6; d.support = 5; d.transport = 6; d.salvage = 6; d.command = 6; // IMPORT-5 Part D — valid table indices
    d.contractVictory = 'What counts as winning the contract, for both sides.';
    const t = emptyTrack();
    t.name = 'The Opening Move'; t.templateId = 'Objective'; t.situation = 'What is happening on this track.';
    t.deployment = 'How the forces start on the map.'; t.opforFaction = 'The opposing faction'; t.armsMix = 'COMBINED_ARMS';
    t.objectives = [
        { text: 'Destroy or capture the primary target', vp: 200, kind: 'primary', side: 'both' },
        { text: 'Keep your commander alive', vp: 100, kind: 'secondary', side: 'both' },
    ];
    t.specialRules = 'Any special rules for this track.'; t.trackEnd = 'One side has no units, or turn 10.';
    t.salvagePolicy = 'WINNER-ALL';
    d.tracks = [t];
    // IMPORT-6 Part D — one example specialist so the template documents the hireable[] shape (per-track spCost by
    // default; set oneTimeHire true to charge once for the whole contract).
    d.hireable = [{ name: 'Captain Vasquez', role: 'Ace lance leader', gunnery: 2, piloting: 3, edge: 2, chassis: 'Marauder', model: 'MAD-3R', bv: 1363, spCost: 300, oneTimeHire: false }];
    return d;
}
