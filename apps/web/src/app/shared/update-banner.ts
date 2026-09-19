import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ClaimRealtimeService } from '../campaign/claims/claim-realtime.service';
import { evictAndReload } from './app-reset';

const SEEN_KEY = 'bce.update.seenVersion';
const readSeen = (): string | null => { try { return localStorage.getItem(SEEN_KEY); } catch { return null; } };

@Component({
    selector: 'bce-update-banner',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (rt.updateAvailable() && !dismissed()) {
            <div class="ub" role="status" aria-live="polite" data-testid="bce-update-banner">
                <span class="ub-txt">A new version of BCE is available.</span>
                <button type="button" class="ub-btn" (click)="update()">Tap to update</button>
                <button type="button" class="ub-x" aria-label="Dismiss" (click)="dismiss()">×</button>
            </div>
        }
    `,
    styles: [`
        .ub { position:fixed; left:50%; transform:translateX(-50%); bottom:calc(14px + var(--bce-footer-h, 0px));z-index:2147483000;
              display:flex; align-items:center; gap:12px; max-width:min(560px,94vw); box-sizing:border-box;
              padding:10px 12px 10px 16px; border-radius:12px; background:#12324a; border:1px solid #2e5d82;
              color:#eaf2f9; box-shadow:0 12px 40px rgba(0,0,0,.45);
              font:14px/1.35 system-ui,Segoe UI,Roboto,sans-serif; }
        .ub-txt { flex:1; }
        .ub-btn { flex-shrink:0; border:none; border-radius:8px; padding:8px 14px; font-size:14px; font-weight:700;
                  cursor:pointer; background:#3d8ac2; color:#04121d; }
        .ub-x { flex-shrink:0; border:none; background:transparent; color:#9fc0da; font-size:20px; line-height:1;
                cursor:pointer; padding:0 4px; }
    `],
})
export class UpdateBannerComponent {
    protected readonly rt = inject(ClaimRealtimeService);
    private readonly seen = signal<string | null>(readSeen());
    /** Quiet once this server version has been answered (dismissed or tapped) — re-arms only for a NEWER server version. */
    protected readonly dismissed = computed(() => { const v = this.rt.serverVersion(); return !!v && this.seen() === v; });
    private markSeen(): void { const v = this.rt.serverVersion(); if (!v) return; this.seen.set(v); try { localStorage.setItem(SEEN_KEY, v); } catch { /* the in-memory signal still quiets this session */ } }
    protected dismiss(): void { this.markSeen(); }
    protected update(): void { this.markSeen(); void evictAndReload(); }
}
