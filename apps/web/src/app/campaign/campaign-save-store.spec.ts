import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { CampaignSaveStore, type SaveRecord } from './campaign-save-store';
import { NewCampaignState } from './new-campaign-state';
import { AuthService } from '../auth/auth.service';
import { ClaimRealtimeService } from './claims/claim-realtime.service';

describe('CampaignSaveStore.readOnly — P3b (the truthful owner + the baton)', () => {
    let store: CampaignSaveStore;
    let http: HttpTestingController;
    const auth = { authRequired: signal(true), user: signal<{ id: string; role: string } | null>({ id: 'owner-1', role: 'gm' }) };
    const rt = { writerHolder: signal<string | null>(null), writerHolderDevice: signal<string | null>(null), writerKnown: signal(false), myDeviceId: 'dev-desk' };

    beforeEach(() => {
        auth.authRequired.set(true);
        auth.user.set({ id: 'owner-1', role: 'gm' });
        rt.writerHolder.set(null); rt.writerHolderDevice.set(null); rt.writerKnown.set(false);
        TestBed.configureTestingModule({
            providers: [
                provideHttpClient(), provideHttpClientTesting(),
                CampaignSaveStore,
                NewCampaignState, // the real signal store — no constructor dependencies
                { provide: AuthService, useValue: auth },
                { provide: ClaimRealtimeService, useValue: rt },
            ],
        });
        TestBed.inject(NewCampaignState).packId.set('odm');
        store = TestBed.inject(CampaignSaveStore);
        http = TestBed.inject(HttpTestingController);
    });
    afterEach(() => http.verify());
    /** one macrotask — lets the store's awaited PUT settle so the follow-up "last" PUT is issued */
    const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

    /** Drive quickSave to completion: the PUT answers with the SERVER's record (ownerId stamped), then "last". */
    async function create(serverOwnerId: string | null): Promise<SaveRecord> {
        const done = store.quickSave();
        const put = http.expectOne((r) => r.method === 'PUT' && /\/campaigns\/autosave-/.test(r.url));
        put.flush({ ...(put.request.body as SaveRecord), ownerId: serverOwnerId });
        await settle();
        http.expectOne((r) => r.method === 'PUT' && /\/campaigns\/last$/.test(r.url)).flush({});
        return done;
    }

    it('the fixture is well-formed: the create PUT carries an ODM snapshot and NO ownerId (the client cannot know it)', async () => {
        const done = store.quickSave();
        const put = http.expectOne((r) => r.method === 'PUT' && /\/campaigns\/autosave-/.test(r.url));
        const body = put.request.body as SaveRecord;
        expect((body.snapshot as { packId?: string }).packId).toBe('odm');
        expect(body.ownerId).toBeUndefined();
        put.flush({ ...body, ownerId: 'owner-1' });
        await settle();
        http.expectOne((r) => /\/campaigns\/last$/.test(r.url)).flush({});
        await done;
    });

    it('CREATE PATH: the store tracks the SERVER record — the owner writes, and a different account on that record READS', async () => {
        await create('owner-1');
        expect(store.readOnly()).toBeFalse();                 // the owner who just created it writes
        auth.user.set({ id: 'cogm-2', role: 'gm' });          // the truthful-owner witness: the store KNOWS who owns it
        expect(store.readOnly()).toBeTrue();                  // (red when the create path tracks the ownerless local rec)
        auth.user.set({ id: 'admin-9', role: 'admin' });
        expect(store.readOnly()).toBeFalse();                 // admin always writes
    });

    it('a host that answers without a record falls back to the local rec (no crash, P0 behaviour)', async () => {
        const done = store.quickSave();
        http.expectOne((r) => r.method === 'PUT' && /\/campaigns\/autosave-/.test(r.url)).flush(null);
        await settle();
        http.expectOne((r) => /\/campaigns\/last$/.test(r.url)).flush({});
        const rec = await done;
        expect(store.campaignId()).toBe(rec.id);
        expect(store.readOnly()).toBeFalse();
    });

    it('THE BATON: an explicit holder writes; the owner who handed away READS; take-back restores the owner', async () => {
        await create('owner-1');
        rt.writerHolder.set('cogm-2');                        // the owner handed the table away
        expect(store.readOnly()).toBeTrue();                  // the owner now reads
        auth.user.set({ id: 'cogm-2', role: 'gm' });
        expect(store.readOnly()).toBeFalse();                 // the holder writes
        auth.user.set({ id: 'cogm-3', role: 'gm' });
        expect(store.readOnly()).toBeTrue();                  // a third co-GM reads
        rt.writerHolder.set(null);                            // take-back / disconnect fallback → owner-default
        expect(store.readOnly()).toBeTrue();                  // still not the owner
        auth.user.set({ id: 'owner-1', role: 'gm' });
        expect(store.readOnly()).toBeFalse();                 // the owner writes again
    });

    it('scope: a plain campaign and dev/LAN are never read-only, whoever holds what', async () => {
        TestBed.inject(NewCampaignState).packId.set(null);
        await create('someone-else');
        rt.writerHolder.set('cogm-2');
        expect(store.readOnly()).toBeFalse();                 // not an ODM record — the baton never applies
        TestBed.inject(NewCampaignState).packId.set('odm');
        await create('someone-else');
        expect(store.readOnly()).toBeTrue();
        auth.authRequired.set(false);
        expect(store.readOnly()).toBeFalse();                 // dev/LAN — one operator
    });

    it('L1 isRecordOwner: only THE ODM record’s owner hands the table out — true for the owner even while handed away; false for a co-GM, a plain campaign, dev/LAN', async () => {
        await create('owner-1');
        expect(store.isRecordOwner()).toBeTrue();
        rt.writerHolder.set('cogm-2');                        // handed away: the owner READS but is still the one who can take it back
        expect(store.readOnly()).toBeTrue();
        expect(store.isRecordOwner()).toBeTrue();
        auth.user.set({ id: 'cogm-2', role: 'gm' });          // the holder writes but never owns
        expect(store.isRecordOwner()).toBeFalse();
        auth.user.set({ id: 'owner-1', role: 'gm' });
        auth.authRequired.set(false);
        expect(store.isRecordOwner()).toBeFalse();            // dev/LAN — no accounts, nothing to hand out
        auth.authRequired.set(true);
        TestBed.inject(NewCampaignState).packId.set(null);
        await create('owner-1');
        expect(store.isRecordOwner()).toBeFalse();            // a plain campaign has no baton
    });

    //    carries `writerHolderDevice` beside `writerHolder`, the store knows THIS device (`rt.myDeviceId`, minted once as
    //    `bce.gm.device`), and readOnly compares the PAIR — the same account on another device READS. ──
    it('P5: the SAME account on ANOTHER device reads — readOnly compares { userId, deviceId } (the desktop + tablet case)', async () => {
        await create('owner-1');
        rt.writerHolder.set('owner-1'); rt.writerHolderDevice.set('dev-desk'); rt.writerKnown.set(true);
        expect(store.readOnly()).toBeFalse();                    // the holder DEVICE (this one) writes
        rt.writerHolderDevice.set('dev-tablet');                 // the owner took the table on the tablet
        expect(store.readOnly()).toBeTrue();                     // the desktop — same account — now READS
        rt.writerHolderDevice.set(null);                         // a legacy account-level holder: any device of the account
        expect(store.readOnly()).toBeFalse();
    });
    it('P5: NO holder (ruling 1) — the OWNER is optimistic (its first write / join TAKES the table; the host’s belt refuses a second device); a co-GM reads', async () => {
        await create('owner-1');
        rt.writerHolder.set(null); rt.writerHolderDevice.set(null); rt.writerKnown.set(true);
        expect(store.readOnly()).toBeFalse();                    // the owner writes — its first PUT takes the table
        auth.user.set({ id: 'cogm-2', role: 'gm' });
        expect(store.readOnly()).toBeTrue();                     // a co-GM never takes on its own
    });
    it('P5: a co-GM handed the table writes on THAT device only; its other device reads; the owner reads', async () => {
        await create('owner-1');
        rt.writerHolder.set('cogm-2'); rt.writerHolderDevice.set('dev-ryan'); rt.writerKnown.set(true);
        expect(store.readOnly()).toBeTrue();                     // the owner (this device) reads
        auth.user.set({ id: 'cogm-2', role: 'gm' });
        expect(store.readOnly()).toBeTrue();                     // the co-GM on THIS device (dev-desk) — not the holder device
        rt.writerHolderDevice.set('dev-desk');
        expect(store.readOnly()).toBeFalse();                    // …until the table is moved here
    });
});
