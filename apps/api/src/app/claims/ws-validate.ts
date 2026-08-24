/*
 * BCE ENGINE — DIRECTIVE-HARDEN-5 Part A: WebSocket payload VALIDATION (pure type-guards, no framework).
 * Every mutating gateway message (+ join/join-lobby) passes through one of these guards before any state
 * is touched; malformed input is rejected cleanly (an error ack, no crash, no partial write).
 *
 * DECISION (manual guards over class-validator + WS ValidationPipe): the gateway's 13 messages are tiny,
 * FLAT, single-level objects — a pure guard module covers them all in ~90 lines, adds ZERO dependencies
 * (the repo pins deps deliberately), keeps the reject path additive (mirrors the handlers' existing
 * early-return style), and is trivially unit-testable. class-validator would add two deps + DTO classes +
 * a WsException filter for shapes this small; if the REST side later adopts DTOs (flagged follow-up),
 * that decision can be made there on its own merits.
 *
 * Bounds: ids/tokens/keys ≤ 500 chars; display names ≤ 200; the battle `state` must be a non-null JSON
 * object/array whose serialized size is ≤ 256 KB (a serialized MekBay sheet is a few KB — the bound is
 * generous headroom, not a squeeze).
 */

export interface Verdict { ok: boolean; reason?: string }
const OK: Verdict = { ok: true };
const bad = (reason: string): Verdict => ({ ok: false, reason });

const MAX_STR = 500;
const MAX_NAME = 200;
export const MAX_BATTLE_STATE_BYTES = 256 * 1024;

const isStr = (v: unknown, max = MAX_STR): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
/** Optional string field: absent/undefined is fine; present must be a bounded string (may be empty). */
const isStrOpt = (v: unknown, max = MAX_STR): boolean => v === undefined || (typeof v === 'string' && v.length <= max);
/** Optional string-or-null field (the favorite clear shape). */
const isStrOrNullOpt = (v: unknown, max = MAX_STR): boolean => v === undefined || v === null || (typeof v === 'string' && v.length <= max);
const isNumOpt = (v: unknown): boolean => v === undefined || (typeof v === 'number' && Number.isFinite(v));
/** engagementKey is required-as-a-string but MAY be empty (pre-engagement clients send ''). */
const isKey = (v: unknown): boolean => typeof v === 'string' && v.length <= MAX_STR;

const rec = (m: unknown): Record<string, unknown> | null => (m !== null && typeof m === 'object' && !Array.isArray(m) ? (m as Record<string, unknown>) : null);

/** join / resync — { campaignId, engagementKey }. */
export function vJoin(m: unknown): Verdict {
    const o = rec(m);
    if (!o) return bad('payload must be an object');
    if (!isStr(o['campaignId'])) return bad('campaignId: non-empty string required');
    if (o['engagementKey'] !== undefined && !isKey(o['engagementKey'])) return bad('engagementKey: string required');
    return OK;
}

/** claim — { campaignId, engagementKey, instanceId, holderName, holderToken, at? }. */
export function vClaim(m: unknown): Verdict {
    const o = rec(m);
    if (!o) return bad('payload must be an object');
    if (!isStr(o['campaignId'])) return bad('campaignId: non-empty string required');
    if (!isStr(o['instanceId'])) return bad('instanceId: non-empty string required');
    if (o['engagementKey'] !== undefined && !isKey(o['engagementKey'])) return bad('engagementKey: string required');
    if (!isStrOpt(o['holderName'], MAX_NAME)) return bad('holderName: string ≤200 required');
    if (!isStrOpt(o['holderToken'])) return bad('holderToken: string required');
    if (!isNumOpt(o['at'])) return bad('at: finite number required');
    return OK;
}

/** release — { campaignId, engagementKey, instanceId, holderToken? }. */
export function vRelease(m: unknown): Verdict {
    const o = rec(m);
    if (!o) return bad('payload must be an object');
    if (!isStr(o['campaignId'])) return bad('campaignId: non-empty string required');
    if (!isStr(o['instanceId'])) return bad('instanceId: non-empty string required');
    if (o['engagementKey'] !== undefined && !isKey(o['engagementKey'])) return bad('engagementKey: string required');
    if (!isStrOpt(o['holderToken'])) return bad('holderToken: string required');
    return OK;
}

/** join-lobby — { campaignId, token, name, side }. */
export function vLobbyJoin(m: unknown): Verdict {
    const o = rec(m);
    if (!o) return bad('payload must be an object');
    if (!isStr(o['campaignId'])) return bad('campaignId: non-empty string required');
    if (!isStr(o['token'])) return bad('token: non-empty string required');
    if (!isStrOpt(o['name'], MAX_NAME)) return bad('name: string ≤200 required');
    if (!isStrOpt(o['side'])) return bad('side: string required');
    return OK;
}

/** reassign / kick / leave-lobby — { campaignId, token, side? } (side required only for reassign). */
export function vLobbyMut(m: unknown, needSide: boolean): Verdict {
    const o = rec(m);
    if (!o) return bad('payload must be an object');
    if (!isStr(o['campaignId'])) return bad('campaignId: non-empty string required');
    if (!isStr(o['token'])) return bad('token: non-empty string required');
    if (needSide ? !isStr(o['side']) : !isStrOpt(o['side'])) return bad('side: non-empty string required');
    return OK;
}

/** battle — { campaignId, engagementKey, instanceId, state, at? }; state = non-null object/array, size-bounded. */
export function vBattle(m: unknown): Verdict {
    const o = rec(m);
    if (!o) return bad('payload must be an object');
    if (!isStr(o['campaignId'])) return bad('campaignId: non-empty string required');
    if (!isStr(o['engagementKey'])) return bad('engagementKey: non-empty string required');
    if (!isStr(o['instanceId'])) return bad('instanceId: non-empty string required');
    if (!isNumOpt(o['at'])) return bad('at: finite number required');
    const state = o['state'];
    if (state === null || state === undefined || typeof state !== 'object') return bad('state: JSON object required');
    let json: string;
    try { json = JSON.stringify(state); } catch { return bad('state: not JSON-serializable'); }
    if (json === undefined) return bad('state: not JSON-serializable');
    if (Buffer.byteLength(json, 'utf8') > MAX_BATTLE_STATE_BYTES) return bad(`state: exceeds ${MAX_BATTLE_STATE_BYTES} bytes`);
    return OK;
}

/** favorite — { campaignId, token, instanceId?|null, pilotId?|null }. */
export function vFavorite(m: unknown): Verdict {
    const o = rec(m);
    if (!o) return bad('payload must be an object');
    if (!isStr(o['campaignId'])) return bad('campaignId: non-empty string required');
    if (!isStr(o['token'])) return bad('token: non-empty string required');
    if (!isStrOrNullOpt(o['instanceId'])) return bad('instanceId: string|null required');
    if (!isStrOrNullOpt(o['pilotId'])) return bad('pilotId: string|null required');
    return OK;
}
