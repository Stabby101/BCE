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
// GM-1 P3 — the join-with-force payload bound: 3× the measured 28-unit worst case (43,081 B); an explicit
// gate with a denied ack — the silent 1 MB socket.io frame disconnect must never be the failure mode (R3).
export const MAX_IMPORT_FORCE_BYTES = 128 * 1024;
export const MAX_IMPORT_UNITS = 24;

const isStr = (v: unknown, max = MAX_STR): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
/** Optional string field: absent/undefined is fine; present must be a bounded string (may be empty). */
const isStrOpt = (v: unknown, max = MAX_STR): boolean => v === undefined || (typeof v === 'string' && v.length <= max);
/** Optional string-or-null field (the favorite clear shape). */
const isStrOrNullOpt = (v: unknown, max = MAX_STR): boolean => v === undefined || v === null || (typeof v === 'string' && v.length <= max);
const isNumOpt = (v: unknown): boolean => v === undefined || (typeof v === 'number' && Number.isFinite(v));
/** engagementKey is required-as-a-string but MAY be empty. Pre-engagement clients actually send 'none'
 *  (engagementKeyOf's default — the GM-1b pre-track join rides it); '' stays accepted for older/other clients. */
const isKey = (v: unknown): boolean => typeof v === 'string' && v.length <= MAX_STR;

const rec = (m: unknown): Record<string, unknown> | null => (m !== null && typeof m === 'object' && !Array.isArray(m) ? (m as Record<string, unknown>) : null);

/** ORDER-4 H18 — engagement-close — { campaignId, engagementKey } (both non-empty; the key names the fight being ended). */
export function vEngagementClose(m: unknown): Verdict {
    const o = rec(m);
    if (!o) return bad('payload must be an object');
    if (!isStr(o['campaignId'])) return bad('campaignId: non-empty string required');
    if (!isStr(o['engagementKey'])) return bad('engagementKey: non-empty string required');
    return OK;
}

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

/** ODM-18 P1 — THE INTENT ALLOWLIST (the ruled LAW: the vocabulary is an allowlist, never "any public
 *  method"). burnDays / write-off / clock / resolve / QM-depot verbs are OUT BY CONSTRUCTION — a verb not
 *  on this list never reaches a handler (pinned by the negative specs). donor-strip-request is the two-key
 *  verb: the player RAISES it; the GM approves/declines on the panel. */
export const ODM_INTENT_VERBS = [
    'reassign-pilot', 'set-deploy',
    'bay-assign', 'bay-unassign', 'bay-priority', 'bay-type',
    'bench-assess', 'bench-inspect', 'bench-repair', 'bench-ammo-clear',
    'donor-strip-request',
] as const;
const isFin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** ODM-18 P1 — odm-intent — { campaignId, token, verb, payload }: per-verb payload shapes, allowlist-gated. */
export function vOdmIntent(m: unknown): Verdict {
    const o = rec(m);
    if (!o) return bad('payload must be an object');
    if (!isStr(o['campaignId'])) return bad('campaignId: non-empty string required');
    if (!isStr(o['token'])) return bad('token: non-empty string required');
    const verb = o['verb'];
    if (typeof verb !== 'string' || !(ODM_INTENT_VERBS as readonly string[]).includes(verb)) return bad('verb: not in the intent allowlist');
    if (!isStrOpt(o['nonce'], 40)) return bad('nonce: string ≤40 when present'); // panel fix — per-send ack correlation
    const p = rec(o['payload']);
    if (!p) return bad('payload: object required');
    // Panel hardening — the vBattle/vImportForce posture applied here too: the payload object rides the GM
    // fan VERBATIM (extra keys included), so it gets an explicit byte gate (32 KB is generous — every valid
    // payload is <1 KB) instead of leaning on the socket.io frame cap.
    try { if (JSON.stringify(p).length > 32 * 1024) return bad('payload: over the 32 KB intent bound'); } catch { return bad('payload: not serializable'); }
    switch (verb) {
        case 'reassign-pilot':
            if (!isStr(p['instanceId'])) return bad('instanceId: non-empty string required');
            if (typeof p['pilotId'] !== 'string' || p['pilotId'].length > MAX_STR) return bad("pilotId: string required ('' = unassign)");
            return OK;
        case 'set-deploy':
            if (!isStr(p['instanceId'])) return bad('instanceId: non-empty string required');
            if (typeof p['deployed'] !== 'boolean') return bad('deployed: boolean required');
            return OK;
        case 'bay-assign':
            if (!isStr(p['instanceId']) || !isStr(p['bayId'])) return bad('instanceId + bayId required');
            return OK;
        case 'bay-unassign':
            if (!isStr(p['bayId'])) return bad('bayId: non-empty string required');
            return OK;
        case 'bay-priority':
            if (!isStr(p['bayId'])) return bad('bayId: non-empty string required');
            if (p['p'] !== 1 && p['p'] !== 2 && p['p'] !== 3 && p['p'] !== 4) return bad('p: 1|2|3|4 required');
            return OK;
        case 'bay-type':
            if (!isStr(p['bayId'])) return bad('bayId: non-empty string required');
            if (p['type'] !== 'GENERAL' && p['type'] !== 'SALVAGE') return bad("type: 'GENERAL'|'SALVAGE' required");
            return OK;
        case 'bench-assess': {
            if (!isStr(p['label'], MAX_NAME)) return bad('label: string required');
            const oc = rec(p['outcome']);
            // integers 0..999 (panel fix: 2^31 passed the old ≥0 gate, then the apply-side `| 0` wrapped it
            // negative and the audit line printed "×-2147483648" — bound at the door, not the wrap)
            const okCount = (v: unknown): boolean => isFin(v) && Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 999;
            if (!oc || !okCount(oc['a']) || !okCount(oc['b']) || !okCount(oc['c'])) return bad('outcome: {a,b,c} integers 0..999 required');
            return OK;
        }
        case 'bench-inspect':
        case 'bench-repair':
            if (!isStr(p['label'], MAX_NAME)) return bad('label: string required');
            if (!isFin(p['n']) || !Number.isInteger(p['n']) || (p['n'] as number) < 1 || (p['n'] as number) > 999) return bad('n: integer 1..999 required');
            return OK;
        case 'bench-ammo-clear':
            if (!isStr(p['bin'], MAX_NAME)) return bad('bin: string required');
            return OK;
        case 'donor-strip-request':
            if (!isStr(p['instanceId'])) return bad('instanceId: non-empty string required');
            return OK;
        default:
            return bad('verb: not in the intent allowlist'); // unreachable — the allowlist check above holds
    }
}

/** GM-1 P3 — import-force — { campaignId, token, engagementKey?, name?, units[], pilots? }: the one-shot
 *  join-with-force payload. Per-unit shape-checked; the WHOLE {units, pilots} payload is size-bounded at
 *  128 KB (serialize-once, the vBattle pattern). */
export function vImportForce(m: unknown): Verdict {
    const o = rec(m);
    if (!o) return bad('payload must be an object');
    if (!isStr(o['campaignId'])) return bad('campaignId: non-empty string required');
    if (!isStr(o['token'])) return bad('token: non-empty string required');
    if (o['engagementKey'] !== undefined && !isKey(o['engagementKey'])) return bad('engagementKey: string required');
    if (!isStrOpt(o['name'], MAX_NAME)) return bad('name: string ≤200 required');
    if (!isStrOpt(o['sourceCampaignId'], MAX_NAME)) return bad('sourceCampaignId: string ≤200 required'); // GM-2 P1 — the HOME campaign
    if (!isNumOpt(o['reputation']) || (typeof o['reputation'] === 'number' && (o['reputation'] < 0 || o['reputation'] > 99))) return bad('reputation: finite 0..99 when present'); // GM-2 P2b — the company's home reputation rides IN
    const units = o['units'];
    if (!Array.isArray(units) || units.length < 1 || units.length > MAX_IMPORT_UNITS) return bad(`units: 1..${MAX_IMPORT_UNITS} required`);
    for (const u of units) {
        const uo = rec(u);
        if (!uo) return bad('units[]: object required');
        if (!isStrOpt(uo['instanceId'], MAX_NAME)) return bad('units[]: instanceId string required'); // GM-2 P1 — the origin id (optional)
        if (!isStr(uo['unitRef'], MAX_NAME) || !isStr(uo['chassis'], MAX_NAME) || !isStr(uo['model'], MAX_NAME)) return bad('units[]: unitRef/chassis/model strings required');
        for (const k of ['mulId', 'tons', 'bv']) { if (typeof uo[k] !== 'number' || !Number.isFinite(uo[k] as number)) return bad(`units[]: ${k} finite number required`); }
        if (uo['unitType'] !== undefined && uo['unitType'] !== 'mech' && uo['unitType'] !== 'vehicle') return bad("units[]: unitType 'mech'|'vehicle' required");
        if (uo['damage'] !== undefined && uo['damage'] !== null && (typeof uo['damage'] !== 'object' || Array.isArray(uo['damage']))) return bad('units[]: damage object|null required');
    }
    const pilots = o['pilots'];
    if (pilots !== undefined) {
        if (!Array.isArray(pilots) || pilots.length > MAX_IMPORT_UNITS) return bad(`pilots: array ≤${MAX_IMPORT_UNITS} required`);
        for (const p of pilots) {
            const po = rec(p);
            if (!po) return bad('pilots[]: object required');
            if (!isStr(po['name'], MAX_NAME)) return bad('pilots[]: name string required');
            if (!isStrOpt(po['pilotId'], MAX_NAME)) return bad('pilots[]: pilotId string required'); // GM-2 P1 — the origin id (optional)
            if (!isStrOpt(po['callsign'], MAX_NAME)) return bad('pilots[]: callsign string required');
            for (const k of ['gunnery', 'piloting']) { if (typeof po[k] !== 'number' || !Number.isFinite(po[k] as number)) return bad(`pilots[]: ${k} finite number required`); }
            if (!isStrOpt(po['assignedInstanceId'])) return bad('pilots[]: assignedInstanceId string required');
        }
    }
    let json: string;
    try { json = JSON.stringify({ units, pilots }); } catch { return bad('force: not JSON-serializable'); }
    if (json === undefined) return bad('force: not JSON-serializable');
    if (Buffer.byteLength(json, 'utf8') > MAX_IMPORT_FORCE_BYTES) return bad(`force: exceeds ${MAX_IMPORT_FORCE_BYTES} bytes`);
    return OK;
}

/** GM-1 P2 — side-pref — { campaignId, token, pref: 'a' | 'b' | null } (the advisory side preference). */
export function vSidePref(m: unknown): Verdict {
    const o = rec(m);
    if (!o) return bad('payload must be an object');
    if (!isStr(o['campaignId'])) return bad('campaignId: non-empty string required');
    if (!isStr(o['token'])) return bad('token: non-empty string required');
    const pref = o['pref'];
    if (pref !== null && pref !== 'a' && pref !== 'b') return bad("pref: 'a' | 'b' | null required");
    return OK;
}

/** REBASE-1 P3 item 1 — phase-pending — { campaignId, token, count } (this device's un-ended-pick count, ephemeral). */
export function vPhasePending(m: unknown): Verdict {
    const o = rec(m);
    if (!o) return bad('payload must be an object');
    if (!isStr(o['campaignId'])) return bad('campaignId: non-empty string required');
    if (!isStr(o['token'])) return bad('token: non-empty string required');
    const c = o['count'];
    if (typeof c !== 'number' || !Number.isFinite(c) || c < 0 || c > 100000) return bad('count: a finite number in [0, 100000] required');
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

/** GM-2 P2b — sign-contract — { campaignId, token, key, contract, nonce? }: a PLAYER device signs its own company's
 *  contract on the phone. The server validates SHAPE only (bounded, allowlisted keys — never the D-128 math: the GM device
 *  re-checks the belts it can and applies through its own state setters, the one-writer law). 32 KB bound. */
export const CONTRACT_COLUMNS_WIRE = ['basePay', 'command', 'salvage', 'support', 'transport'] as const;
export function vSignContract(m: unknown): Verdict {
    const o = rec(m);
    if (!o) return bad('payload must be an object');
    if (!isStr(o['campaignId'])) return bad('campaignId: non-empty string required');
    if (!isStr(o['token'])) return bad('token: non-empty string required');
    if (!isStr(o['key'], MAX_NAME)) return bad('key: non-empty string ≤200 required (the home campaign id)');
    if (!isStrOpt(o['nonce'], 40)) return bad('nonce: string ≤40 when present');
    const c = rec(o['contract']);
    if (!c) return bad('contract: object required');
    try { if (JSON.stringify(c).length > 32 * 1024) return bad('contract: over the 32 KB bound'); } catch { return bad('contract: not serializable'); }
    if (!isStr(c['id'], MAX_NAME)) return bad('contract.id: non-empty string required');
    if (!isStr(c['type'], MAX_NAME)) return bad('contract.type: non-empty string required');
    if (c['scale'] !== 1 && c['scale'] !== 2 && c['scale'] !== 3) return bad('contract.scale: 1|2|3 required');
    if (typeof c['intensity'] !== 'number' || !Number.isInteger(c['intensity']) || c['intensity'] < 1 || c['intensity'] > 20) return bad('contract.intensity: integer 1..20 required');
    if (c['status'] !== 'active') return bad("contract.status: 'active' required");
    if (!isStr(c['hotspotId'], MAX_NAME)) return bad('contract.hotspotId: non-empty string required');
    const st = rec(c['steps']);
    if (!st) return bad('contract.steps: object required');
    for (const col of CONTRACT_COLUMNS_WIRE) { const v = st[col]; if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 20) return bad(`contract.steps.${col}: integer 0..20 required`); }
    if (Object.keys(st).some((k) => !(CONTRACT_COLUMNS_WIRE as readonly string[]).includes(k))) return bad('contract.steps: unknown column');
    if (c['side'] !== undefined && c['side'] !== 'a' && c['side'] !== 'b') return bad("contract.side: 'a'|'b' when present");
    if (!isStrOpt(c['sideRole'], MAX_NAME) || !isStrOpt(c['employer'], MAX_NAME) || !isStrOpt(c['enemyFaction'], MAX_NAME)) return bad('contract.sideRole/employer/enemyFaction: strings when present');
    if (typeof c['tracksDone'] !== 'number' || c['tracksDone'] !== 0) return bad('contract.tracksDone: 0 required at signing');
    if (typeof c['repSpent'] !== 'number' || !Number.isInteger(c['repSpent']) || c['repSpent'] < 0 || c['repSpent'] > 20) return bad('contract.repSpent: integer 0..20 required');
    if (typeof c['transportSp'] !== 'number' || !Number.isFinite(c['transportSp']) || c['transportSp'] < 0 || c['transportSp'] > 100000) return bad('contract.transportSp: number 0..100000 required');
    if (!isNumOpt(c['lengthMonths'])) return bad('contract.lengthMonths: number when present');
    const ad = c['acceptedDate'];
    if (ad !== null && ad !== undefined && (rec(ad) === null || typeof (ad as { y?: unknown }).y !== 'number')) return bad('contract.acceptedDate: {y,m,d} | null');
    const ALLOWED = new Set(['id', 'type', 'scale', 'intensity', 'steps', 'status', 'acceptedDate', 'tracksDone', 'enemyFaction', 'hotspotId', 'lengthMonths', 'side', 'sideRole', 'employer', 'repSpent', 'transportSp', 'signedBy']);
    for (const k of Object.keys(c)) if (!ALLOWED.has(k)) return bad(`contract.${k}: not an allowed key`);
    return OK;
}
