export function buildCommit(): string {
    const raw = process.env.BCE_BUILD_COMMIT || process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GITHUB_SHA || '';
    return raw ? raw.slice(0, 7) : 'unknown';
}
