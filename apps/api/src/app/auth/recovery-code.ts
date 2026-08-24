/*
 * BCE (DEPLOY-009) — the GUEST recovery code: a SHOWN, human-typable affordance whose ONLY job is to
 * re-bind a new device to an existing guest userId. It is NOT the session credential (that's the JWT,
 * issued by AuthService.issueToken) — it maps to the user server-side and is stored HASHED at rest.
 *
 * Alphabet = A–Z + 2–9 minus the visually ambiguous I, O, 0, 1 → 32 symbols. 8 chars → 32^8 ≈ 1.1
 * trillion. Generated with crypto.randomInt (unbiased rejection sampling), grouped XXXX-XXXX for legibility.
 */
import { randomInt } from 'node:crypto';

/** 32 symbols: A–Z without I/O (24) + 2–9 without 0/1 (8). */
export const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const RECOVERY_LEN = 8;

/** A fresh code, e.g. "JBK7-Q2MX". The dash is cosmetic — normalizeRecoveryCode strips it for hashing. */
export function generateRecoveryCode(): string {
    let s = '';
    for (let i = 0; i < RECOVERY_LEN; i++) s += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
    return s.slice(0, 4) + '-' + s.slice(4);
}

/** Canonicalize typed input for hashing/matching: uppercase, drop the grouping dash + any stray whitespace.
 *  The 32-char alphabet already excludes the truly ambiguous glyphs, so no fuzzy remap is needed. */
export function normalizeRecoveryCode(input: string): string {
    return (input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** A normalized code is well-formed iff it is exactly RECOVERY_LEN symbols drawn from the alphabet. */
export function isWellFormedRecoveryCode(input: string): boolean {
    const n = normalizeRecoveryCode(input);
    if (n.length !== RECOVERY_LEN) return false;
    for (const ch of n) if (!RECOVERY_ALPHABET.includes(ch)) return false;
    return true;
}
