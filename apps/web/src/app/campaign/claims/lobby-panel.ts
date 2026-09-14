/*
 * BCE — the GM LOBBY (DIRECTIVE-048, phase A). The host's view of who has joined: a join QR (players
 * scan it to land on the port-isolated player app) and the live roster fanned from the host over the
 * D-042 socket (ClaimRealtimeService.lobby). The GM can reassign a player's side or kick them; both
 * fan back to every device. Side is a social/visibility signal this slice (ROLE-002), not enforced
 * server-side. The QR encodes the player port on THIS host's address — if the GM opened the dashboard
 * on localhost, players can't reach it, so we say so. BCE campaign-layer only (no MekBay core import).
 */
import { ChangeDetectionStrategy, Component, computed, effect, inject, output } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { TableModeService } from '../gm/table-mode.service'; // GM-1 P1
import { CampaignSaveStore } from '../campaign-save-store';
import { ClaimRealtimeService } from './claim-realtime.service';
import { JoinLinkComponent } from './join-link'; // GM-1b — the HOTFIX-027 join block, now a shared child (one URL, two doors)
import { engagementKeyOf } from './engagement-key';
import { sessionCodeOf } from './session-code';
import { deployedSet } from '../force/deployed';


@Component({
    selector: 'bce-lobby-panel',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [JoinLinkComponent], // GM-1b
    template: `
        <div class="lob">
            <!-- HOTFIX-029 — session identity + connection truth. Green ONLY when the socket is connected (GM
                 observes the room). The same code shows on the player side-pick window; matching = same session. -->
            <div class="lsession" [class.on]="connected()" [title]="campaignId() || ''">
                <span class="ls-dot" aria-hidden="true">●</span> SESSION {{ sessionCode() }} — {{ connected() ? 'live' : 'offline' }}
                <!-- D-118 — re-read the active engagement's order (D-117 TRACK / Traditional package) from the lobby. -->
                <button type="button" class="lbtn ltrack" [disabled]="!viewTrackEnabled()"
                        [title]="viewTrackEnabled() ? 'Open the active track order (printable)' : 'No active mission — generate and activate one to view its track.'"
                        (click)="viewTrack.emit()">▦ View track</button>
            </div>

            <!-- DIRECTIVE-119 — Hot Spots: RESOLVE the mission where the battle was actually run; on resolve the button
                 is replaced by a ✓ confirmation (so "goals met" no longer leaves an unchanged screen). HS-only. -->
            @if (isHotspots()) {
                @if (hasActiveEngagement() && !table.on()) {
                    <!-- GM-1 P1 — table mode blanks resolve from the projected screen (constant false outside a GM session) -->
                    <button type="button" class="lresolve" (click)="resolveMission.emit()" title="Resolve this engagement — enter the objectives met">▸ Resolve mission</button>
                } @else if (recentlyResolved()) {
                    <div class="lresolved">✓ Resolved — read the AAR, then <b>Advance phase</b> (Flow rail) for the next contract.</div>
                }
            }

            <!-- GM-1b — the HOTFIX-027 join block lives in <bce-join-link> (one URL, one renderer, two doors: this
                 lobby door keeps the HOTFIX-029 deployment gate as an input; the GM tab mounts it un-gated as the
                 SESSION door). Markup/classes/behaviour byte-preserved — verify-gm1b-styles pins the lobby render. -->
            <bce-join-link [gated]="!gateOpen()" [gateCue]="gateCue()" />
            <!-- HOTFIX-030 — the Joined roster panel moved into the claim board (which now carries the counts +
                 per-device presence + kick, and a spectator list). No chip row under the QR — the board is the info. -->
        </div>
    `,
    styles: [`
        :host { display:block; }
        .lob { display:flex; flex-wrap:wrap; gap:20px; align-items:flex-start; }
        /* HOTFIX-029 — session identity header (full width above the QR + roster). */
        /* HOTFIX-037 — the SESSION line sits on the tan dossier field; it is a PRIMARY status → strong ink
           (was faint #7f8a96/#cdd8e3, ~1-2:1 on tan). The ● dot keeps the green semantic via --ok (readable). */
        .lsession { flex-basis:100%; font-family:var(--mono,monospace); font-size:13px; letter-spacing:.08em;
                    color:var(--ink); display:flex; align-items:center; gap:6px; }
        .lsession .ls-dot { color:var(--ink2); }
        .lsession.on { color:var(--ink); }
        .lsession.on .ls-dot { color:var(--ok); }
        /* D-118 — the View-track button rides the session header line.
           HOTFIX-037 — dark ink + tan line so it reads on the tan field (the shared .lbtn base is light-on-navy). */
        .lsession .ltrack { margin-left:auto; font-size:12px; padding:5px 11px; color:var(--ink); border-color:var(--line); }
        /* DIRECTIVE-119 — the Hot Spots RESOLVE action + the post-resolve confirmation (full-width, above the QR). */
        .lresolve { flex-basis:100%; font-family:var(--label,inherit); font-weight:700; letter-spacing:.08em; text-transform:uppercase;
                    font-size:13px; padding:12px 16px; border:1.6px solid var(--ok); background:var(--ok); color:var(--paper); border-radius:8px; cursor:pointer; }
        .lresolve:hover { filter:brightness(1.08); }
        .lresolved { flex-basis:100%; font-family:var(--type,inherit); font-size:13px; color:var(--ink); border-left:3px solid var(--ok);
                     background:var(--paper2); padding:10px 12px; border-radius:6px; }
        .lresolved b { color:var(--ink); }
        /* GM-1b — the .lqr/.lgate/.lqrinfo/.lqracts/.lwarn/.lconn rules moved to join-link.ts with their markup. */
        .lnudge { margin:2px 0 8px; font-size:13px; color:#e7a86b; font-weight:600; }
        .lroster { flex:1; min-width:280px; }
        .lrhead { display:flex; justify-content:space-between; align-items:baseline; margin-bottom:10px;
                  font-weight:700; letter-spacing:.04em; }
        .lcounts { font-size:12px; color:#7f8a96; font-weight:400; }
        .lempty { color:#7f8a96; font-style:italic; padding:18px 4px; }
        .llist { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:8px; }
        .lcard { display:flex; align-items:center; gap:12px; padding:10px 12px; border-radius:10px;
                 background:var(--bce-panel,#141a21); border:1px solid var(--bce-line,#2a3340); border-left-width:4px; }
        .lcard.blu { border-left-color:#3d6ea5; }
        .lcard.opf { border-left-color:#a5483d; }
        .lname { flex:1; font-weight:700; }
        .lside { font-size:12px; letter-spacing:.08em; color:#9fb2c4; }
        .lacts { display:flex; gap:6px; }
        .lbtn { border:1px solid var(--bce-line,#2a3340); background:transparent; color:#cdd8e3;
                border-radius:7px; padding:6px 10px; font-size:12px; cursor:pointer; }
        .lbtn:disabled { opacity:.45; cursor:not-allowed; }
        .lbtn.kick { color:#e08b7a; border-color:#6b3a2f; }
    `],
})
export class LobbyPanelComponent {
    private readonly state = inject(NewCampaignState);
    protected readonly table = inject(TableModeService); // GM-1 P1 — constant false outside a GM session
    private readonly store = inject(CampaignSaveStore);
    private readonly rt = inject(ClaimRealtimeService);

    protected readonly connected = this.rt.connected;
    private readonly engagementKey = computed(() => engagementKeyOf(this.state.missionTree()));

    // HOTFIX-029 — the DEPLOYMENT GATE. The join affordance (QR + URL + copy/share) opens only when an ACTIVE
    // engagement exists AND ≥1 unit is marked Deployed, so a player can never join into an empty session. All
    // reactive: generating a mission + deploying a unit opens it live; undeploying to zero re-dims it.
    protected readonly deployedCount = computed(() => deployedSet(this.state.startingForce()).length);
    protected readonly hasActiveEngagement = computed(() => (this.state.missionTree() ?? []).some((b) => b.state === 'ACTIVE'));
    // D-118 — "▦ View track": the dashboard re-opens the active engagement's order via the existing package path.
    // Enabled only when there's an active engagement carrying a forge package (else the overlay has nothing to show).
    readonly viewTrack = output<void>();
    protected readonly viewTrackEnabled = computed(() => this.hasActiveEngagement() && !!this.state.missionSpec()?.forge?.seedId);
    // DIRECTIVE-119 — Hot Spots: RESOLVE MISSION on the lobby (the battle was run here) drives the dashboard resolve
    // modal; after resolve the button is replaced by a ✓ confirmation. HS-gated — the Traditional lobby shows neither.
    readonly resolveMission = output<void>();
    protected readonly isHotspots = computed(() => this.state.campaignSystem() === 'hotspots');
    protected readonly recentlyResolved = computed(() => this.isHotspots() && !this.hasActiveEngagement()
        && (this.state.missionTree() ?? []).some((b) => b.state === 'RESOLVED' && b.resolution && !b.resolution.advanced));
    protected readonly gateOpen = computed(() => this.hasActiveEngagement() && this.deployedCount() > 0);
    // GM-3 P2 — the gate still opens on BROUGHT units (deployedSet counts player-imports), but the cue must tell the TRUTH
    // on a TABLE WITH NO COMPANY: the GM has no roster to "mark Deployed", so it waits on the players (R0.2 worst-five #4).
    protected readonly gateCue = computed(() =>
        !this.hasActiveEngagement() ? 'No active mission — generate one to open the lobby.'
            : this.state.companylessTable() ? 'Waiting for players — the lobby opens when a joined company deploys a unit.'
                : 'No units deployed — mark units Deployed on the roster to open the lobby.');
    // Session identity — the same code the player sees (last 6 alphanumerics of the campaignId, uppercased).
    protected readonly campaignId = this.store.campaignId;
    protected readonly sessionCode = computed(() => sessionCodeOf(this.store.campaignId()));

    constructor() {
        // Connect + join the room and OBSERVE the lobby (not register as a player). Idempotent with the
        // claims panel — same socket, same room.
        effect(() => {
            const id = this.store.campaignId();
            const key = this.engagementKey();
            if (id) { this.rt.ensure(id, key); this.rt.observeLobby(); }
        });
    }

    // HOTFIX-030 — reassign/kick moved to the claim board (bce-claims-panel), which is now the roster.
}
