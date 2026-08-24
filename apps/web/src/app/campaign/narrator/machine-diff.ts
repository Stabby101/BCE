/*
 * BCE LOCAL NARRATOR — THE MACHINE DIFF (DIRECTIVE-038). Pure TS, no Angular/DOM. The gate the model
 * never sees: after REFINE, the engine diffs the locked values against the refined prose; ANY drift
 * auto-rejects that section to template. Model output is audited, never trusted (DATA-003).
 *
 * Two classes of locked value, two strictnesses (bias to SAFETY — a false-reject merely keeps the
 * template; a false-accept lets a wrong fact reach the table):
 *   • NUMBERS — strict. Every digit figure in the source (counts, costs, %, years, times) must reproduce
 *     EXACTLY (comma-normalized). This is the dangerous drift: a wrong C-bill or count misleads the GM.
 *   • NAMES — distinctive-token. A proper noun survives if its distinctive token appears (e.g. "Halstead"
 *     for "Halstead Station", "Canopus" for "Magistracy of Canopus") — so a faithful rephrase passes while
 *     a dropped faction/world still fails. Codewords are names too (single tokens → exact).
 */

const STOPWORDS = new Set(['the', 'of', 'and', 'a', 'an', 'to', 'for', 'in', 'on', 'at', 'by', 'mechs', 'mech']);

/** Every DIGIT figure is load-bearing — grouped (290,000), decimal (8.33), percent (30%), plain (12,
 *  3028). Word-numbers in prose ("two") never enter (no digits). Never captures a trailing comma/period. */
export function numbersIn(text: string): string[] {
    const out = new Set<string>();
    for (const m of (text || '').matchAll(/\d{1,3}(?:,\d{3})+%?|\d+(?:\.\d+)?%?/g)) out.add(m[0]);
    return [...out];
}

/** Normalize for comparison: lowercase, strip thousands commas, collapse whitespace + punctuation runs. */
function norm(s: string): string {
    return (s || '').toLowerCase().replace(/(\d),(?=\d)/g, '$1').replace(/[^\w%.\s']/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The distinctive words of a proper-noun name: tokens ≥4 chars that aren't stopwords (drops "of/the").
 *  A name with no such token (e.g. a short callsign) falls back to the whole normalized phrase. */
function significantWords(name: string): string[] {
    const words = norm(name).split(' ').filter((w) => w.length >= 4 && !STOPWORDS.has(w));
    return words.length ? words : [norm(name)].filter(Boolean);
}

export interface DiffResult { ok: boolean; missing: string[] }

/**
 * The gate. NUMBERS in the template prose must each appear exactly in the refined prose; NAMES must each
 * survive via a distinctive token. Returns the drifted values (numbers shown as-is, names as the source
 * phrase). `names` = the caller's explicit proper nouns / codewords; numbers are auto-extracted.
 */
export function diffLocked(names: string[], templateText: string, refined: string): DiffResult {
    const hay = norm(refined);
    const missing: string[] = [];
    for (const num of numbersIn(templateText)) {
        if (!hay.includes(norm(num))) missing.push(num);
    }
    const src = norm(templateText);
    for (const name of names) {
        const t = (name || '').trim();
        if (!t) continue;
        const words = significantWords(t);
        // only REQUIRE a name that is actually IN the source — the gate guards preservation of what's
        // there, never addition of what isn't (a slot value absent from this section can't drift).
        const inSource = src.includes(norm(t)) || words.some((w) => src.includes(w));
        if (!inSource) continue;
        if (hay.includes(norm(t))) continue;
        if (words.some((w) => hay.includes(w))) continue;
        missing.push(t);
    }
    return { ok: missing.length === 0, missing };
}

/** Back-compat helper for probes: the flat locked set (names + numbers). */
export function lockedValues(templateText: string, names: string[]): string[] {
    return [...names.filter((n) => (n || '').trim()), ...numbersIn(templateText)];
}

/**
 * D-043 voice-box guard — the INVERSE of diffLocked. A mission-aware voice box ADDS facts (it didn't
 * have them in its stub), so "preserve source numbers" doesn't apply; instead EVERY number the box
 * states must already exist in the package's locked figure set — a number the model invented (a wrong
 * count/cost/date) is rejected, never shipped (DATA-003). `allowed` = numbersIn(the whole package).
 * Returns the invented (disallowed) numbers; ok when none.
 */
export function noInventedNumbers(refined: string, allowed: string[]): DiffResult {
    const allow = new Set(allowed.map((n) => norm(n)));
    const invented: string[] = [];
    for (const num of numbersIn(refined)) {
        if (!allow.has(norm(num))) invented.push(num);
    }
    return { ok: invented.length === 0, missing: invented };
}
