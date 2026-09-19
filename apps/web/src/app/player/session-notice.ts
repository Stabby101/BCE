import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { PlayerSessionService } from './player-session.service';

@Component({
    selector: 'bce-session-notice',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (session.clockNotice(); as n) {
            <div class="sn" role="status" aria-live="polite" data-testid="session-notice" [attr.data-date-key]="n.key">
                <span class="sn-msg">{{ n.text }}</span>
                <button type="button" class="sn-x" (click)="session.dismissClockNotice()" data-testid="session-notice-dismiss" aria-label="Dismiss">&#10005;</button>
            </div>
        }
    `,
    styles: [`
        :host { display:block; }
        .sn { display:flex; align-items:center; gap:10px; margin:10px 0; padding:10px 12px; border:1px solid #4caf7d; border-radius:10px; background:#12241a; color:#dfe7f0; font-size:13px; line-height:1.45; }
        .sn-msg { flex:1 1 auto; }
        .sn-x { flex:0 0 auto; min-width:36px; min-height:36px; border:1px solid #2a3340; border-radius:8px; background:#141a21; color:#cdd8e3; font-size:14px; line-height:1; cursor:pointer; }
        .sn-x:hover, .sn-x:focus-visible { border-color:#4caf7d; color:#4caf7d; outline:none; }
    `],
})
export class SessionNoticeComponent {
    protected readonly session = inject(PlayerSessionService);
}
