/*
 * HOTFIX-028 — the deployed build commit, for the client version handshake. Read at RUNTIME from the
 * platform's git env (Railway injects RAILWAY_GIT_COMMIT_SHA; GitHub Actions GITHUB_SHA; BCE_BUILD_COMMIT is
 * an explicit override for local/other hosts). 7-char short hash to match the web bundle's BUILD_COMMIT_HASH
 * (git rev-parse --short HEAD). 'unknown' when no env is present — the CLIENT suppresses the update banner on
 * an unknown/empty server version, so a missing env never yields a false "update available". No api-build
 * change (a runtime read keeps the backend deploy risk-free).
 */
export function buildCommit(): string {
    const raw = process.env.BCE_BUILD_COMMIT || process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GITHUB_SHA || '';
    return raw ? raw.slice(0, 7) : 'unknown';
}
