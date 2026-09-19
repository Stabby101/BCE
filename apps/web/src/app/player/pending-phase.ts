export function unendedPickUnits<F>(
    entries: readonly { instanceId: string; status: string; fu?: F | null }[],
    heldByMe: (instanceId: string) => boolean,
    isDirty: (fu: F) => boolean,
): F[] {
    const out: F[] = [];
    for (const e of entries) {
        if (e.status !== 'ok' || !e.fu || !heldByMe(e.instanceId)) continue;
        if (isDirty(e.fu)) out.push(e.fu);
    }
    return out;
}
