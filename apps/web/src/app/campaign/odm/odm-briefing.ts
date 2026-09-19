import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { rollOpfor, type OdmForceSpec, type OdmRolledRoster } from './odm-opfor-roll';
import { DataService } from '../../services/data.service';
import { OdmCreateService, type OdmMissionEntry } from './odm-create.service';

type View = 'package' | 'fragord' | 'maps' | 'opfor';

/** One rendered block of a packet document (the DOCTRINE §8 tags + plain markdown structure). */
interface Block {
    kind: 'cover' | 'classification' | 'intent' | 'npc' | 'opnote' | 'intelnote' | 'story' | 'quote'
        | 'verdict' | 'table' | 'dustoff' | 'closer' | 'h1' | 'h2' | 'h3' | 'p' | 'rule' | 'clock' | 'check';
    meta?: string;   // NPC name · OPNOTE source · QUOTE attribution
    meta2?: string;  // NPC context
    lines: string[];
    rows?: string[][]; // [TABLE] / markdown-table rows (row 0 = header)
}

const TAG_KIND: Record<string, Block['kind']> = {
    COVER: 'cover', CLASSIFICATION: 'classification', INTENT: 'intent', NPC: 'npc', OPNOTE: 'opnote',
    INTELNOTE: 'intelnote', STORY: 'story', QUOTE: 'quote', VERDICT: 'verdict', TABLE: 'table',
    DUSTOFF: 'dustoff', CLOSER: 'closer',
};
const OPEN_TAG = /^\[([A-Z]+)(?::\s*([^\]|]+?))?(?:\s*\|\s*([^\]]+?))?\]\s*$/;
const CLOSE_TAG = /^\[\/[A-Z]+\]\s*$/;
const MD_ROW = /^\|(.+)\|\s*$/;
const MD_SEP = /^\|[\s:|-]+\|\s*$/;

/** Parse a packet document into render blocks. Faithful: no inline transformation — text renders verbatim. */
export function parsePacket(text: string): Block[] {
    const out: Block[] = [];
    const lines = text.split(/\r?\n/);
    let i = 0;
    const flushPara = (buf: string[]) => { if (buf.length) { out.push({ kind: 'p', lines: [...buf] }); buf.length = 0; } };
    const para: string[] = [];
    while (i < lines.length) {
        const ln = lines[i];
        const open = OPEN_TAG.exec(ln);
        if (open && TAG_KIND[open[1]]) {
            flushPara(para);
            const kind = TAG_KIND[open[1]];
            const body: string[] = [];
            i++;
            while (i < lines.length && !CLOSE_TAG.test(lines[i])) { body.push(lines[i]); i++; }
            i++; // consume the close tag
            if (kind === 'table') {
                const rows: string[][] = []; const caption: string[] = [];
                for (const b of body) {
                    const r = MD_ROW.exec(b);
                    if (r && MD_SEP.test(b)) continue;
                    else if (r) rows.push(r[1].split('|').map((c) => c.trim()));
                    else if (b.trim()) caption.push(b.trim());
                }
                out.push({ kind: 'table', lines: caption, rows });
            } else {
                out.push({ kind, meta: open[2]?.trim(), meta2: open[3]?.trim(), lines: body.filter((b, ix) => b.trim() !== '' || (ix > 0 && ix < body.length - 1)) });
            }
            continue;
        }
        if (ln.startsWith('```')) { // fenced block — the FRAGORD clock (monospace)
            flushPara(para);
            const body: string[] = []; i++;
            while (i < lines.length && !lines[i].startsWith('```')) { body.push(lines[i]); i++; }
            i++;
            out.push({ kind: 'clock', lines: body });
            continue;
        }
        if (MD_ROW.test(ln)) { // markdown table outside [TABLE]
            flushPara(para);
            const rows: string[][] = [];
            while (i < lines.length && MD_ROW.test(lines[i])) {
                if (!MD_SEP.test(lines[i])) rows.push((MD_ROW.exec(lines[i]) as RegExpExecArray)[1].split('|').map((c) => c.trim()));
                i++;
            }
            out.push({ kind: 'table', lines: [], rows });
            continue;
        }
        if (/^<!--/.test(ln.trim())) { while (i < lines.length && !/-->\s*$/.test(lines[i])) i++; i++; continue; } // comments never render
        if (/^---+\s*$/.test(ln)) { flushPara(para); out.push({ kind: 'rule', lines: [] }); i++; continue; }
        if (ln.startsWith('### ')) { flushPara(para); out.push({ kind: 'h3', lines: [ln.slice(4)] }); i++; continue; }
        if (ln.startsWith('## ')) { flushPara(para); out.push({ kind: 'h2', lines: [ln.slice(3)] }); i++; continue; }
        if (ln.startsWith('# ')) { flushPara(para); out.push({ kind: 'h1', lines: [ln.slice(2)] }); i++; continue; }
        if (ln.trim().startsWith('☐')) { flushPara(para); out.push({ kind: 'check', lines: [ln.trim().slice(1).trim()] }); i++; continue; }
        if (ln.trim() === '') { flushPara(para); i++; continue; }
        para.push(ln);
        i++;
    }
    flushPara(para);
    return out;
}

@Component({
    selector: 'bce-odm-briefing',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="ob">
            <div class="ob-bar">
                <label class="ob-pick">Mission
                    <select (change)="onPick($event)">
                        <!-- TABLE-2 T2-2 — a placeholder for "no active mission" so the box never displays a stale packet when sel is unset. -->
                        <option value="" [selected]="!sel()">— No active mission —</option>
                        @for (m of missions(); track m.id) { <option [value]="m.id" [selected]="m.id === sel()">{{ m.title }}{{ m.system ? ' — ' + m.system : '' }}{{ m.threat ? ' (' + m.threat + ')' : '' }}</option> }
                    </select>
                </label>
                <div class="ob-views">
                    <button type="button" class="ob-vbtn" [class.on]="view() === 'package'" (click)="setView('package')" data-testid="ob-package">Package</button>
                    <button type="button" class="ob-vbtn" [class.on]="view() === 'fragord'" (click)="setView('fragord')" data-testid="ob-fragord">FRAGORD</button>
                    <button type="button" class="ob-vbtn" [class.on]="view() === 'maps'" (click)="setView('maps')" data-testid="ob-maps">Maps</button>
                    <button type="button" class="ob-vbtn opfor" [class.on]="view() === 'opfor'" (click)="setView('opfor')" data-testid="ob-opfor">⚔ OPFOR (GM)</button>
                </div>
                <button type="button" class="ob-vbtn ob-print" [disabled]="!sel() || !doc()" (click)="onPrint()" data-testid="ob-print">Ὓ6 Print</button>
            </div>

            @if (view() === 'opfor') {
                <div class="ob-gmwarn" data-testid="ob-gmwarn">OPFOR PACKET — GM EYES ONLY. The truth behind the intelligence gaps. Never show this surface to players; the player packet is the Package + FRAGORD.</div>
                @if (rolledRoster(); as r) {
                    <div class="ob-roster" data-testid="ob-roster">
                        <div class="obr-h">FORCE ROSTER — THIS PLAYTHROUGH <span class="obr-seed">seed {{ r.seed.slice(0, 8) }}</span>
                            <span class="obr-bv" [class.warn]="!r.envelope.inEnvelope">{{ r.totalBv }} BV · target {{ r.envelope.target }} ±{{ r.envelope.tolerance }}@if (r.envelope.fallback) { · ENVELOPE EDGE — closest legal roll }</span></div>
                        <table class="obr-t"><thead><tr><th>Unit</th><th>Type</th><th>Tons</th><th>BV</th><th>Pilot</th><th>G/P</th><th>Role</th></tr></thead>
                            <tbody>
                                @for (u of r.units; track $index) {
                                    <tr [class.fixed]="u.fixed"><td>{{ u.chassis }} {{ u.variant }}</td><td>{{ u.type }}</td><td>{{ u.tons }}</td><td>{{ u.bv }}</td>
                                        <td>{{ u.pilotName }}@if (u.fixed) { <span class="obr-fx">FIXED</span> }</td><td>{{ u.gunnery }}/{{ u.piloting }}</td><td>{{ u.role }}</td></tr>
                                }
                            </tbody>
                        </table>
                        <div class="obr-note">Rank-and-file rolled from the AUTHORED pools by this playthrough's instance seed (re-begin the operation for a fresh roll); the named identity never varies. Print rides build.py --seed.</div>
                    </div>
                } @else if (opforSpec() && !instanceSeed()) {
                    <div class="ob-roster pending" data-testid="ob-roster-pending">FORCE ROSTER — rolls at BEGIN OPERATION (no instance seed yet for this mission).</div>
                }
            }

            @if (missions().length === 0) {
                <div class="ob-empty">No mission packets in the pack manifest.</div>
            } @else if (!sel()) {
                <!-- TABLE-2 T2-2 — no active mission (never defaults to the manifest's first packet). Pick one to view its briefing. -->
                <div class="ob-empty" data-testid="ob-noactive">No active mission. Begin an operation on the Missions tab, or pick a mission above to read its briefing.</div>
            } @else if (doc() === null) {
                <div class="ob-empty">Loading packet…</div>
            } @else if (doc() === '') {
                @if (view() === 'opfor') {
                    <div class="ob-empty">OPFOR packets serve only on a hosted, entitled session (the player-peek cheat is what the two-packet split prevents). LAN tables: print it via tools/odm-docx/build.py.</div>
                } @else {
                    <div class="ob-empty">This packet failed to load (entitlement or host unreachable).</div>
                }
            } @else {
                <div class="ob-print-run top">CLASSIFICATION: UNIT EYES ONLY</div>
                <div class="ob-print-run bot">CLASSIFICATION: UNIT EYES ONLY</div>
                <div class="ob-doc" [class.gm]="view() === 'opfor'" data-testid="ob-doc">
                    @for (b of blocks(); track $index) {
                        @switch (b.kind) {
                            @case ('cover') { <div class="bx cover">@for (l of b.lines; track $index) { <div class="cover-l">{{ l }}</div> }</div> }
                            @case ('classification') { <div class="bx classif">@for (l of b.lines; track $index) { <div>{{ l }}</div> }</div> }
                            @case ('intent') { <div class="bx intent"><div class="bx-h">COMMANDER'S INTENT</div>@for (l of b.lines; track $index) { <p>{{ l }}</p> }</div> }
                            @case ('npc') { <div class="bx npc"><div class="bx-h">{{ b.meta }}{{ b.meta2 ? ' — ' + b.meta2 : '' }}:</div>@for (l of b.lines; track $index) { <p class="it">{{ l }}</p> }</div> }
                            @case ('opnote') { <div class="bx opnote"><div class="bx-h">FROM {{ b.meta }} — OPERATIONAL NOTE:</div>@for (l of b.lines; track $index) { <p>{{ l }}</p> }</div> }
                            @case ('intelnote') { <div class="bx intel"><div class="bx-h">INTEL NOTE —</div>@for (l of b.lines; track $index) { <p>{{ l }}</p> }</div> }
                            @case ('story') { <div class="story">@for (l of b.lines; track $index) { <p>{{ l }}</p> }</div> }
                            @case ('quote') { <div class="quote">@for (l of b.lines; track $index) { <p>{{ l }}</p> }<div class="attr">{{ b.meta }}{{ b.meta2 ? ' | ' + b.meta2 : '' }}</div></div> }
                            @case ('verdict') { <div class="bx verdict"><div class="bx-h">VERDICT</div>@for (l of b.lines; track $index) { <p>{{ l }}</p> }</div> }
                            @case ('dustoff') { <div class="bx dustoff"><div class="bx-h">DUSTOFF PROTOCOL</div>@for (l of b.lines; track $index) { <p>{{ l }}</p> }</div> }
                            @case ('closer') { <div class="bx closer">@for (l of b.lines; track $index) { <div>{{ l }}</div> }</div> }
                            @case ('table') {
                                @if (b.lines.length) { <div class="tcap">@for (l of b.lines; track $index) { <div>{{ l }}</div> }</div> }
                                @if (b.rows && b.rows.length) {
                                    <div class="twrap"><table class="t">
                                        <thead><tr>@for (c of b.rows[0]; track $index) { <th>{{ c }}</th> }</tr></thead>
                                        <tbody>@for (r of b.rows.slice(1); track $index) { <tr>@for (c of r; track $index) { <td>{{ c }}</td> }</tr> }</tbody>
                                    </table></div>
                                }
                            }
                            @case ('clock') { <pre class="clock">@for (l of b.lines; track $index) {{{ l }}
}</pre> }
                            @case ('check') { <div class="check"><span class="cbx">☐</span><span>{{ b.lines[0] }}</span></div> }
                            @case ('h1') { <h1 class="h1">{{ b.lines[0] }}</h1> }
                            @case ('h2') { <h2 class="h2">{{ b.lines[0] }}</h2> }
                            @case ('h3') { <h3 class="h3">{{ b.lines[0] }}</h3> }
                            @case ('rule') { <hr class="rule" /> }
                            @case ('p') { <div class="p">@for (l of b.lines; track $index) { <div>{{ l }}</div> }</div> }
                        }
                    }
                </div>
            }
        </div>
    `,
    styles: [`
        /* The pack's canonical palette: NAVY 1C2333 · NAVY_MID 2E3A50 · WARM_BLK 1A1000 · GOLD C8A84B ·
           GOLD_LT D4B96A · CREAM FFF8E6 · NEAR_WHT E8EAF0 */
        .ob { max-width: 900px; margin: 0 auto; }
        .ob-bar { display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:10px; }
        .ob-pick { font-size:12px; color:#9fb2c4; display:flex; align-items:center; gap:8px; }
        .ob-pick select { background:#141a21; border:1px solid #2a3340; color:#e7edf3; border-radius:7px; padding:7px 9px; font-size:13px; max-width:340px; }
        .ob-views { display:flex; border:1px solid #2a3340; border-radius:8px; overflow:hidden; }
        .ob-vbtn { background:#141a21; border:none; color:#9fb2c4; padding:8px 14px; font-size:12px; font-weight:700; cursor:pointer; border-right:1px solid #2a3340; }
        .ob-vbtn:last-child { border-right:none; }
        .ob-vbtn.on { background:#1C2333; color:#C8A84B; }
        .ob-vbtn.opfor { color:#e08b7a; }
        .ob-vbtn.opfor.on { background:#3a1714; color:#f2a4a4; }
        .ob-gmwarn { background:#3a1714; border:1px solid #6b3a2f; color:#f2a4a4; border-radius:9px; padding:10px 14px; font-size:12px; font-weight:700; margin-bottom:10px; }
        .ob-print { margin-left:auto; }
        .ob-print-run { display:none; }
        @media print {
            .ob-bar, .ob-gmwarn { display:none !important; }
            .ob-doc { font-size:10.5pt; padding:0.35in 0.15in; border-radius:0; }
            .bx, .twrap, .clock, .quote, .cover { break-inside: avoid; page-break-inside: avoid; }
            .ob-print-run { display:block; position:fixed; left:0; right:0; text-align:center; font:700 8pt Arial;
                            letter-spacing:.08em; color:#1A1000; background:#FFF8E6; padding:2px 0; }
            .ob-print-run.top { top:0; } .ob-print-run.bot { bottom:0; }
        }
        .ob-roster { background:#141a21; border:1px solid #6b3a2f; border-radius:9px; padding:10px 14px; margin-bottom:10px; }
        .ob-roster.pending { color:#9fb2c4; font-size:12px; font-style:italic; }
        .obr-h { font-weight:800; font-size:12px; letter-spacing:.08em; color:#e0c88b; display:flex; gap:12px; flex-wrap:wrap; align-items:baseline; }
        .obr-seed { color:#6b7682; font-weight:400; }
        .obr-bv { margin-left:auto; color:#9fe3b8; } .obr-bv.warn { color:var(--warn, #e7c66b); }
        .obr-t { width:100%; border-collapse:collapse; font-size:12px; margin-top:8px; color:#cdd8e3; }
        .obr-t th { text-align:left; color:#8a98a6; font-size:10.5px; text-transform:uppercase; letter-spacing:.06em; padding:3px 8px; border-bottom:1px solid #2a3340; }
        .obr-t td { padding:3px 8px; border-bottom:1px solid #1b222b; }
        .obr-t tr.fixed td { color:#e0c88b; }
        .obr-fx { font-size:9px; border:1px solid #6b3a2f; border-radius:4px; padding:0 4px; margin-left:6px; color:#e08b7a; }
        .obr-note { font-size:11px; color:#6b7682; font-style:italic; margin-top:6px; }
        .ob-empty { color:#7f8a96; font-style:italic; padding:26px 6px; text-align:center; }
        .ob-doc { background:#FFFDF5; color:#1C2333; border-radius:12px; padding:26px 30px 34px; font:13.5px/1.55 Arial, system-ui, sans-serif; }
        .ob-doc.gm { outline:2px solid #6b3a2f; }
        .bx { border:1px solid #C8A84B; border-radius:6px; margin:14px 0; overflow:hidden; }
        .bx p, .bx div:not(.bx-h) { margin:0; padding:2px 0; }
        .bx-h { font-weight:800; letter-spacing:.06em; font-size:12px; padding:7px 12px !important; }
        .bx > p, .bx > .it { padding:4px 12px; }
        .cover { background:#1C2333; color:#E8EAF0; text-align:center; padding:18px 14px; }
        .cover-l:first-child { color:#C8A84B; font-weight:800; font-size:17px; letter-spacing:.12em; }
        .classif { background:#1A1000; color:#C8A84B; text-align:center; font-weight:700; padding:9px 12px; letter-spacing:.05em; }
        .intent { background:#FFF8E6; } .intent .bx-h { background:#1C2333; color:#C8A84B; }
        .npc { background:#1A1000; color:#D4B96A; } .npc .bx-h { color:#C8A84B; }
        .npc .it { font-style:italic; font-size:12.5px; }
        .opnote { background:#1C2333; color:#E8EAF0; } .opnote .bx-h { color:#D4B96A; }
        .intel { background:#2E3A50; color:#E8EAF0; } .intel .bx-h { color:#C8A84B; }
        .verdict { background:#FFF8E6; } .verdict .bx-h { background:#2E3A50; color:#C8A84B; }
        .dustoff { background:#1A1000; color:#D4B96A; } .dustoff .bx-h { color:#C8A84B; }
        .closer { background:#1A1000; color:#C8A84B; text-align:center; font-weight:700; padding:13px 12px; border-top:3px solid #C8A84B; }
        .story { font-style:italic; color:#8a7a3e; margin:14px 32px; }
        .quote { text-align:center; margin:16px 24px; padding:10px 0; border-top:2px solid #C8A84B; border-bottom:2px solid #C8A84B; }
        .quote p { font-style:italic; color:#8a7a3e; margin:2px 0; }
        .quote .attr { font-variant:small-caps; font-size:11.5px; color:#6b7682; margin-top:5px; }
        .tcap { font-size:12px; color:#2E3A50; margin:10px 0 4px; font-weight:600; }
        .twrap { overflow-x:auto; margin:8px 0 14px; }
        .t { border-collapse:collapse; width:100%; font-size:12.5px; }
        .t th { background:#1C2333; color:#C8A84B; text-align:left; padding:6px 9px; border:1px solid #C8A84B; }
        .t td { padding:5px 9px; border:1px solid #CCBB99; }
        .t tbody tr:nth-child(even) { background:#FFF8E6; }
        .clock { background:#1C2333; color:#E8EAF0; font:11.5px/1.5 'Courier New', ui-monospace, monospace; padding:12px 14px; border-radius:6px; overflow-x:auto; }
        .check { display:flex; gap:8px; margin:3px 0 3px 6px; }
        .cbx { color:#2E3A50; }
        .h1 { font-size:19px; margin:6px 0 10px; color:#1C2333; }
        .h2 { font-size:15px; margin:20px 0 8px; padding-bottom:4px; border-bottom:3px solid #C8A84B; color:#1C2333; letter-spacing:.04em; }
        .h3 { font-size:13px; margin:14px 0 6px; color:#2E3A50; letter-spacing:.03em; }
        .rule { border:none; border-top:1px solid #CCBB99; margin:16px 0; }
        .p { margin:7px 0; }
    `],
})
export class OdmBriefingComponent {
    private readonly pack = inject(OdmCreateService);

    private readonly state = inject(NewCampaignState);
    private readonly data = inject(DataService);
    protected readonly missions = signal<OdmMissionEntry[]>([]);
    protected readonly opforSpec = signal<OdmForceSpec | null>(null);
    protected readonly odmNodes = signal<{ id: string; packet: string | null }[]>([]);
    /** The tree node bound to the shown packet (seeds are keyed by NODE id, the briefing by PACKET id). */
    private readonly nodeForMission = computed(() => this.odmNodes().find((n) => n.packet === this.sel())?.id ?? null);
    protected readonly instanceSeed = computed(() => {
        const node = this.nodeForMission();
        return node ? (this.state.odmSeeds()[node] ?? null) : null;
    });
    protected readonly rolledRoster = computed<OdmRolledRoster | null>(() => {
        const spec = this.opforSpec();
        const seed = this.instanceSeed();
        if (!spec || !seed || this.view() !== 'opfor') return null;
        try {
            // BLOCKER-1 posture: the roll is STAMP-FIRST (rollOpfor prefers annotations), so this live-catalog
            // resolver is defense-only for unstamped dev specs — case-INSENSITIVE to match the node/validator.
            return rollOpfor(spec, seed, (chassis, variant) => {
                const key = `${chassis}|${variant}`.toLowerCase();
                const u = this.data.getUnits().find((x) => `${x.chassis}|${x.model}`.toLowerCase() === key);
                return u ? { name: u.name, mulId: u.id, tons: u.tons, bv: u.bv, type: u.type } : undefined;
            });
        } catch { return null; } // an unstamped+unresolvable spec — the ingest validator's job; never crash the view
    });
    protected readonly sel = signal<string>('');
    protected readonly view = signal<View>('package');
    /** null = loading · '' = failed · text = loaded. LOCAL only — never state, never snapshot, never fanned. */
    protected readonly doc = signal<string | null>(null);
    protected readonly blocks = computed(() => parsePacket(this.doc() || ''));

    constructor() {
        void (async () => {
            const ms = await this.pack.missionIndex();
            this.missions.set(ms);
            const focus = this.pack.briefingFocus();
            this.pack.briefingFocus.set(null);
            // TABLE-2 T2-2 — the Briefing tab FOLLOWS THE ACTIVE MISSION, never the manifest's first packet (ms[0]).
            // On tab re-entry the one-shot focus is already spent, so the old ms[0] fallback reverted to Pale Candle
            // while a different mission was active. Order now: the deep-link focus → the ACTIVE branch's packet
            // (odmActiveNodeId, cleared on resolve) → no active mission (empty state). Never ms[0].
            let activePacket: string | null = null;
            const activeNodeId = this.state.odmActiveNodeId();
            if (activeNodeId) {
                if (!this.odmNodes().length) { const t = await this.pack.treeJson(); this.odmNodes.set((t?.nodes ?? []).map((n) => ({ id: n.id, packet: n.packet }))); }
                activePacket = this.odmNodes().find((n) => n.id === activeNodeId)?.packet ?? null;
            }
            const pick = (focus && ms.some((m) => m.id === focus)) ? focus
                : (activePacket && ms.some((m) => m.id === activePacket)) ? activePacket
                : null;
            if (pick) { this.sel.set(pick); void this.loadDoc(); }
        })();
    }

    protected onPick(e: Event): void { this.sel.set((e.target as HTMLSelectElement).value); void this.loadDoc(); }
    protected setView(v: View): void { this.view.set(v); void this.loadDoc(); }
    protected onPrint(): void {
        document.body.classList.add('odm-printing');
        const done = () => { document.body.classList.remove('odm-printing'); window.removeEventListener('afterprint', done); };
        window.addEventListener('afterprint', done);
        try { window.print(); } finally { setTimeout(done, 2000); /* belt — afterprint is flaky in some engines */ }
    }
    private async loadDoc(): Promise<void> {
        const id = this.sel();
        if (!id) return;
        this.doc.set(null);
        this.doc.set((await this.pack.missionDoc(id, this.view())) ?? '');
        if (this.view() === 'opfor') {
            if (!this.odmNodes().length) {
                const t = await this.pack.treeJson();
                this.odmNodes.set((t?.nodes ?? []).map((n) => ({ id: n.id, packet: n.packet })));
            }
            this.opforSpec.set(await this.pack.opforSpec(id));
        } else { this.opforSpec.set(null); }
    }
}
