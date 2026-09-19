import { Component, ChangeDetectionStrategy, computed, input } from '@angular/core';
import type { WeightClass } from './sprite-aliases';

@Component({
    selector: 'bce-mech-silhouette',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="sil" [style.width.px]="size()" [style.height.px]="size()"
             [title]="wc() + ' \\'Mech — no catalog sprite'">
            <svg viewBox="0 0 100 110" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
                <g [attr.transform]="xform()" fill="currentColor">
                    <!-- head + cockpit -->
                    <polygon points="45,15 55,15 57,25 43,25"></polygon>
                    <polygon class="cockpit" points="46,18 54,18 54,22 46,22"></polygon>
                    <!-- torso -->
                    <polygon points="34,25 66,25 72,44 64,60 36,60 28,44"></polygon>
                    <!-- arms (weapon barrels) -->
                    <polygon points="19,30 32,33 32,62 22,62"></polygon>
                    <polygon points="20,62 27,62 27,71 22,71"></polygon>
                    <polygon points="81,30 68,33 68,62 78,62"></polygon>
                    <polygon points="80,62 73,62 73,71 78,71"></polygon>
                    <!-- legs (reverse-jointed) + feet -->
                    <polygon points="40,60 49,60 47,80 39,80"></polygon>
                    <polygon points="39,80 47,80 49,100 39,100"></polygon>
                    <polygon points="34,100 50,100 50,106 34,106"></polygon>
                    <polygon points="60,60 51,60 53,80 61,80"></polygon>
                    <polygon points="61,80 53,80 51,100 61,100"></polygon>
                    <polygon points="50,100 66,100 66,106 50,106"></polygon>
                </g>
            </svg>
            <span class="tag">{{ wc() }}</span>
        </div>
    `,
    styles: [`
        :host { display: inline-flex; }
        .sil {
            position: relative; display: inline-flex; align-items: center; justify-content: center;
            color: var(--ink2, #6b6f76); background: var(--paper, #efeae0);
            border: 1.4px dashed var(--ink2, #8a8f98); box-sizing: border-box; overflow: hidden;
        }
        svg { width: 78%; height: 78%; opacity: .8; }
        .cockpit { fill: var(--paper, #efeae0); }
        .tag {
            position: absolute; bottom: 1px; left: 0; right: 0; text-align: center;
            font-family: var(--mono, monospace); font-size: 7px; font-weight: 700; letter-spacing: 1px;
            text-transform: uppercase; color: var(--ink2, #6b6f76); line-height: 1; pointer-events: none;
        }
    `],
})
export class MechSilhouetteComponent {
    wc = input<WeightClass>('Medium');
    size = input<number>(56);

    /** bulkier by class — same biped, wider torso/stance for heavier tonnage. */
    protected readonly xform = computed(() => {
        const s = { Light: 0.82, Medium: 1, Heavy: 1.16, Assault: 1.32 }[this.wc()] ?? 1;
        return `translate(50 0) scale(${s} 1) translate(-50 0)`;
    });
}
