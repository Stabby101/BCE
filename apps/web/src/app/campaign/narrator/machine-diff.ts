
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

export function noInventedNumbers(refined: string, allowed: string[]): DiffResult {
    const allow = new Set(allowed.map((n) => norm(n)));
    const invented: string[] = [];
    for (const num of numbersIn(refined)) {
        if (!allow.has(norm(num))) invented.push(num);
    }
    return { ok: invented.length === 0, missing: invented };
}
