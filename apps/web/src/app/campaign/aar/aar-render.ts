/*
 * BCE campaign-pack — AFTER-ACTION REPORT render (DIRECTIVE-034). Pure TS, no Angular/DOM.
 *
 * DATA-003 IS this module: the AAR is a RENDER built on demand from stored structure — the D-026
 * resolution (tier/answers/notes/override + the D-034 resolve-time snapshot), the D-031 fieldWalk
 * (dispositions/credits/captures/pilot outcomes), D-033 bay history joined by instanceId, and the
 * campaign's persistent staff voices (D-025). NOTHING here parses generated text back (ODM's AAR
 * bug farm — the design this replaces). Missing records render HONESTLY as "not recorded" notes,
 * never as invented history. NONE-mode template prose; the D-035 narrator refines section
 * paragraphs through the clean AarSection seam without touching the data plumbing.
 */
import type { MissionBranch, OutcomeGate, TreeArchiveEntry } from '../mission/mission-tree';
import type { BayHistoryEntry } from '../repair/repair-bays';
import { registerClassbar, registerClosing, registerStamp } from '../mission/forge-select';
import { formatDate } from '../clock/campaign-clock';

// ── The archive list (resolved missions, newest first) ──
export interface AarArchiveItem {
    branchId: string;
    opName: string;
    tier: OutcomeGate;
    override: boolean;
    dateText: string;
    dateKey: number;       // y*10000 + m*100 + d for the newest-first sort
    context: string;       // contract/orders label this mission ran under
    pendingWalk: boolean;  // resolved, walk not yet completed
    walked: boolean;       // TABLE-2 T2-4 — walk completed (badge reads WALKED)
    branch: MissionBranch; // carried for the document build
}

const dateKey = (d?: { y: number; m: number; d: number }): number => (d ? d.y * 10000 + (d.m + 1) * 100 + d.d : 0);

/** Every RESOLVED mission across the live tree + the closed-tree archive, newest first. Archived
 *  copies win over their live duplicates (closeTree archives the tree the live spine still holds
 *  until the next accept) — same branchIds, but the archive carries the completed-contract label. */
export function aarArchive(liveTree: MissionBranch[], liveContext: string, archive: TreeArchiveEntry[]): AarArchiveItem[] {
    const item = (b: MissionBranch, context: string): AarArchiveItem => ({
        branchId: b.branchId,
        opName: b.name,
        tier: b.resolution!.outcomeTier,
        override: !!b.resolution!.override,
        dateText: b.resolution!.resolvedDate ? formatDate(b.resolution!.resolvedDate) : '—',
        dateKey: dateKey(b.resolution!.resolvedDate),
        context,
        pendingWalk: !!b.resolution!.engaged && !b.resolution!.fieldWalk,
        walked: !!b.resolution!.fieldWalk, // TABLE-2 T2-4
        branch: b,
    });
    const resolved = (tree: MissionBranch[]): MissionBranch[] => tree.filter((b) => b.state === 'RESOLVED' && !!b.resolution);
    const out = new Map<string, AarArchiveItem>();
    for (const e of archive) for (const b of resolved(e.tree)) out.set(b.branchId, item(b, e.label));
    for (const b of resolved(liveTree)) if (!out.has(b.branchId)) out.set(b.branchId, item(b, liveContext));
    return [...out.values()].sort((a, b) => b.dateKey - a.dateKey);
}

// ── The document ──
export interface AarVoiceRef {
    name: string;
    roleFamily: string;
    header: string;       // the voice's sidebarHeader — the section byline
    rules: string;        // speechRules joined — the standing-rules resline (D-035's refine contract)
}
export interface AarRow {
    cells: string[];
    tone?: 'ok' | 'warn' | 'bad';
}
/** D-037 — an ordered content block (prose OR a table) for sections that interleave both. */
export interface AarBlock {
    p?: string;
    headers?: string[];
    rows?: AarRow[];
}
export interface AarSection {
    id: 'command' | 'intelligence' | 'armorer' | 'personnel' | 'ledger'; // D-122 — 'ledger' is the HS iteration ledger (never refined)
    title: string;
    author: AarVoiceRef | null;  // null = no staff voice on record (honest, unsigned)
    paragraphs: string[];        // NONE-mode template lines — the narrator's refine seam
    headers?: string[];
    rows?: AarRow[];
    blocks?: AarBlock[];         // D-037: ordered prose/table stream, rendered after rows
    note?: string;               // the honesty line: what is NOT on record and why
    closingLine?: string;        // the armorer's precept (an AUTHORED sampleLine — never invented)
    refined?: boolean;           // D-038: this section's prose is narrator-refined-and-verified
}
export interface AarDocument {
    classbar: string;
    stamp: string;
    unitLine: string;
    opName: string;
    locLine: string;   // world · district when snapshotted; '' otherwise
    tierLine: string;
    dateLine: string;
    context: string;
    override: boolean;
    sections: AarSection[];
    closing: string;   // the register-keyed campaign-forward line (the CAMPAIGN's register)
    source: string;
}

export interface AarContext {
    register: string;                              // campaignRegister(force, faction)
    commandName: string;
    unitSizeName: string;
    contextLabel: string;                          // contract/orders label
    /** ODM-14 — `personnel` is ADDITIVE-OPTIONAL: only the odm fork supplies it (the authored medic voice);
     *  Classic/HS never set it and Section 4 falls back to command exactly as before. */
    voices: { command: AarVoiceRef | null; intelligence: AarVoiceRef | null; engineering: AarVoiceRef | null; personnel?: AarVoiceRef | null };
    armorerClosing: string | null;                 // stable authored sampleLine pick (component supplies)
    /** D-037 — one accessor for the person record (name/status/live recovery/memorial date). */
    pilotInfoOf: (pilotId: string | undefined) => { name: string; status: string; recoveryDays: number | null; kiaDateText: string | null } | null;
    bayHistory: BayHistoryEntry[];
    /** D-037 — live open estimates by occupant (a job still in a bay shows honestly as in-work). */
    openJobs: Record<string, { hours: number; cost: number; bayName: string }>;
    /** D-037 — the salvage clause this mission ran under (live contract or the archived one); null = not on record. */
    salvageClause: { pct: number; exchange: boolean } | null;
    npcNamesByFlag: Record<string, string>;        // resolved via the resolution's npcFlags + assignments
    unlocked: string[];                            // child ops this resolution made AVAILABLE
    /** DIRECTIVE-121 — Hot Spots: render the SP field SETTLEMENT + LOSSES + PRIZES in place of the Classic walk
     *  sections 3/4 (HS has no field walk). Traditional (false) keeps the walk-gated annex + personnel. */
    isHotspots?: boolean;
    /** D-038 — narrator-refined section prose (machine-diff-verified). A verified entry REPLACES that
     *  section's template paragraphs; tables/locked data stay. Absent/OFF = template, byte-identical. */
    refined?: Record<string, { text: string; verified: boolean }>;
    /** ODM-13 P3 — SURVIVAL voice: a pack campaign's AAR speaks attrition, not payroll/contract (two branch
     *  points + the materiel ledger line). Absent/false = the Classic voice, byte-identical. */
    survival?: boolean;
}

const SEV_LABEL: Record<string, string> = { G: 'LIGHT', Y: 'MODERATE', R: 'HEAVY', B: 'DESTROYED' };
const DISP_LABEL: Record<string, string> = {
    RECOVER: 'Recovered → bays', FIELD_STRIP: 'Field-stripped', ABANDON: 'Abandoned',
    CLAIM_PRIZE: 'Claimed as prize', SALVAGE: 'Salvaged', LEAVE: 'Left on the field',
    STRIP: 'Stripped for materiel', // ODM-13 P3 — the odm walk's disposition, in voice (Classic never produces it)
};
const fmt = (n: number): string => n.toLocaleString('en-US');

/** IMPORT-6 FOLLOWUPS — the Hot Spots outcome tier → the book grade (the combat-pay bucket the resolve modal showed:
 *  chaos-sp-costs COMBAT_TIER_BY_GATE vocabulary — all objectives 750 · success 500 · unsuccessful-but-unbroken 250 ·
 *  broken/none 0, ×scale). Used only under Hot Spots (ctx.isHotspots) — the Traditional tier line is byte-identical. */
const TIER_GRADE: Record<string, string> = {
    FULL_SUCCESS: 'all objectives (750 SP × scale)',
    SUCCESS: 'successful (500 SP × scale)',
    PARTIAL: 'unsuccessful but unbroken (250 SP × scale)',
    COMPROMISED: 'unsuccessful (250 SP × scale)',
    FAILURE: 'force broken / no pay',
    ANY: '—',
};

/** Build the classified after-action document from the stored records. Pure; render-only. */
export function buildAarDocument(branch: MissionBranch, ctx: AarContext): AarDocument {
    const r = branch.resolution!;
    const a = r.aar;
    const tier = r.outcomeTier;

    // ── Section 1 — command summary ──
    const cmd: AarSection = { id: 'command', title: 'SECTION 1 — COMMAND SUMMARY', author: ctx.voices.command, paragraphs: [] };
    let lead = `Operation ${branch.name.toUpperCase()} is resolved — outcome ${tier}.`;
    if (a?.employer || a?.target) lead += ` Employer of record: ${a?.employer ?? '—'}; opposition: ${a?.target ?? '—'}.`;
    cmd.paragraphs.push(lead);
    if (r.override) cmd.paragraphs.push('OUTCOME ENTERED UNDER GM OVERRIDE — the computed tier was superseded at resolution.');
    if (r.notes) cmd.paragraphs.push(`Resolution notes: ${r.notes}`);
    if (ctx.unlocked.length) cmd.paragraphs.push(`Follow-on operations unlocked by this outcome: ${ctx.unlocked.join(' · ')}.`);
    // D-099 — the elapsed clock: the operation + jump transit + insertion the AAR advanced the campaign date by.
    if (a?.elapsedDays) {
        const t = a.travel;
        const span = t?.hasTravel
            ? `${t.jumps} jump${t.jumps === 1 ? '' : 's'} ≈ ${t.jumpTransitDays}d transit + ${t.insertionDays}d insertion · operation ≈ ${t.operationDays}d`
            : `operation ≈ ${t?.operationDays ?? a.elapsedDays}d on-world (no transit recorded)`;
        cmd.paragraphs.push(`Operation + transit consumed ${a.elapsedDays} days (${span}); the campaign clock is now ${a.advancedTo ?? '—'}. ${ctx.survival ? 'Repair bays and the quartermaster’s stores have settled across the span.' : 'Repair bays, shop deliveries, hiring, and payroll have settled across the span.'}`);
    }
    if (a?.objectiveMarks?.length) {
        // IMPORT-6 FOLLOWUPS — a Hot Spots track resolved under a VP model: the AUTHORED objectives with the marks the GM
        // actually set (snapshotted at resolve), never the legacy trio's defaults. Two-sided: our column as rows, the
        // opponent's as a trailing block. Legacy / Traditional resolutions have no objectiveMarks → the trio below, unchanged.
        const ours = a.objectiveMarks.filter((o) => o.side !== 'opp');
        const opp = a.objectiveMarks.filter((o) => o.side === 'opp');
        cmd.headers = ['OBJECTIVE', 'VP', 'RESULT'];
        cmd.rows = ours.map((o) => ({ cells: [o.text, `${o.vp}`, o.met ? 'MET' : 'NOT MET'], tone: o.met ? 'ok' as const : 'bad' as const }));
        const ourVp = ours.reduce((s, o) => s + (o.met ? o.vp : 0), 0);
        const totalVp = ours.reduce((s, o) => s + o.vp, 0);
        const oppVp = opp.reduce((s, o) => s + (o.met ? o.vp : 0), 0);
        const metCount = ours.filter((o) => o.met).length;
        cmd.paragraphs.push(a.model === 'two'
            ? `Victory points — yours ${ourVp}, opponent ${oppVp}; you met ${metCount} of ${ours.length} objectives${r.answers?.broke ? '; your force broke / withdrew' : ''}. Outcome tier ${tier} — ${TIER_GRADE[tier] ?? tier}.`
            : `Victory points — ${ourVp} of ${totalVp} authored; you met ${metCount} of ${ours.length} objectives${r.answers?.broke ? '; your force broke / withdrew' : ''}. Outcome tier ${tier} — ${TIER_GRADE[tier] ?? tier}.`);
        if (opp.length) cmd.note = `Opponent objectives — ${opp.map((o) => `${o.text} (${o.vp} VP): ${o.met ? 'MET' : 'NOT MET'}`).join(' · ')}.`;
    } else if (r.answers) {
        const ans = r.answers;
        const row = (p: string, text: string | undefined, met: boolean): AarRow =>
            ({ cells: [p, text ?? '—', met ? 'MET' : 'NOT MET'], tone: met ? 'ok' : 'bad' });
        cmd.headers = ['PRIORITY', 'OBJECTIVE', 'RESULT'];
        cmd.rows = [
            row('Primary', a?.objectives?.primary, ans.primary),
            row('Secondary', a?.objectives?.secondary, ans.secondary),
            row('Bonus', a?.objectives?.bonus, ans.bonus),
        ];
        if (!a?.objectives) cmd.note = 'Objective texts were not snapshotted on this resolution (resolved pre-D-034) — results shown from the questionnaire record only.';
    } else {
        cmd.note = 'No questionnaire record on this resolution — objective results unavailable.';
    }

    // ── ITERATION LEDGER — DIRECTIVE-122: the per-mission SP/asset accounting, snapshotted at resolve (HS-only).
    //    Rendered right after the command summary; appended to `sections` only when it exists (Traditional never sets
    //    r.ledger → the sections array is byte-identical there). ──
    let ledgerSection: AarSection | null = null;
    if (ctx.isHotspots && r.ledger) {
        const L = r.ledger;
        const win = L.dateFrom ? (L.dateTo && L.dateTo !== L.dateFrom ? `${L.dateFrom} → ${L.dateTo}` : L.dateFrom) : '—';
        const led: AarSection = { id: 'ledger', title: 'ITERATION LEDGER', author: ctx.voices.command, paragraphs: [] };
        led.paragraphs.push(`Mission cycle ${win} — a single-iteration accounting of the Warchest, the field, and the shop.`);
        led.headers = ['LEDGER', 'VALUE'];
        led.rows = [
            { cells: ['Warchest', `${fmt(L.warchestStart)} → ${fmt(L.warchestEnd)} SP`] },
            { cells: ['SP spent', `${fmt(L.spSpent)} SP`], tone: L.spSpent > 0 ? 'warn' : undefined },
            { cells: ['Units deployed', `${L.deployed}`] },
            { cells: ['Units gained', `${L.gained}`], tone: L.gained > 0 ? 'ok' : undefined },
            { cells: ['Units lost', `${L.lost}`], tone: L.lost > 0 ? 'bad' : undefined },
            { cells: ['Damage taken', L.damageTaken != null ? fmt(L.damageTaken) : '—'] },
            { cells: ['Damage given', L.damageGiven != null ? fmt(L.damageGiven) : '—'] },
            { cells: ['Wounds', `${L.wounds}`], tone: L.wounds > 0 ? 'warn' : undefined },
        ];
        if (L.purchases.length) {
            led.blocks = [{ headers: ['MARKET PURCHASE', 'SP'], rows: L.purchases.map((p) => ({ cells: [p.label, fmt(p.sp)] })) }];
        } else {
            led.paragraphs.push('No market purchases this cycle.');
        }
        ledgerSection = led;
    }

    // ── Section 2 — intelligence assessment ──
    const intel: AarSection = { id: 'intelligence', title: 'SECTION 2 — INTELLIGENCE ASSESSMENT', author: ctx.voices.intelligence, paragraphs: [] };
    const compromised = tier === 'COMPROMISED' || !!r.answers?.compromised;
    if (compromised) {
        intel.paragraphs.push(`MATERIAL COMPROMISE ASSESSED — the opposition learned something of consequence during this operation. Dispositions, routes, and source identities touched by ${branch.name.toUpperCase()} are to be treated as exposed.`);
        intel.paragraphs.push('Working assumption until counter-indication: watch rotations, recognition codewords, and the source list current at resolution are stale. Reissue communications through the next operation package (Appendix B); re-vet sources before tasking them again.');
    } else {
        intel.paragraphs.push('No material compromise assessed for this operation. Standing communications and source arrangements remain in force.');
    }
    if (a?.target) intel.paragraphs.push(`Opposition of record: ${a.target}${a.world ? `, engaged on ${a.world}` : ''}.`);
    const sources = (a?.npcFlags ?? []).map((f) => ctx.npcNamesByFlag[f] ? `${ctx.npcNamesByFlag[f]} (${f.replace(/-/g, ' ')})` : null).filter((x): x is string => !!x);
    if (sources.length) intel.paragraphs.push(`Source contributions on record: ${sources.join(' · ')}.`);
    if (!a) intel.note = 'No intelligence snapshot on this resolution (resolved pre-D-034) — assessment limited to the questionnaire record.';

    // ── Section 3 — the chief armorer's repair & salvage annex (D-037 density) ──
    const arm: AarSection = { id: 'armorer', title: ctx.isHotspots ? 'SECTION 3 — FIELD SETTLEMENT' : 'SECTION 3 — REPAIR & SALVAGE ANNEX', author: ctx.voices.engineering, paragraphs: [] };
    const walk = r.fieldWalk;
    if (ctx.isHotspots) {
        // DIRECTIVE-121 — Hot Spots settles at resolve (abstract SP; NO field walk). Render the SP settlement + prizes
        // in place of the Classic walk annex, so the false "walk pending" note never shows under HS.
        const st = r.settlement;
        arm.paragraphs.push(st
            ? `Settlement posted to the Warchest — Combat Pay +${fmt(st.combatPay)} SP${st.salvageSp ? `, Salvage +${fmt(st.salvageSp)} SP` : ''}. Salvage is abstracted to Support Points; claimed prize 'Mechs are physical and reduce that estimate.`
            : 'Settled at resolve — combat pay + salvage posted to the Warchest (abstract SP economy).');
        const prizes = r.prizes ?? [];
        if (prizes.length) {
            arm.blocks = [{ headers: ["PRIZE 'MECH", 'DISPOSITION'], rows: prizes.map((p) => ({ cells: [p.label, 'Captured → Cold Storage'], tone: 'ok' as const })) }];
            arm.paragraphs.push(`${prizes.length} enemy machine${prizes.length === 1 ? '' : 's'} claimed as prize${prizes.length === 1 ? '' : 's'} — hauled to cold storage for refit.`);
        } else {
            arm.paragraphs.push('No prize ’Mechs claimed this track.');
        }
    } else if (walk) {
        arm.paragraphs.push(`Field walked ${formatDate(walk.walkedDate)}. ${walk.rows.length} machines assessed where they fell.`);
        const blocks: AarBlock[] = [];
        // (a) RECOVERY & REPAIRS — our machines, each joined to its bay record where one exists
        const histByInstance = new Map(ctx.bayHistory.map((h) => [h.instanceId, h]));
        const blu = walk.rows.filter((w) => w.side === 'blufor');
        if (blu.length) {
            blocks.push({
                headers: ['UNIT', 'CONDITION', 'DISPOSITION', 'REPAIR RECORD'],
                rows: blu.map((w) => {
                    const h = histByInstance.get(w.instanceId);
                    const open = ctx.openJobs[w.instanceId];
                    // ODM-13 P3 — survival: bench time and bays, never a bench rate (the fork's costs are structurally 0).
                    const record = h
                        ? (h.outcome === 'completed' ? (ctx.survival ? `${h.laborHours} h · Bay ${h.bayName}` : `${h.laborHours} h · ${fmt(h.cost)} C-bills · Bay ${h.bayName}`) : 'WRITTEN OFF')
                        : open ? (ctx.survival ? `IN WORK — Bay ${open.bayName} (est. ${open.hours} h)` : `IN WORK — Bay ${open.bayName} (est. ${open.hours} h, ${fmt(open.cost)} C-bills)`) : '—';
                    return {
                        // TESTER-ODM-1 #7 — an UNDAMAGED machine reads "Recovered → bays" today, which the
                        // row's own record contradicts: no bay history and no open job means nothing entered
                        // a bay. Uses data already in hand; the triage model is untouched.
                        cells: [w.label, SEV_LABEL[w.severity] ?? w.severity,
                            (w.disposition === 'RECOVER' && !h && !open) ? 'Returned under own power' : (DISP_LABEL[w.disposition] ?? w.disposition),
                            record],
                        tone: w.severity === 'B' ? 'bad' as const : h?.outcome === 'completed' ? 'ok' as const : undefined,
                    };
                }),
            });
            // component-level detail per repaired machine — the walk row JOINED to its itemized bill
            for (const w of blu) {
                const h = histByInstance.get(w.instanceId);
                if (!h) continue;
                if (h.outcome === 'written-off') { blocks.push({ p: `${h.label} — struck from the rolls ${formatDate(h.date)}; ${ctx.survival ? 'beyond repair.' : 'beyond economical repair.'}` }); continue; }
                if (h.bill?.length) {
                    const comps = h.bill.map((l) => `${l.component} (${l.action}, ${l.hours} h)`).join(' · ');
                    if (ctx.survival) {
                        // ODM-13 P3 — render what Phase 2 recorded: the parts drawn from stores + any dry rearm.
                        const drawn = h.partsUsed?.length ? ` Drawn from stores: ${h.partsUsed.join(', ')}.` : '';
                        const short = h.rearmShort?.length ? ` REARMED SHORT — ${h.rearmShort.join('; ')}.` : '';
                        blocks.push({ p: `${h.label} — ${comps}. ${h.laborHours} hours of bench time, Bay ${h.bayName}, completed ${formatDate(h.date)}.${drawn}${short}` });
                    } else {
                        blocks.push({ p: `${h.label} — ${comps}. ${h.laborHours} hours of bench time, ${fmt(h.cost)} C-bills, Bay ${h.bayName}, completed ${formatDate(h.date)}.` });
                    }
                } else {
                    blocks.push({ p: `${h.label} — restored to service ${formatDate(h.date)} (${h.laborHours} h, ${fmt(h.cost)} C-bills, Bay ${h.bayName}; itemized bill not on record — completed pre-D-037).` });
                }
            }
        }
        // (b) SALVAGE & PRIZES — the other side's machines, clause math shown from stored numbers only
        const opf = walk.rows.filter((w) => w.side === 'opfor');
        if (opf.length) {
            if (ctx.survival) {
                // ODM-13 P3 — survival: no clause, no credit column; the field gives up machines, not value.
                blocks.push({ p: 'FIELD RECOVERY — the other side’s machines, as the field gave them up:' });
                blocks.push({
                    headers: ['UNIT', 'CONDITION', 'DISPOSITION'],
                    rows: opf.map((w) => ({
                        cells: [w.label, SEV_LABEL[w.severity] ?? w.severity, DISP_LABEL[w.disposition] ?? w.disposition],
                        tone: w.captured ? 'ok' as const : w.severity === 'B' ? 'bad' as const : undefined,
                    })),
                });
            } else {
                const cl = ctx.salvageClause;
                blocks.push({ p: `SALVAGE & PRIZES — settled under ${cl ? (cl.exchange ? 'the salvage-exchange share' : `the ${cl.pct}% salvage clause`) : 'the contract clause (not on record)'}:` });
                blocks.push({
                    headers: ['UNIT', 'CONDITION', 'DISPOSITION', 'CLAUSE MATH', 'CREDIT'],
                    rows: opf.map((w) => {
                        let math = '—';
                        if (w.captured) math = 'ownership change — no credit';
                        else if (w.credit && cl) math = cl.exchange ? `exchange share of ≈${fmt(w.credit * 2)} value` : cl.pct > 0 ? `${cl.pct}% of ≈${fmt(Math.round(w.credit / (cl.pct / 100)))} value` : '—';
                        return {
                            cells: [w.label, SEV_LABEL[w.severity] ?? w.severity, DISP_LABEL[w.disposition] ?? w.disposition, math, w.credit ? `+${fmt(w.credit)}` : '—'],
                            tone: w.captured ? 'ok' as const : w.severity === 'B' ? 'bad' as const : undefined,
                        };
                    }),
                });
            }
        }
        // (c) MISSION LEDGER — render-derived from the walk + the joined bay records (DATA-003)
        const walkedIds = new Set(walk.rows.map((w) => w.instanceId));
        const settled = ctx.bayHistory.filter((h) => walkedIds.has(h.instanceId) && h.outcome === 'completed');
        const repairsCost = settled.reduce((s, h) => s + h.cost, 0);
        const openCost = walk.rows.reduce((s, w) => s + (ctx.openJobs[w.instanceId]?.cost ?? 0), 0);
        if (ctx.survival) {
            // ODM-13 P3 — the SURVIVAL ledger: materiel, never money (the walk's totalCredit is structurally 0).
            const strips = walk.rows.filter((w) => w.disposition === 'STRIP').length;
            // ODM-17 P2 — the LOAD MANIFEST the walk settled under (additive: pre-P2 records carry none).
            const m = walk.manifest;
            const lift = m ? ` Load manifest: ${m.componentTons} t components · ${m.ammoTons} t ammunition · ${m.hulks} hulk${m.hulks === 1 ? '' : 's'} (${m.hulkTons} t) — bays ${m.baysUsed}/${m.liftBays} · holds ${m.cargoUsed}/${m.cargoTons} t · field crew ${m.fieldHours}/${m.fieldHoursWindow} h.` : '';
            blocks.push({ p: `FIELD MATERIEL — ${strips} machine${strips === 1 ? '' : 's'} stripped to the magazine and stores · ${settled.length} repair${settled.length === 1 ? '' : 's'} settled from stores · hulks recovered: ${walk.prizesClaimed}.${lift} The company fights on stocks, not pay.` });
            if (m?.overrideReason) blocks.push({ p: `The lift went out over capacity on the GM's order — reason logged: "${m.overrideReason}".` });
        } else {
            const ledger = [
                `Field credit +${fmt(walk.totalCredit)}`,
                `repairs settled −${fmt(repairsCost)} (${settled.length} job${settled.length === 1 ? '' : 's'})`,
                ...(openCost ? [`open estimates −${fmt(openCost)} pending`] : []),
                `net to date ${walk.totalCredit - repairsCost >= 0 ? '+' : '−'}${fmt(Math.abs(walk.totalCredit - repairsCost))} C-bills`,
            ];
            blocks.push({ p: `MISSION LEDGER — ${ledger.join(' · ')}. Prizes claimed: ${walk.prizesClaimed}. Contract pay rides the monthly schedule, not this ledger.` });
        }
        const overrides = walk.rows.filter((w) => w.overrides?.length).map((w) => `${w.label}: ${w.overrides!.join(', ')}`);
        if (overrides.length) blocks.push({ p: `GM overrides at the walk — ${overrides.join(' · ')}.` });
        arm.blocks = blocks;
    } else if (r.engaged) {
        arm.note = 'Field dispositions PENDING — the walk has not been completed. This annex fills in when the field is walked.';
    } else {
        arm.note = 'No field engagement recorded for this operation (resolved without deployed units) — no dispositions to report.';
    }
    if (ctx.voices.engineering && ctx.armorerClosing) arm.closingLine = ctx.armorerClosing;

    // ── Section 4 — personnel (D-037: live ETAs + the memorial) ──
    const pers: AarSection = { id: 'personnel', title: ctx.isHotspots ? 'SECTION 4 — LOSSES & PERSONNEL' : 'SECTION 4 — PERSONNEL', author: ctx.voices.personnel ?? ctx.voices.command, paragraphs: [] }; // ODM-14 — personnel voice when supplied; Classic falls back to command, byte-identical
    if (ctx.isHotspots) {
        // DIRECTIVE-121 — Hot Spots losses (own units retired + pilot fates), recorded at resolve (no field walk).
        const losses = r.losses ?? [];
        if (losses.length) {
            pers.headers = ['UNIT', 'LOSS', 'PILOT'];
            pers.rows = losses.map((l) => ({ cells: [l.label, l.reason === 'destroyed' ? 'Destroyed in action' : 'Abandoned on the field', l.pilotFate === 'kia' ? 'KILLED IN ACTION' : l.pilotFate === 'injured' ? 'Injured — recovering' : 'Walked out'], tone: l.pilotFate === 'kia' ? 'bad' as const : l.reason === 'destroyed' ? 'warn' as const : undefined }));
            const kia = losses.filter((l) => l.pilotFate === 'kia').length;
            pers.paragraphs.push(`${losses.length} machine${losses.length === 1 ? '' : 's'} lost this track${kia ? `; ${kia} pilot${kia === 1 ? '' : 's'} killed — the dead stay dead, the table will remember` : '; all pilots accounted for'}.`);
        } else {
            pers.paragraphs.push('No losses — the whole command returned intact.');
        }
    } else if (walk) {
        const hit = walk.rows.filter((w) => w.pilot && w.pilot.status !== 'OK');
        if (hit.length) {
            pers.headers = ['PILOT', 'OUTCOME', 'RECOVERY / MEMORIAL'];
            pers.rows = hit.map((w) => {
                const info = ctx.pilotInfoOf(w.pilot!.pilotId);
                const name = info?.name ?? `Crew, ${w.label}`;
                if (w.pilot!.status === 'KIA') {
                    return { cells: [name, 'KILLED IN ACTION', info?.kiaDateText ? `fell ${info.kiaDateText}` : '—'], tone: 'bad' as const };
                }
                const eta = info?.status === 'Active'
                    ? `${w.pilot!.recoveryDays} days at the walk — since returned to duty`
                    : info?.recoveryDays != null
                        ? `${w.pilot!.recoveryDays} days at the walk · ETA ${info.recoveryDays} remaining`
                        : `${w.pilot!.recoveryDays} days`;
                return { cells: [name, `WOUNDED (${w.pilot!.hits} hit${w.pilot!.hits === 1 ? '' : 's'})`, eta], tone: 'warn' as const };
            });
            const fallen = hit.filter((w) => w.pilot!.status === 'KIA').map((w) => {
                const info = ctx.pilotInfoOf(w.pilot!.pilotId);
                return info ? `${info.name}${info.kiaDateText ? ` (fell ${info.kiaDateText})` : ''}` : `the crew of ${w.label}`;
            });
            pers.paragraphs.push(fallen.length
                ? `The roster carries the name${fallen.length === 1 ? '' : 's'}: ${fallen.join(' · ')}. The dead stay dead; the table will remember.`
                : 'No deaths. The wounded are tracked through recovery on the Barracks infirmary.');
        } else {
            pers.paragraphs.push('All hands returned without recorded injury.');
        }
    } else {
        pers.note = 'No personnel record — the operation resolved without a completed field walk.';
    }

    return {
        classbar: registerClassbar(ctx.register),
        stamp: registerStamp(ctx.register),
        unitLine: `${ctx.unitSizeName.toUpperCase()} · ${ctx.commandName.toUpperCase()}`,
        opName: branch.name.toUpperCase(),
        locLine: a?.world ? `${a.world}${a.district ? ' · ' + a.district : ''}`.toUpperCase() : '',
        // IMPORT-6 FOLLOWUPS — Hot Spots adds the book grade the resolve modal showed; Traditional's line is byte-identical.
        tierLine: `OUTCOME — ${tier}${ctx.isHotspots && TIER_GRADE[tier] ? ` · ${TIER_GRADE[tier]}` : ''}${r.override ? ' · GM OVERRIDE' : ''}`,
        dateLine: r.resolvedDate ? `RESOLVED ${formatDate(r.resolvedDate).toUpperCase()}` : 'RESOLUTION DATE NOT RECORDED',
        context: ctx.contextLabel,
        override: !!r.override,
        sections: (ledgerSection ? [cmd, ledgerSection, intel, arm, pers] : [cmd, intel, arm, pers]).map((s) => applyRefined(s, ctx.refined)),
        closing: registerClosing(ctx.register),
        source: `After-action render · ${branch.branchId} · register ${ctx.register || 'neutral'}`,
    };
}

/** D-038 — prefer narrator-refined-and-verified prose for a section: replace its template paragraphs
 *  (tables/blocks/notes/closingLine stay — locked data + the authored precept are never refined). */
function applyRefined(s: AarSection, refined: AarContext['refined']): AarSection {
    const r = refined?.[s.id];
    if (!r?.verified || !r.text.trim()) return s;
    return { ...s, paragraphs: r.text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean), refined: true };
}

/** Deterministic index for the armorer's closing precept — stable per mission (render-identical). */
export function stableIndex(key: string, len: number): number {
    if (len <= 0) return 0;
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    return h % len;
}
