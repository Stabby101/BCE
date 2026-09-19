import type { HotSpot, HotSpotTrack, ObjectiveKind, HotSpotFork, SideOffer, HotSpotContractTerms, HotSpotHireable } from './hotspots-catalog';
import { snapValidStep } from './chaos-contract-steps';

//    faction), so it is never a form field. `role` is opposed across the pair (Side B = opposite of Side A).
//    is the SAME op framed by two employers, so each has its own name + briefing (shared: world/length/planet). ──
export interface DraftSide {
    role: 'attacker' | 'defender';
    title: string; type: string;
    employer: string; employerDesc: string;
    faction: string;
    situation: string;
    blurb: string;
    basePay: number; support: number; transport: number; salvage: number; command: number;
}
export function emptySide(role: 'attacker' | 'defender'): DraftSide {
    // 6=50% · salvage 6=40% · command 6=House. (The old flat 5 left command@5 on a dead `—` step.)
    return { role, title: '', type: '', employer: '', employerDesc: '', faction: '', situation: '', blurb: '', basePay: 6, support: 5, transport: 6, salvage: 6, command: 6 };
}
export const oppositeRole = (r: 'attacker' | 'defender'): 'attacker' | 'defender' => (r === 'attacker' ? 'defender' : 'attacker');

// ── the editable draft shape (the form binds to this; the parser fills it; the builder emits a HotSpot) ──
export interface DraftObjective { text: string; vp: number; kind: ObjectiveKind; side: 'both' | 'attacker' | 'defender'; }
export interface DraftHireable {
    name: string; role: string;
    gunnery: number; piloting: number; edge: number;
    chassis: string; model: string; bv: number;
    spCost: number; oneTimeHire: boolean;
}
export function emptyHireable(): DraftHireable {
    return { name: '', role: '', gunnery: 4, piloting: 5, edge: 1, chassis: '', model: '', bv: 0, spCost: 100, oneTimeHire: false };
}
export interface DraftTrack {
    name: string;
    templateId: string;
    situation: string;
    deployment: string;
    playerRole: '' | 'attacker' | 'defender';
    objectives: DraftObjective[];
    specialRules: string;
    trackEnd: string;
    salvagePolicy: string;
    opforFaction: string;
    armsMix: 'MECH_ONLY' | 'COMBINED_ARMS';
}
export interface HotSpotDraft {
    title: string;
    world: string;
    employer: string;
    employerDesc: string;
    type: string;
    blurb: string;
    situation: string;
    starType: string;
    surfaceGravity: string;
    atmPressure: string;
    climate: string;
    population: string;
    capitalCity: string;
    positionInSystem: string;
    timeToJumpPointDays: string;
    rechargeHours: string;
    satellites: string;
    equatorialTempC: string;
    surfaceWaterPct: string;
    hpgClass: string;
    socioIndustrial: string;
    planetDescription: string;
    // contract terms
    scale: number;
    intensity: number;
    lengthMonths: number;
    enemyFaction: string;
    basePay: number;
    support: number;
    transport: number;
    salvage: number;
    command: number;
    constraints: string;
    additionalRequirements: string;
    bonus: string;
    // mission brief
    contractVictory: string;
    behindScenes: string;
    twoSided: boolean;
    sideA: DraftSide;
    sideB: DraftSide;
    tracks: DraftTrack[];
    hireable: DraftHireable[];
}

export function emptyObjective(): DraftObjective { return { text: '', vp: 100, kind: 'primary', side: 'both' }; }
export function emptyTrack(): DraftTrack {
    return {
        name: '', templateId: 'Objective', situation: '', deployment: '', playerRole: '',
        objectives: [emptyObjective()], specialRules: '', trackEnd: '', salvagePolicy: '',
        opforFaction: '', armsMix: 'MECH_ONLY',
    };
}
export function emptyDraft(): HotSpotDraft {
    return {
        title: '', world: '', employer: '', employerDesc: '', type: '', blurb: '', situation: '',
        starType: '', surfaceGravity: '', atmPressure: '', climate: '', population: '', capitalCity: '',
        positionInSystem: '', timeToJumpPointDays: '', rechargeHours: '', satellites: '', equatorialTempC: '',
        surfaceWaterPct: '', hpgClass: '', socioIndustrial: '', planetDescription: '',
        scale: 1, intensity: 1, lengthMonths: 1, enemyFaction: '',
        basePay: 6, support: 5, transport: 6, salvage: 6, command: 6,
        constraints: '', additionalRequirements: '', bonus: '',
        contractVictory: '', behindScenes: '',
        twoSided: false, sideA: emptySide('attacker'), sideB: emptySide('defender'),
        tracks: [emptyTrack()],
        hireable: [],
    };
}

// ── the strict SAVE validation (parsing is lenient; saving is strict) ──
const meaningfulTracks = (d: HotSpotDraft): DraftTrack[] => d.tracks.filter((t) => t.name.trim() || t.objectives.some((o) => o.text.trim()));
const meaningfulHireables = (d: HotSpotDraft): DraftHireable[] => (d.hireable ?? []).filter((h) => h.name.trim() || h.role.trim() || h.chassis.trim());

export function validateDraft(d: HotSpotDraft): string[] {
    const errs: string[] = [];
    // identity comes from each side. So require the per-side titles there, and the shared title only single-sided.
    if (!d.twoSided && !d.title.trim()) errs.push('A title is required.');
    // needs a title + an employer + a faction; the two roles must be opposed (one attacker, one defender); the two
    // factions must be distinct (the OpFor is the OTHER side). Single-sided validation is unchanged.
    if (d.twoSided) {
        const a = d.sideA, b = d.sideB;
        if (!a.title.trim()) errs.push('Side A needs an operation title.');
        if (!b.title.trim()) errs.push('Side B needs an operation title.');
        if (!a.employer.trim() || !a.faction.trim()) errs.push('Side A needs an employer and a faction.');
        if (!b.employer.trim() || !b.faction.trim()) errs.push('Side B needs an employer and a faction.');
        if (a.role === b.role) errs.push('The two sides must be opposed — one attacker and one defender.');
        if (a.faction.trim() && b.faction.trim() && a.faction.trim().toLowerCase() === b.faction.trim().toLowerCase()) {
            errs.push('The two sides must field different factions (the OpFor is the opposing side).');
        }
    }
    meaningfulTracks(d).forEach((t, i) => {
        if (!t.name.trim()) errs.push(`Track ${i + 1} needs a name (or clear it to draw from the library).`);
        else if (!t.objectives.some((o) => o.text.trim())) errs.push(`Track "${t.name.trim()}" needs at least one objective.`);
    });
    // hire-personnel-panel `@for … track h.name`, hire-personnel `contractHiredKeys`), and names must be UNIQUE
    // (case-insensitive, trimmed) for the same reason, and a specialist costs ≥1 SP (the deploy panel reads a 0 charge as
    // "already paid"). Skills are coerced at emit, never validation errors. Row numbers are FORM rows (pristine rows skipped).
    const seenNames = new Set<string>();
    let dupName = false;
    const meaningful = new Set(meaningfulHireables(d));
    (d.hireable ?? []).forEach((h, i) => {
        if (!meaningful.has(h)) return;
        const nm = h.name.trim();
        if (!nm) { errs.push(`Special personnel row ${i + 1} needs a name.`); return; }
        if (!(Number(h.spCost) > 0)) errs.push(`Special personnel "${nm}" needs a Support-Point cost (≥ 1).`);
        const key = nm.toLowerCase();
        if (seenNames.has(key)) dupName = true; else seenNames.add(key);
    });
    if (dupName) errs.push('Each hired specialist needs a unique name.');
    return errs; // 0 meaningful tracks is VALID — the hot spot uses the universal library at play time
}

// ── draft → HotSpot (the builder mints the persisted shape; the caller adds id + custom:true) ──
export function draftToHotSpot(d: HotSpotDraft): Omit<HotSpot, 'id'> {
    const src = meaningfulTracks(d);
    const tracks: HotSpotTrack[] = src.map((t, i) => {
        const trackId = `t${i}`;
        const nextId = i + 1 < src.length ? `t${i + 1}` : null;
        const forks: HotSpotFork[] = nextId
            ? [{ outcomeGate: 'ANY', nextTrackId: nextId, trigger: '', consequence: '', threat: 'MEDIUM' }]
            : [];
        return {
            id: trackId,
            name: t.name.trim() || `Track ${i + 1}`,
            templateId: t.templateId || 'Objective',
            root: i === 0,
            situation: t.situation,
            deployment: t.deployment,
            ...(t.playerRole ? { playerRole: t.playerRole } : {}),
            objectives: t.objectives
                .filter((o) => o.text.trim())
                .map((o) => ({ text: o.text.trim(), vp: Number(o.vp) || 0, kind: o.kind, side: o.side })),
            specialRules: t.specialRules || undefined,
            trackEnd: t.trackEnd,
            salvagePolicy: t.salvagePolicy,
            opfor: { faction: t.opforFaction || undefined, armsMix: t.armsMix },
            forks,
        };
    });
    const num = (s: string): number | undefined => { const n = Number(String(s).trim()); return s.trim() && !Number.isNaN(n) ? n : undefined; };
    const str = (s: string): string | undefined => (s.trim() || undefined);
    // shared contract fields (scale/intensity/length + constraints/bonus) — top-level, not per side.
    const sharedTerms = () => ({
        scale: Math.max(1, Math.round(Number(d.scale) || 1)),
        intensity: Math.max(1, Math.round(Number(d.intensity) || 1)),
        lengthMonths: Math.max(1, Math.round(Number(d.lengthMonths) || 1)),
        constraints: d.constraints.trim() || undefined,
        additionalRequirements: d.additionalRequirements.trim() || undefined,
        bonus: d.bonus.trim() || undefined,
    });
    // pasted value can never persist a dead index (which rendered transport blank + non-negotiable and zeroed its cover).
    const stepsOf = (s: { basePay: number; support: number; transport: number; salvage: number; command: number }) => ({
        basePay: snapValidStep('basePay', s.basePay), support: snapValidStep('support', s.support), transport: snapValidStep('transport', s.transport), salvage: snapValidStep('salvage', s.salvage), command: snapValidStep('command', s.command),
    });
    // OTHER side's faction). Side B's role is enforced opposite. `synthesized` is absent (these are authored). Each
    let sides: { a: SideOffer; b: SideOffer } | undefined;
    if (d.twoSided) {
        const aRole = d.sideA.role, bRole = oppositeRole(aRole);
        const aFac = d.sideA.faction.trim(), bFac = d.sideB.faction.trim();
        const sideContract = (s: DraftSide, enemyFaction: string): HotSpotContractTerms => ({ ...sharedTerms(), steps: stepsOf(s), enemyFaction });
        const sideOffer = (s: DraftSide, key: 'a' | 'b', role: 'attacker' | 'defender', enemyFaction: string): SideOffer => ({
            key, role, title: str(s.title), type: str(s.type), employer: s.employer.trim(), employerDesc: str(s.employerDesc),
            faction: s.faction.trim(), contract: sideContract(s, enemyFaction), situation: str(s.situation), blurb: s.blurb.trim() || undefined,
        });
        sides = { a: sideOffer(d.sideA, 'a', aRole, bFac), b: sideOffer(d.sideB, 'b', bRole, aFac) };
    }
    // Numbers are COERCED + floored (never NaN into buildMercPilot); OPTIONALS ARE OMITTED when blank/zero (an
    // emitted `chassis: ''` would NOT fall through buildMercInstance's `??` chain to the name; `edge` is only
    // meaningful ≥1; `oneTimeHire` only when true). Only MEANINGFUL rows are emitted (a pristine ＋Add'd row is dropped).
    const hireable: HotSpotHireable[] = meaningfulHireables(d).map((m) => ({
        name: m.name.trim(), role: m.role.trim(),
        gunnery: Math.max(0, Math.round(Number(m.gunnery) || 0)),
        piloting: Math.max(0, Math.round(Number(m.piloting) || 0)),
        ...(Number(m.edge) > 0 ? { edge: Math.max(1, Math.round(Number(m.edge))) } : {}),
        ...(str(m.chassis) ? { chassis: m.chassis.trim() } : {}),
        ...(str(m.model) ? { model: m.model.trim() } : {}),
        ...(Number(m.bv) > 0 ? { bv: Math.round(Number(m.bv)) } : {}),
        spCost: Math.max(0, Math.round(Number(m.spCost) || 0)),
        ...(m.oneTimeHire ? { oneTimeHire: true } : {}),
    }));
    // The top-level fields stay populated so a legacy / `sides`-less reader (and the offer-card WORLD header) still work.
    // In two-sided mode they FALL BACK to side A (mirroring how `employer` already does), since the shared form fields
    // are hidden and each side owns its identity.
    const contract: HotSpotContractTerms = sides ? sides.a.contract : { ...sharedTerms(), steps: stepsOf(d), enemyFaction: d.enemyFaction.trim() };
    return {
        title: sides ? (d.sideA.title.trim() || d.title.trim()) : d.title.trim(),
        world: d.world.trim(),
        employer: sides ? sides.a.employer : d.employer.trim(),
        employerDesc: sides ? str(d.sideA.employerDesc) : str(d.employerDesc),
        type: (sides ? d.sideA.type.trim() : d.type.trim()) || 'Objective Raid',
        blurb: (sides ? d.sideA.blurb.trim() : d.blurb.trim()) || undefined,
        systemProfile: {
            starType: str(d.starType), surfaceGravity: num(d.surfaceGravity), atmPressure: str(d.atmPressure),
            climate: str(d.climate), population: num(d.population), capitalCity: str(d.capitalCity),
            positionInSystem: str(d.positionInSystem), timeToJumpPointDays: num(d.timeToJumpPointDays), rechargeHours: num(d.rechargeHours),
            satellites: str(d.satellites), equatorialTempC: num(d.equatorialTempC), surfaceWaterPct: num(d.surfaceWaterPct),
            hpgClass: str(d.hpgClass), socioIndustrial: str(d.socioIndustrial), description: str(d.planetDescription),
        },
        situation: sides ? d.sideA.situation : d.situation,
        contract,
        ...(sides ? { sides } : { singleSided: true }),
        missionBrief: {
            complications: [],
            contractVictory: d.contractVictory.trim(),
            tally: null,
            behindScenes: d.behindScenes.trim() || undefined,
        },
        tracks,
        ...(hireable.length ? { hireable } : {}),
    };
}

// ── the lenient plain-text parser (§16 label map) ──────────────────────────────────────────────────────
const SEP = /\s*[:\-—–]\s+/; // "Label: value" | "Label — value" | "Label - value"
/** First "Label … value" match across the given lines for any of the label regexes (value = rest of the
 *  line after the separator, else the next non-empty line). Case-insensitive; anchored at line start. */
function grab(lines: string[], labels: RegExp[]): string {
    for (let i = 0; i < lines.length; i++) {
        for (const lab of labels) {
            const m = lines[i].match(lab);
            if (m) {
                const after = lines[i].slice(m[0].length).replace(SEP, '').trim();
                if (after) return after;
                // label alone on its own line → take the next non-empty line
                for (let j = i + 1; j < lines.length; j++) { if (lines[j].trim()) return lines[j].trim(); }
            }
        }
    }
    return '';
}
const num = (s: string): number | null => { const m = s.replace(/,/g, '').match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : null; };
/** A negotiated term is written "value (step)"; the STEP (the parenthetical) is what BCE uses. Fall back to the
 *  first bare integer if there is no parenthetical, else null. */
const stepFrom = (s: string): number | null => { const p = s.match(/\((\d+)\)/); if (p) return Number(p[1]); return num(s); };
const lab = (...words: string[]): RegExp => new RegExp('^\\s*(?:' + words.join('|') + ')\\b', 'i');
/** A track HEADING: "Track" followed by a number, a number-word, or a name separator — NOT "Track End" etc. */
const TRACK_HEADING = /^\s*track\b\s*(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|[:\-—–])/i;

/** Parse a GM's pasted mission text into a partial draft (pre-fill only). Recognised fields are filled; the
 *  rest stay at their empty-draft defaults. Never throws — unrecognised text is simply ignored. */
export function parseHotspotText(text: string): HotSpotDraft {
    const d = emptyDraft();
    if (!text || !text.trim()) return d;
    const allLines = text.replace(/\r\n?/g, '\n').split('\n');

    // Split into an intro/contract block + track blocks. A track HEADING is "Track <n>" / "Track <word>" /
    // "Track: <name>" — deliberately NOT "Track End" / "Track Name" / "Track Type" (which are track FIELDS, not
    // new headings), so those don't spuriously start a block.
    const trackStarts: number[] = [];
    allLines.forEach((l, i) => { if (TRACK_HEADING.test(l)) trackStarts.push(i); });
    const introLines = trackStarts.length ? allLines.slice(0, trackStarts[0]) : allLines;

    // ── identity + contract + brief (whole-text / intro block) ──
    d.title = grab(allLines, [lab('Title', 'Operation', 'Mission', 'Hot ?Spot', 'Name of Operation')]) || d.title;
    d.world = grab(introLines, [lab('Location', 'World', 'Planet', 'System')]).replace(/\s*\(.*$/, '').trim() || d.world;
    d.employer = grab(introLines, [lab('Employer')]) || d.employer;
    d.type = grab(introLines, [lab('Type of Action', 'Type of Mission', 'Type')]) || d.type;
    d.blurb = grab(introLines, [lab('Summary', 'Blurb', 'Teaser', 'Synopsis')]) || d.blurb;
    d.situation = grab(introLines, [lab('Overview', 'Briefing', 'Background')]) || d.situation;
    d.enemyFaction = grab(introLines, [lab('Enemy', 'Opponent', 'Opposing Force', 'OpFor')]) || d.enemyFaction;
    d.behindScenes = grab(introLines, [lab('Behind the Scenes')]) || d.behindScenes;
    d.contractVictory = grab(introLines, [lab('Contract Victory', 'Victory Conditions', 'Victory Condition')]) || d.contractVictory;
    d.additionalRequirements = grab(introLines, [lab('Additional Requirements')]) || d.additionalRequirements;
    d.bonus = grab(introLines, [lab('Bonus', 'Bonus Terms')]) || d.bonus;
    d.constraints = grab(introLines, [lab('Constraints', 'Term Constraints')]) || d.constraints;

    const setNum = (v: number | null, apply: (n: number) => void) => { if (v != null) apply(v); };
    setNum(num(grab(introLines, [lab('Length of Contract', 'Length', 'Contract Length')])), (n) => (d.lengthMonths = n));
    setNum(num(grab(introLines, [lab('Intensity', 'Number of Tracks')])), (n) => (d.intensity = n));
    setNum(num(grab(introLines, [lab('Scale', 'Track Scale', 'Contract Scale')])), (n) => (d.scale = n));
    setNum(stepFrom(grab(introLines, [lab('Base Pay')])), (n) => (d.basePay = n));
    setNum(stepFrom(grab(introLines, [lab('Support')])), (n) => (d.support = n));
    setNum(stepFrom(grab(introLines, [lab('Transportation', 'Transport')])), (n) => (d.transport = n));
    setNum(stepFrom(grab(introLines, [lab('Salvage Rights', 'Salvage')])), (n) => (d.salvage = n));
    setNum(stepFrom(grab(introLines, [lab('Command Rights', 'Command')])), (n) => (d.command = n));

    // ── track blocks ──
    const blocks: string[][] = [];
    if (trackStarts.length) {
        for (let k = 0; k < trackStarts.length; k++) {
            blocks.push(allLines.slice(trackStarts[k], trackStarts[k + 1] ?? allLines.length));
        }
    } else {
        blocks.push(allLines); // no "Track" headings → the whole text is one track
    }
    const tracks: DraftTrack[] = blocks.map((block, i) => {
        const t = emptyTrack();
        const head = block[0] ?? '';
        // "Track 1: Fort Bourgogne Walls" → name after the separator
        const nameM = head.match(/^\s*track\b[^:\-—–]*[:\-—–]\s*(.+)$/i);
        t.name = (nameM ? nameM[1].trim() : grab(block, [lab('Track Name', 'Name')])) || `Track ${i + 1}`;
        t.templateId = grab(block, [lab('Template', 'Track Type', 'Archetype')]) || t.templateId;
        t.situation = grab(block, [lab('Situation')]) || t.situation;
        t.deployment = grab(block, [lab('Deployment', 'Setup')]) || t.deployment;
        t.specialRules = grab(block, [lab('Special Rules', 'Special Rule')]) || t.specialRules;
        t.trackEnd = grab(block, [lab('Track End', 'End of Track', 'Ends When')]) || t.trackEnd;
        t.salvagePolicy = grab(block, [lab('Salvage Policy', 'Salvage')]) || t.salvagePolicy;
        // Attacker / Defender → the OTHER side is the OpFor (best-effort; the GM confirms player role).
        const attacker = grab(block, [lab('Attacker')]);
        const defender = grab(block, [lab('Defender')]);
        t.opforFaction = defender || attacker || t.opforFaction;
        // Objectives — the lines under the "Objectives"/"Victory Points" label until the next known label; each
        // objective line's trailing number is its VP ("Destroy the depot (4 VP)" / "Hold the bridge — 3").
        t.objectives = parseObjectives(block);
        if (!t.objectives.length) t.objectives = [emptyObjective()];
        return t;
    });
    if (tracks.length) d.tracks = tracks;
    // if the top-level situation is blank, borrow the root track's
    if (!d.situation && d.tracks[0]?.situation) d.situation = d.tracks[0].situation;
    return d;
}

const STOP_LABEL = /^\s*(?:situation|deployment|setup|attacker|defender|special rules?|track end|ends when|salvage|objectives?|victory points?|template|track type|archetype|aftermath|forks?|track\b|employer|type of|length|intensity|scale|base pay|support|transport|command|bonus|additional)/i;
function parseObjectives(block: string[]): DraftObjective[] {
    const out: DraftObjective[] = [];
    let inObj = false;
    for (const raw of block) {
        const line = raw.trim();
        if (/^\s*(objectives?|victory points?)\b/i.test(raw)) {
            inObj = true;
            const after = raw.replace(/^\s*(objectives?|victory points?)\s*[:\-—–]?\s*/i, '').trim();
            if (after) pushObjective(out, after);
            continue;
        }
        if (!inObj) continue;
        if (!line) continue; // blank line inside the list is tolerated
        if (STOP_LABEL.test(raw)) break; // a new section ends the objective list
        pushObjective(out, line);
    }
    return out;
}
function pushObjective(out: DraftObjective[], line: string): void {
    const text = line.replace(/^[-*•\d.)\s]+/, '').trim(); // strip a bullet / list marker
    if (!text) return;
    // trailing VP: "(4 VP)" | "— 4" | "…: 4" | a bare trailing integer
    const vpM = text.match(/\(?\b(\d{1,3})\s*(?:vp|pts?|points?)?\)?\s*$/i);
    const vp = vpM ? Number(vpM[1]) : 100;
    const clean = vpM ? text.slice(0, vpM.index).replace(/[\s(—–\-:]+$/, '').trim() || text : text;
    out.push({ text: clean, vp, kind: 'primary', side: 'both' });
}
