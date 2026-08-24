/*
 * BCE LOCAL NARRATOR — prompt builders (DIRECTIVE-038). Pure. Two split calls, DATA-003 at the prompt:
 * REFINE = free-text, per-section, prose-only over a READ-ONLY locked spec; VALIDATE = a json_schema
 * lint of the quality formula (schema ALSO echoed in-prompt — the proven-reliable pattern). The MACHINE
 * DIFF (machine-diff.ts) is the real gate; the prompt's "untouchable" instruction is belt-and-braces.
 */
import { numbersIn } from './machine-diff';
import type { RefineTarget, VoiceBoxTarget } from './narrator-types';

/** A short ASH-CURFEW-style exemplar excerpt (BCE-original; the house dossier register, terse + concrete). */
const EXEMPLAR =
    'The causeway has a pulse and the garrison learned it in twenty-six months: lantern counts at the ' +
    'half-hour, ghost returns off the dredge spoil, barge traffic that thins after the second watch. An ' +
    'honest night sounds like all three. A wrong one is quieter by one lantern, and the duty officer is ' +
    'not woken for arithmetic — he is woken for the silence that follows it.';

const CHECKLIST = [
    'No vague filler ("various", "a number of", "some forces") — name the thing or cut it.',
    'Every figure, callsign, objective, fork, and cost stays EXACTLY as given — you are polishing prose, not facts.',
    'Intelligence ages: where the source text dates a fact, keep the dating.',
    'Options stay balanced — never editorialize one choice as obviously right.',
    'Match the staff voice\'s speech rules; stay in register; US military-brief cadence.',
];

export interface ChatBody {
    messages: { role: string; content: string }[];
    temperature?: number;
    top_p?: number;
    max_tokens?: number;
    stream: false;
    response_format?: unknown;
}

const REFINE_SCHEMA = {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text'],
    additionalProperties: false,
};

/** REFINE — polish ONE section's prose in voice, over the locked spec as read-only context. D-045
 *  hardening: returns STRUCTURED JSON {text} (the service parses `text`; any chain-of-thought or prompt
 *  scaffolding the model emits OUTSIDE the JSON is dropped — no leak), and the LOCKED list is SCOPED to
 *  this section's own values (the old whole-package manifest forced §2 to insert values it never owned,
 *  mangling it + leaking the struggle). The machine diff + the §2/AAR noInventedNumbers guard still gate. */
export function buildRefine(target: RefineTarget, voiceCard: { name: string; speechRules: string[] } | null, register: string): ChatBody {
    const voice = voiceCard
        ? `STAFF VOICE — ${voiceCard.name}. Speech rules (obey verbatim):\n${voiceCard.speechRules.map((r) => `  • ${r}`).join('\n')}`
        : 'STAFF VOICE — neutral command register (no assigned officer).';
    const sys =
        'You are the staff writer for a BattleTech mercenary command, polishing one section of an ' +
        'operational document. You rewrite for clarity, concreteness, and voice — NEVER for content. ' +
        'Every number, name, callsign, objective, fork, cost, and date in the SECTION is LOCKED: reproduce ' +
        'each exactly, all present; invent NO new figure, unit, date, name, or outcome. Do not narrate your ' +
        'reasoning. Output STRICT JSON {"text": "<the polished section prose>"} — prose only in `text`, no ' +
        'preamble, no headers, no commentary, no markdown, and NOTHING outside the JSON object.';
    // SCOPE the locked list to THIS section (D-045): only names whose token actually appears in the
    // section text + the section's own figures (numbersIn is in-section by definition). Never the
    // whole-package manifest — that ordered §2 to force in values it never owned.
    const txt = target.text.toLowerCase();
    const inSection = (n: string): boolean => {
        const t = (n || '').trim().toLowerCase();
        if (!t) return false;
        if (txt.includes(t)) return true;
        return t.split(/\s+/).some((w) => w.length >= 4 && txt.includes(w));
    };
    const locked = [...target.names.filter(inSection), ...numbersIn(target.text)];
    const user =
        `REGISTER: ${register || 'neutral'}\n\n${voice}\n\n` +
        `QUALITY CHECKLIST:\n${CHECKLIST.map((c) => `  • ${c}`).join('\n')}\n\n` +
        `EXEMPLAR (tone only — do not copy its content):\n${EXEMPLAR}\n\n` +
        `LOCKED VALUES for THIS section — reproduce each exactly; add NO figure or name not listed here:\n  ${locked.join(' · ') || '(none — prose only)'}\n\n` +
        `SECTION TO POLISH (rewrite this prose in voice; keep every value above verbatim, invent none):\n"""\n${target.text}\n"""`;
    return {
        messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
        temperature: 0.3, top_p: 0.9, max_tokens: 700, stream: false,
        response_format: { type: 'json_schema', json_schema: { name: 'refined_prose', strict: true, schema: REFINE_SCHEMA } },
    };
}

const VALIDATE_SCHEMA = {
    type: 'object',
    properties: {
        vagueWords: { type: 'array', items: { type: 'string' } },
        missingIntelAge: { type: 'boolean' },
        optionImbalance: { type: 'boolean' },
        numberDrift: { type: 'boolean' },
        verdict: { type: 'string', enum: ['pass', 'warn', 'fail'] },
    },
    required: ['vagueWords', 'missingIntelAge', 'optionImbalance', 'numberDrift', 'verdict'],
    additionalProperties: false,
};

/** VALIDATE — lint the refined prose against the locked source; structured verdict. */
export function buildValidate(refined: string, source: string): ChatBody {
    const sys =
        'You are a quality auditor for operational documents. Compare the REFINED prose against the SOURCE ' +
        'and report findings as STRICT JSON matching the schema — no prose, no markdown, JSON only.';
    const user =
        `SCHEMA (return exactly this shape):\n${JSON.stringify(VALIDATE_SCHEMA)}\n\n` +
        'Findings:\n' +
        '  • vagueWords: list any vague filler the refined prose introduced ("various", "several", "some", "a number of", "etc").\n' +
        '  • missingIntelAge: true if the source dated/aged a fact and the refined prose dropped the dating.\n' +
        '  • optionImbalance: true if the refined prose editorializes one option/choice as obviously correct.\n' +
        '  • numberDrift: true if ANY number, name, callsign, or cost differs from the source.\n' +
        '  • verdict: "pass" (clean), "warn" (style only), or "fail" (numberDrift or fabricated content).\n\n' +
        `SOURCE:\n"""\n${source}\n"""\n\nREFINED:\n"""\n${refined}\n"""`;
    return {
        messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
        temperature: 0, max_tokens: 400, stream: false,
        response_format: { type: 'json_schema', json_schema: { name: 'validate_report', strict: true, schema: VALIDATE_SCHEMA } },
    };
}

// ── D-043 narrator v2 — the WHOLE-MISSION pass (voice rewrite + coherence verdict) ──

const VOICE_SCHEMA = {
    type: 'object',
    properties: {
        boxes: {
            type: 'array',
            items: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' } }, required: ['id', 'text'], additionalProperties: false },
        },
    },
    required: ['boxes'],
    additionalProperties: false,
};

/** JOB 1 — rewrite the staff-voice sidebar boxes MISSION-AWARE, over the whole assembled package as
 *  context. Each box speaks to THIS operation in that officer's voice (speechRules bind). The model may
 *  cite ONLY figures present in the locked manifest (the machine diff's noInventedNumbers re-checks).
 *  Returns strict JSON {boxes:[{id,text}]}. The Pale-Candle exemplar sets the FEEL (authored, in-world). */
export function buildVoiceRewrite(pkg: string, boxes: VoiceBoxTarget[], register: string, lockedManifest: string[]): ChatBody {
    const sys =
        'You are the staff writer for a BattleTech mercenary command, voicing its officers in an operational ' +
        'briefing. Rewrite each officer\'s sidebar note so it speaks to THIS operation in THAT officer\'s voice — ' +
        'name the world, the opposing commander, the objective, the clock, and the terrain exactly as they appear ' +
        'in the package below. Concrete, atmospheric, in-world prose — never generic, never template boilerplate. ' +
        'Obey each officer\'s speech rules verbatim. Do NOT invent numbers, units, dates, or outcomes: every figure ' +
        'you cite MUST already appear in the package/manifest. Write NO digits at all unless that exact figure ' +
        'appears above — do NOT invent clock times (e.g. 0400), radio frequencies (e.g. 12.4), counts, or ' +
        'distances for flavor; carry atmosphere with names, terrain, and the officer\'s voice instead. A ' +
        'fabricated number is rejected outright. Output ONLY strict JSON {"boxes":[{"id","text"}]} — ' +
        'one entry per requested box; "text" is the rewritten note (2-4 sentences), no header, no markdown.';
    const boxList = boxes
        .map((b) => `BOX id="${b.id}" — ${b.name}\n  speech rules: ${b.speechRules.join(' · ')}\n  address: ${b.commentOn}\n  current sample (tone reference only): ${b.stub.join(' / ')}`)
        .join('\n\n');
    const user =
        `REGISTER: ${register || 'neutral'}\n\n` +
        `EXEMPLAR (the TARGET FEEL — authored, atmospheric, in-world; do not copy its content):\n${EXEMPLAR}\n\n` +
        `LOCKED FIGURES (the ONLY numbers you may use — copy exactly, invent none):\n  ${lockedManifest.join(' · ') || '(none)'}\n\n` +
        `=== THE OPERATION PACKAGE (your context — make every voice fit it) ===\n${pkg}\n=== END PACKAGE ===\n\n` +
        `Write these ${boxes.length} voice boxes (return the JSON):\n${boxList}`;
    return {
        messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
        temperature: 0.4, top_p: 0.9, max_tokens: 1000, stream: false,
        response_format: { type: 'json_schema', json_schema: { name: 'voice_boxes', strict: true, schema: VOICE_SCHEMA } },
    };
}

const COHERENCE_SCHEMA = {
    type: 'object',
    properties: {
        reads: { type: 'string', enum: ['clean', 'flags'] },
        flags: {
            type: 'array',
            items: { type: 'object', properties: { where: { type: 'string' }, issue: { type: 'string' } }, required: ['where', 'issue'], additionalProperties: false },
        },
    },
    required: ['reads', 'flags'],
    additionalProperties: false,
};

/** JOB 2 — the COHERENCE VERDICT (the reasoning). The model reads the WHOLE package and judges internal
 *  consistency; returns strict JSON {reads:'clean'|'flags', flags:[{where,issue}]}. Advisory only — the
 *  GM acts; the narrator never edits structure. This is where 12B<26B<31B separate (reasoning depth). */
export function buildCoherence(pkg: string): ChatBody {
    const sys =
        'You are an operations auditor for a BattleTech command. Read the WHOLE operation package and judge its ' +
        'INTERNAL coherence: does the reaction timeline square with the hard deadline and the deploy/engagement ' +
        'window; does the OpFor composition match the stated threat rating; do the decision-point forks actually ' +
        'address the primary objective; do the assets/logistics/transport support the plan? Report STRICT JSON ' +
        '{"reads":"clean"|"flags","flags":[{"where","issue"}]}. "clean" = no contradictions found. List ONLY real ' +
        'contradictions — "where" is the section, "issue" is the specific incoherence in one sentence. Invent no ' +
        'problems; never rewrite or edit the package — you only report.';
    const user = `=== THE OPERATION PACKAGE ===\n${pkg}\n=== END PACKAGE ===\n\nReturn the coherence verdict as JSON.`;
    return {
        messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
        temperature: 0.2, max_tokens: 600, stream: false,
        response_format: { type: 'json_schema', json_schema: { name: 'coherence_verdict', strict: true, schema: COHERENCE_SCHEMA } },
    };
}

/** Strip any stray reasoning/markdown the model emits despite instructions (thinking off, prose only).
 *  D-040: also strips the Gemma-4 channel scaffolding the 26B-A4B leaks under --reasoning-format none
 *  (`<|channel>thought<channel|>` markers) + a leading echo of the LOCKED-values line — harmless no-ops
 *  for the clean 12B. The machine diff still guards every locked value regardless. */
export function cleanProse(s: string): string {
    return (s || '')
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<\|channel>[^<]*<channel\|>/gi, '') // Gemma-4 channel marker pair (26B-A4B reasoning)
        .replace(/<\/?\|?channel\|?>/gi, '')          // any stray channel marker
        .replace(/<\|[a-z_]+\|>/gi, '')               // stray harmony tokens (<|start|>, <|message|>, …)
        .replace(/^```[a-z]*\n?|\n?```$/gi, '')
        .replace(/^\s*(here'?s|here is|polished|refined)[^\n:]*:\s*/i, '')
        .replace(/^\s*LOCKED:[^.\n]*\.\s*/i, '')      // a leading echo of the prompt's LOCKED line (26B)
        .trim();
}
