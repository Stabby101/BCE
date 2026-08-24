/*
 * BCE narrator — in-app prose word-diff for the D-045 refine change-log. Ports the bakeoff report's
 * LCS word-diff (narrator/bakeoff/report.mjs) into Angular form so the GM sees, in-app, exactly which
 * words the refine ADDED — prose only (DATA-003: the machine diff guarantees no number/name/objective/
 * fork drifted, so "what changed" is a bounded prose delta). The bakeoff harness itself is untouched
 * (D-045 scope) — this is the same algorithm reused, not a shared import.
 */
export interface DiffToken {
    t: string;
    add: boolean;
}

const toks = (s: string): string[] => (s || '').match(/\S+|\s+/g) || [];

/** The AFTER token stream, each tagged add=true where it's new vs BEFORE (longest-common-subsequence). */
export function diffAfter(before: string, after: string): DiffToken[] {
    const a = toks(before), b = toks(after);
    const n = a.length, m = b.length;
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const out: DiffToken[] = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
        if (a[i] === b[j]) { out.push({ t: b[j], add: false }); i++; j++; }
        else if (dp[i + 1][j] >= dp[i][j + 1]) { i++; }
        else { out.push({ t: b[j], add: true }); j++; }
    }
    while (j < m) out.push({ t: b[j++], add: true });
    return out;
}
