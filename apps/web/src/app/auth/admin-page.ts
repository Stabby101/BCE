/*
 * BCE multi-tenant (DEPLOY-003 T-039) — the dedicated admin-only /admin console. Three sections:
 *   APPROVALS — the pending queue (relocated from P4's inline overlay): approve / reject.
 *   USERS     — the full directory (email/provider/role/status/joined/last-seen) + ban/reinstate, role
 *               promote/demote, remove. Destructive + role actions confirm. Self-lockout is blocked here
 *               (UI) AND server-side (the controller rejects self ban/reject/remove/demote).
 *   AUDIT     — the append-only governance log (login/register/approve/reject/ban/unban/role/remove),
 *               filterable by user + action. Read-only — there is no edit/delete path anywhere.
 * Reached only by an approved admin (the route guard + the server AdminGuard is the real gate). GM-bundle
 * only — never in the player graph. The server is authoritative; this renders + drives /api/admin/*.
 */
import { ChangeDetectionStrategy, Component, type OnDestroy, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService, type AdminStats, type AuditEntry, type GmUser } from './auth.service';

type Tab = 'dashboard' | 'approvals' | 'users' | 'audit';

@Component({
    selector: 'bce-admin-page',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="ap">
            <header class="ap-head">
                <div class="ap-title">ADMIN CONSOLE<span>account governance · T-039</span></div>
                <button type="button" class="ap-back" (click)="back()">‹ Back to app</button>
            </header>

            <nav class="ap-tabs">
                <button type="button" class="ap-tab" [class.on]="tab() === 'dashboard'" (click)="tab.set('dashboard')">Dashboard</button>
                <button type="button" class="ap-tab" [class.on]="tab() === 'approvals'" (click)="tab.set('approvals')">
                    Approvals @if (pending().length) { <span class="ap-badge">{{ pending().length }}</span> }
                </button>
                <button type="button" class="ap-tab" [class.on]="tab() === 'users'" (click)="tab.set('users')">Users <span class="ap-dim">{{ users().length }}</span></button>
                <button type="button" class="ap-tab" [class.on]="tab() === 'audit'" (click)="tab.set('audit')">Audit log</button>
                <button type="button" class="ap-refresh" [disabled]="busy()" (click)="load()">↻</button>
            </nav>

            @if (tab() === 'dashboard') {
                @if (stats(); as s) {
                    <div class="ap-cards">
                        <div class="ap-card"><div class="apc-n">{{ s.totalUsers }}</div><div class="apc-l">Unique users</div><div class="apc-s">{{ s.byRole.gm }} GM · {{ s.byRole.guest }} guest · {{ s.byRole.admin }} admin</div></div>
                        <div class="ap-card live"><div class="apc-n">{{ s.activeNow }}<span class="apc-dot"></span></div><div class="apc-l">Active now</div><div class="apc-s">live · polls 20s</div></div>
                        <div class="ap-card"><div class="apc-n">{{ s.activeToday }}</div><div class="apc-l">Active 24h</div><div class="apc-s">{{ s.active7d }} in 7 days</div></div>
                        <div class="ap-card" [class.warn]="s.byStatus.pending > 0"><div class="apc-n">{{ s.byStatus.pending }}</div><div class="apc-l">Pending approvals</div><div class="apc-s">{{ s.byStatus.banned }} banned · {{ s.byStatus.rejected }} rejected</div></div>
                        <div class="ap-card"><div class="apc-n">{{ s.totalCampaigns }}</div><div class="apc-l">Campaigns</div><div class="apc-s">across all owners</div></div>
                        <div class="ap-card"><div class="apc-n">{{ s.new7d }}</div><div class="apc-l">New this week</div><div class="apc-s">{{ s.newToday }} in 24h</div></div>
                    </div>
                    <p class="ap-cardnote">Presence is in-memory (an authed socket = online; 2 tabs of one user = 1); “active” counts use the durable last-seen. Everything here is admin-only (server-gated).</p>
                } @else {
                    <div class="ap-empty">Loading metrics…</div>
                }
            }

            @if (tab() === 'approvals') {
                @if (pending().length === 0) {
                    <div class="ap-empty">No pending registrations. New GM sign-ins land here for approval.</div>
                } @else {
                    <ul class="ap-list">
                        @for (u of pending(); track u.id) {
                            <li class="ap-row">
                                <div class="ap-who"><div class="ap-name">{{ u.displayName || u.email || u.id }}</div>
                                    <div class="ap-meta">{{ u.email || '—' }} · via {{ u.provider }} · {{ fmt(u.createdAt) }}</div></div>
                                <div class="ap-acts">
                                    <button type="button" class="ap-btn ok" (click)="approve(u)">Approve</button>
                                    <button type="button" class="ap-btn no" (click)="reject(u)">Reject</button>
                                </div>
                            </li>
                        }
                    </ul>
                }
            }

            @if (tab() === 'users') {
                <!-- HOTFIX-041 Part B — finding tools for OAuth-scale row counts (716 users, mostly gst-* noise). -->
                <div class="ap-filters ap-userfilters">
                    <input class="ap-search" type="search" placeholder="Search name / email…" [value]="q()" (input)="onQ($event)" data-testid="user-search" />
                    <div class="ap-seg" role="tablist">
                        @for (f of FILTERS; track f.id) {
                            <button type="button" class="ap-segbtn" [class.on]="roleFilter() === f.id" (click)="roleFilter.set(f.id)">{{ f.label }}</button>
                        }
                    </div>
                    <span class="ap-dim">{{ filteredUsers().length }} of {{ users().length }}</span>
                </div>
                <div class="ap-tablewrap">
                    <table class="ap-table">
                        <thead><tr><th>User</th><th>Provider</th><th>Role</th><th>Status</th><th>Joined</th><th>Last seen</th><th>Actions</th></tr></thead>
                        <tbody>
                            @for (u of filteredUsers(); track u.id) {
                                <tr [class.self]="u.id === selfId()">
                                    <td><div class="ap-name">{{ u.displayName || u.email || u.id }}</div><div class="ap-meta">{{ u.email || '—' }}</div></td>
                                    <td>{{ u.provider }}</td>
                                    <td><span class="ap-role" [class.admin]="u.role === 'admin'">{{ u.role }}</span></td>
                                    <td><span class="ap-st" [attr.data-s]="u.status">{{ u.status }}</span></td>
                                    <td class="ap-dim">{{ fmt(u.createdAt) }}</td>
                                    <td class="ap-dim">{{ u.lastSeen ? fmt(u.lastSeen) : '—' }}</td>
                                    <td class="ap-rowacts">
                                        <!-- HOTFIX-041 Part C: the ODM toggle sits OUTSIDE the self-guard — the admin's OWN row is the
                                             primary self-grant flow (the cover door keys off the explicit grant; admins get no implicit
                                             entitlement in /me). Guests can't hold entitlements (server refuses; no button). -->
                                        @if (u.role !== 'guest' && u.status === 'approved') { <button type="button" class="ap-mini" [class.ok]="hasGrant(u, 'odm')" (click)="toggleGrant(u, 'odm')" data-testid="odm-grant">{{ hasGrant(u, 'odm') ? 'ODM ✓' : 'ODM' }}</button> }
                                        @if (u.id === selfId()) { <span class="ap-youtag">you</span> }
                                        @else {
                                            @if (u.status === 'pending') { <button type="button" class="ap-mini ok" (click)="approve(u)">Approve</button> }
                                            @if (u.status === 'pending' || u.status === 'banned' || u.status === 'rejected') { <button type="button" class="ap-mini ok" (click)="unban(u)">Reinstate</button> }
                                            @if (u.status === 'approved') { <button type="button" class="ap-mini no" (click)="ban(u)">Ban</button> }
                                            <!-- DEPLOY-010 SOLE-ADMIN LOCK: NO promote-to-admin (admin is conferred only via BCE_ADMIN_EMAILS). Demote-only. -->
                                            @if (u.role === 'admin') { <button type="button" class="ap-mini" (click)="setRole(u, 'gm')">Make GM</button> }
                                            <button type="button" class="ap-mini del" (click)="remove(u)">Remove</button>
                                        }
                                    </td>
                                </tr>
                            }
                            @if (filteredUsers().length === 0) { <tr><td colspan="7" class="ap-empty">No users match the filter.</td></tr> }
                        </tbody>
                    </table>
                </div>
            }

            @if (tab() === 'audit') {
                <div class="ap-filters">
                    <label>User
                        <select [value]="auditUser()" (change)="onAuditUser($event)">
                            <option value="">all</option>
                            @for (u of users(); track u.id) { <option [value]="u.id" [selected]="u.id === auditUser()">{{ u.email || u.id }}</option> }
                        </select>
                    </label>
                    <label>Action
                        <select [value]="auditAction()" (change)="onAuditAction($event)">
                            <option value="">all</option>
                            @for (a of ACTIONS; track a) { <option [value]="a" [selected]="a === auditAction()">{{ a }}</option> }
                        </select>
                    </label>
                    <span class="ap-dim">{{ audit().length }} entries</span>
                </div>
                <div class="ap-tablewrap">
                    <table class="ap-table">
                        <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead>
                        <tbody>
                            @for (e of audit(); track e.id) {
                                <tr>
                                    <td class="ap-dim">{{ fmt(e.ts) }}</td>
                                    <td>{{ nameOf(e.actorUserId) }}</td>
                                    <td><span class="ap-act" [attr.data-a]="e.action">{{ e.action }}</span></td>
                                    <td>{{ nameOf(e.targetUserId) }}</td>
                                    <td class="ap-dim">{{ e.detail || '' }}{{ e.ip ? ' · ' + e.ip : '' }}</td>
                                </tr>
                            }
                            @if (audit().length === 0) { <tr><td colspan="5" class="ap-empty">No matching audit entries.</td></tr> }
                        </tbody>
                    </table>
                </div>
            }
        </div>
    `,
    styles: [`
        /* HOTFIX-041 Part A — the IMPORT-7 route-host pattern (cover.scss / merc-command.scss siblings): body is
           overflow:hidden + one viewport tall, so EVERY route host must own its own scroll and end above the legal
           footer. min-height:100dvh let the host grow past the fold with no scroller — 716 rows unreachable. */
        :host { display:block; height:calc(100dvh - var(--bce-footer-h, 0px)); overflow-y:auto; overflow-x:hidden;
                box-sizing:border-box; -webkit-overflow-scrolling:touch; overscroll-behavior:contain;
                background:#0c0f13; color:#e7edf3;
                font:14px/1.45 system-ui,Segoe UI,Roboto,sans-serif; }
        .ap { max-width:1040px; margin:0 auto; padding:22px 18px 60px; }
        .ap-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:18px; }
        .ap-title { font-weight:800; letter-spacing:.14em; font-size:17px; }
        .ap-title span { display:block; font-size:10px; letter-spacing:.24em; color:#6b7682; margin-top:3px; font-weight:600; }
        .ap-back { background:none; border:1px solid #2a3340; color:#9fb2c4; border-radius:8px; padding:8px 12px; font-size:13px; cursor:pointer; }
        .ap-tabs { display:flex; align-items:center; gap:8px; border-bottom:1px solid #232c37; margin-bottom:16px; }
        .ap-tab { background:none; border:none; color:#9fb2c4; padding:10px 12px; font-size:14px; font-weight:600;
                  cursor:pointer; border-bottom:2px solid transparent; margin-bottom:-1px; }
        .ap-tab.on { color:#fff; border-bottom-color:#7fb0e6; }
        .ap-dim { color:#6b7682; font-size:12px; font-weight:400; }
        .ap-badge { background:#a5483d; color:#fff; border-radius:999px; padding:1px 7px; font-size:11px; margin-left:4px; }
        .ap-refresh { margin-left:auto; background:none; border:1px solid #2a3340; color:#9fb2c4; border-radius:8px; padding:6px 11px; cursor:pointer; }
        .ap-empty { color:#7f8a96; font-style:italic; padding:26px 6px; text-align:center; }
        .ap-list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:8px; }
        .ap-row { display:flex; align-items:center; gap:12px; padding:12px 14px; border-radius:11px; background:#141a21; border:1px solid #232c37; }
        .ap-who { flex:1; min-width:0; }
        .ap-name { font-weight:700; color:#fff; }
        .ap-meta { font-size:12px; color:#7f8a96; margin-top:2px; }
        .ap-acts { display:flex; gap:8px; }
        .ap-btn { border:none; border-radius:8px; padding:9px 16px; font-size:13px; font-weight:700; cursor:pointer; }
        .ap-btn.ok { background:#2f6b46; color:#fff; } .ap-btn.no { background:#6b3a2f; color:#fff; }
        .ap-tablewrap { overflow-x:auto; border:1px solid #232c37; border-radius:12px; }
        .ap-table { width:100%; border-collapse:collapse; font-size:13px; }
        .ap-table th { text-align:left; padding:10px 12px; background:#11161c; color:#8a98a6; font-weight:600;
                       font-size:11px; letter-spacing:.06em; text-transform:uppercase; border-bottom:1px solid #232c37; }
        .ap-table td { padding:10px 12px; border-bottom:1px solid #1b222b; vertical-align:middle; }
        .ap-table tr.self { background:#10171f; }
        .ap-role { font-size:12px; color:#9fb2c4; } .ap-role.admin { color:#7fb0e6; font-weight:700; }
        .ap-st { font-size:11px; padding:2px 8px; border-radius:999px; text-transform:uppercase; letter-spacing:.04em; }
        .ap-st[data-s="approved"] { background:#16321f; color:#7fe3a0; }
        .ap-st[data-s="pending"] { background:#3a3014; color:#e7c66b; }
        .ap-st[data-s="rejected"], .ap-st[data-s="banned"] { background:#3a1714; color:#f2a4a4; }
        .ap-rowacts { display:flex; flex-wrap:wrap; gap:6px; }
        .ap-mini { border:1px solid #2a3340; background:#1c232c; color:#cdd8e3; border-radius:7px; padding:5px 9px; font-size:12px; cursor:pointer; }
        .ap-mini.ok { border-color:#2f6b46; color:#9fe3b8; } .ap-mini.no { border-color:#6b4a2f; color:#e7c0a0; }
        .ap-mini.del { border-color:#6b3a2f; color:#e08b7a; }
        .ap-youtag { font-size:11px; color:#6b7682; font-style:italic; }
        .ap-filters { display:flex; align-items:center; gap:16px; margin-bottom:12px; }
        /* HOTFIX-041 Part B — user-directory finding tools (touch-friendly: no hover-only anything) */
        .ap-userfilters { gap:10px; flex-wrap:wrap; }
        .ap-search { flex:1 1 220px; min-width:170px; background:#0c0f13; border:1px solid #2a3340; color:#e7edf3;
                     border-radius:8px; padding:9px 12px; font-size:13px; }
        .ap-search::placeholder { color:#5a6570; }
        .ap-search:focus { outline:none; border-color:#3d6ea5; }
        .ap-seg { display:flex; border:1px solid #2a3340; border-radius:8px; overflow:hidden; }
        .ap-segbtn { background:#141a21; border:none; color:#9fb2c4; padding:9px 13px; font-size:12px; font-weight:600;
                     cursor:pointer; border-right:1px solid #2a3340; }
        .ap-segbtn:last-child { border-right:none; }
        .ap-segbtn.on { background:#1a2740; color:#cfe2f6; }
        .ap-filters label { font-size:12px; color:#8a98a6; display:flex; align-items:center; gap:6px; }
        .ap-filters select { background:#0c0f13; border:1px solid #2a3340; color:#e7edf3; border-radius:7px; padding:6px 8px; font-size:13px; }
        .ap-act { font-size:11px; padding:2px 7px; border-radius:6px; background:#1c232c; color:#9fb2c4; }
        .ap-act[data-a="ban"], .ap-act[data-a="reject"], .ap-act[data-a="remove"] { background:#3a1714; color:#f2a4a4; }
        .ap-act[data-a="approve"], .ap-act[data-a="unban"] { background:#16321f; color:#7fe3a0; }
        .ap-act[data-a="role_change"] { background:#1a2740; color:#9fc2f2; }
        .ap-act[data-a="recover"], .ap-act[data-a="register"] { background:#3a3014; color:#e7c66b; }
        .ap-act[data-a="campaign_created"] { background:#142b2a; color:#7fe3d6; }
        /* DEPLOY-010 — dashboard at-a-glance cards (field-dossier feel within the console's dark theme) */
        .ap-cards { display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:12px; margin-bottom:14px; }
        .ap-card { background:#141a21; border:1px solid #232c37; border-left:3px solid #3d6ea5; border-radius:11px; padding:14px 16px; }
        .ap-card.live { border-left-color:#7fe3a0; }
        .ap-card.warn { border-left-color:#e7c66b; }
        .apc-n { font:800 30px/1 'JetBrains Mono', ui-monospace, monospace; color:#fff; display:flex; align-items:center; gap:8px; }
        .apc-dot { width:9px; height:9px; border-radius:50%; background:#7fe3a0; box-shadow:0 0 0 0 rgba(127,227,160,.7); animation:appulse 2s infinite; }
        @keyframes appulse { 0%{box-shadow:0 0 0 0 rgba(127,227,160,.6);} 70%{box-shadow:0 0 0 7px rgba(127,227,160,0);} 100%{box-shadow:0 0 0 0 rgba(127,227,160,0);} }
        .apc-l { font-size:11px; letter-spacing:.1em; text-transform:uppercase; color:#9fb2c4; margin-top:7px; font-weight:600; }
        .apc-s { font-size:11px; color:#6b7682; margin-top:3px; }
        .ap-cardnote { font-size:11px; color:#6b7682; font-style:italic; margin:2px 2px 18px; }
    `],
})
export class AdminPageComponent implements OnDestroy {
    private readonly auth = inject(AuthService);
    private readonly router = inject(Router);

    protected readonly ACTIONS = ['login', 'register', 'approve', 'reject', 'ban', 'unban', 'role_change', 'remove', 'recover', 'campaign_created', 'grant', 'revoke']; // ODM-1: +grant/revoke
    protected readonly tab = signal<Tab>('dashboard'); // DEPLOY-010: the dashboard is the new default
    protected readonly users = signal<GmUser[]>([]);
    protected readonly audit = signal<AuditEntry[]>([]);
    protected readonly stats = signal<AdminStats | null>(null); // DEPLOY-010
    protected readonly busy = signal(false);
    protected readonly auditUser = signal('');
    protected readonly auditAction = signal('');

    protected readonly selfId = computed(() => this.auth.user()?.id ?? '');
    protected readonly pending = computed(() => this.users().filter((u) => u.status === 'pending'));

    // ── HOTFIX-041 Part B — live search + role/provider filter over the user directory ──
    protected readonly FILTERS = [
        { id: 'all', label: 'All' },
        { id: 'accounts', label: 'Accounts' }, // non-guest — the one-click cut past the gst-* noise
        { id: 'guests', label: 'Guests' },
        { id: 'admins', label: 'Admins' },
    ] as const;
    protected readonly q = signal('');
    protected readonly roleFilter = signal<'all' | 'accounts' | 'guests' | 'admins'>('all');
    protected onQ(e: Event): void { this.q.set((e.target as HTMLInputElement).value); }
    // DECISION: default order = newest first (createdAt desc) — matches "who just signed up?", the common admin
    // question; grants-first would bury fresh registrations under the handful of granted rows. Client-side filter
    // is fine at 716 rows; ledger threshold ~5,000 (FOLLOWUPS §HOTFIX-041) before server-side paging is owed.
    protected readonly filteredUsers = computed(() => {
        const f = this.roleFilter();
        const needle = this.q().trim().toLowerCase();
        return this.users()
            .filter((u) => f === 'all' ? true
                : f === 'accounts' ? u.role !== 'guest'
                : f === 'guests' ? u.role === 'guest'
                : u.role === 'admin')
            .filter((u) => !needle
                || (u.displayName ?? '').toLowerCase().includes(needle)
                || (u.email ?? '').toLowerCase().includes(needle)
                || u.id.toLowerCase().includes(needle))
            .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    });
    // DIRECTIVE-ODM-1 — per-account feature grants (the hidden-pack toggle). Set of "userId|feature".
    protected readonly grants = signal<Set<string>>(new Set());
    protected hasGrant(u: GmUser, feature: string): boolean { return this.grants().has(u.id + '|' + feature); }

    // DEPLOY-010: keep "Active now" fresh without a full reload (~20s; cheap counts-only endpoint).
    private readonly poll = setInterval(() => { void this.refreshStats(); }, 20000);

    constructor() {
        void this.load();
    }
    ngOnDestroy(): void { clearInterval(this.poll); }

    private async refreshStats(): Promise<void> { this.stats.set(await this.auth.adminStats()); }

    protected fmt(ts?: number | null): string {
        if (!ts) return '—';
        try { return new Date(ts).toLocaleString(); } catch { return String(ts); }
    }
    protected nameOf(id: string | null): string {
        if (!id) return '—';
        return this.users().find((u) => u.id === id)?.email || id;
    }

    protected async load(): Promise<void> {
        this.busy.set(true);
        try {
            this.stats.set(await this.auth.adminStats()); // DEPLOY-010
            this.users.set(await this.auth.listUsers());
            this.audit.set(await this.auth.listAudit({ user: this.auditUser() || undefined, action: this.auditAction() || undefined }));
            this.grants.set(new Set((await this.auth.listGrants()).map((g) => g.userId + '|' + g.feature))); // ODM-1
            void this.auth.refreshPending();
        } finally { this.busy.set(false); }
    }

    protected onAuditUser(e: Event): void { this.auditUser.set((e.target as HTMLSelectElement).value); void this.reloadAudit(); }
    protected onAuditAction(e: Event): void { this.auditAction.set((e.target as HTMLSelectElement).value); void this.reloadAudit(); }
    private async reloadAudit(): Promise<void> {
        this.audit.set(await this.auth.listAudit({ user: this.auditUser() || undefined, action: this.auditAction() || undefined }));
    }

    // ── mutations (confirm on destructive/role; the server re-enforces self-lockout) ──
    protected async approve(u: GmUser): Promise<void> { await this.run(() => this.auth.approve(u.id)); }
    protected async unban(u: GmUser): Promise<void> { await this.run(() => this.auth.unban(u.id)); }
    protected async reject(u: GmUser): Promise<void> { if (this.ask(`Reject ${u.email || u.id}? They lose access.`)) await this.run(() => this.auth.reject(u.id)); }
    protected async ban(u: GmUser): Promise<void> { if (this.ask(`Ban ${u.email || u.id}? They're locked out on their next request.`)) await this.run(() => this.auth.ban(u.id)); }
    protected async remove(u: GmUser): Promise<void> { if (this.ask(`Remove ${u.email || u.id}? This deletes the account record.`)) await this.run(() => this.auth.removeUser(u.id)); }
    protected async setRole(u: GmUser, role: 'admin' | 'gm'): Promise<void> {
        if (this.ask(`Change ${u.email || u.id} to ${role}?`)) await this.run(() => this.auth.setRole(u.id, role));
    }
    /** ODM-1 — toggle a pack grant. No confirm (reversible one-click; the server audits both directions). */
    protected async toggleGrant(u: GmUser, feature: string): Promise<void> {
        await this.run(() => (this.hasGrant(u, feature) ? this.auth.revokeFeature(u.id, feature) : this.auth.grantFeature(u.id, feature)));
    }

    private ask(msg: string): boolean {
        try { return confirm(msg); } catch { return true; }
    }
    private async run(fn: () => Promise<void>): Promise<void> {
        this.busy.set(true);
        try { await fn(); } catch { /* surfaced by the reload (server is authoritative) */ }
        finally { this.busy.set(false); await this.load(); }
    }

    protected back(): void { void this.router.navigate(['/']); }
}
