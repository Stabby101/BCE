export const CONTACT_STATUSES = ['active', 'burned', 'dead', 'captured', 'promoted'] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];
