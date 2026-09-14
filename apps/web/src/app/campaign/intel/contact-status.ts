/*
 * DIRECTIVE-ODM-12b C2 — the GM contact-status vocabulary, hoisted to a pure module.
 *
 * It lived on the Classic component (`intel-tab.ts`), so the ODM fork had to import FROM the component
 * it forked away from — fence-legal, but it dragged `IntelTabComponent` + `ForgePackService` into the
 * fork's graph and meant a Classic edit could silently change ODM's GM vocabulary. Both sides import
 * it from here now. No behaviour change: the tuple is byte-identical to the one it replaces.
 */
export const CONTACT_STATUSES = ['active', 'burned', 'dead', 'captured', 'promoted'] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];
