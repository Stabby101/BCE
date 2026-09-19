import { Injectable, effect, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { AarVoiceRef } from '../aar/aar-render';
import { NewCampaignState } from '../new-campaign-state';

export type OdmAarSlot = 'command' | 'intelligence' | 'engineering' | 'personnel' | 'naval';

export interface OdmContactAar {
    slot: OdmAarSlot;
    role: string;
    header: string;
    standingRules: string[];
    /** Engineering only — the authored bay-note templates (MacCready's rules live in the DATA, re-voiceable). */
    bayNote?: { withWork: string; noWork: string; shortfallStated: string; noShortfall: string };
}

export interface OdmContact {
    id: string;
    name: string;
    rank: string;
    role: string;
    faction: string;
    status: string;                 // registry truth (ACTIVE / KIA); the GM's live override rides IntelState
    relationship: string;           // registry truth (ALLY / CONTACT / —); GM override rides IntelState
    reliability: string | null;
    visibility: 'day-one' | 'first-encounter';
    location: string;
    contactMethod: string;
    dossier: string;
    aar?: OdmContactAar;            // the four AAR section authors carry their voice blocks here
    source?: 'registry' | 'packet'; // reserved — the enemy-personalities pass files packet-sourced entries later
}

export interface OdmCell { world: string; status: 'CONFIRMED' | 'SIGNALED' | 'UNCONTACTED' | 'EXTRACTED'; note: string | null } // SPAWN-1 B4 — EXTRACTED: the cell's asset recovered (Keid, SILVER MOTH); renders its note like SIGNALED

interface OdmContactsFile { packId: string; version: number; contacts: OdmContact[]; cells: OdmCell[] }

@Injectable({ providedIn: 'root' })
export class OdmContactsService {
    private readonly http = inject(HttpClient);
    private readonly state = inject(NewCampaignState);
    private base(): string { return localStorage.getItem('bce.engine.url') || 'http://localhost:3000/api'; }

    readonly contacts = signal<OdmContact[] | null>(null);
    readonly cells = signal<OdmCell[] | null>(null);
    private inflight: Promise<void> | null = null;

    constructor() {
        effect(() => {
            if (this.state.packId() !== 'odm') this.clear();
        });
    }

    /** Drop the cached registry (campaign switch / entitlement change). Idempotent. */
    clear(): void {
        this.contacts.set(null);
        this.cells.set(null);
        this.inflight = null;
    }

    /** Fetch once per app life (in-memory only). Failure leaves null — Intel renders empty, AAR UNSIGNED. */
    ensureLoaded(): Promise<void> {
        if (this.contacts()) return Promise.resolve();
        if (this.inflight) return this.inflight;
        this.inflight = firstValueFrom(this.http.get<OdmContactsFile>(`${this.base()}/pack/odm/file/contacts.json`, { withCredentials: true }))
            .then((f) => {
                if (Array.isArray(f?.contacts)) this.contacts.set(f.contacts);
                if (Array.isArray(f?.cells)) this.cells.set(f.cells);
            })
            .catch(() => { /* not entitled / offline — honest empties */ })
            .then(() => { this.inflight = null; });
        return this.inflight;
    }

    byId(id: string): OdmContact | null {
        return (this.contacts() ?? []).find((c) => c.id === id) ?? null;
    }

    /** The AAR section author for a slot — the contact CARRYING that voice block. */
    bySlot(slot: OdmAarSlot): OdmContact | null {
        return (this.contacts() ?? []).find((c) => c.aar?.slot === slot) ?? null;
    }

    /** The AAR byline shape: "Prepared by <name> — <aar role> · standing rules: <rules>". Registry names
     *  already carry their rank ("Major-Select Elspeth Varro") — ONE source, no re-assembly. */
    voiceRef(slot: OdmAarSlot): AarVoiceRef | null {
        const c = this.bySlot(slot);
        return c?.aar ? { name: c.name, roleFamily: c.aar.role, header: c.aar.header, rules: c.aar.standingRules.join(' · ') } : null;
    }
}
