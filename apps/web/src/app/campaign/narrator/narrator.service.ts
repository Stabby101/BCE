import { Injectable, signal } from '@angular/core';
import { buildRefine, buildValidate, buildVoiceRewrite, buildCoherence, cleanProse, type ChatBody } from './narrator-prompts';
import { diffLocked, noInventedNumbers, numbersIn } from './machine-diff';
import type { CoherenceVerdict, NarratorMode, NarratorStats, RefineResult, RefineTarget, ValidateReport, VoiceBoxResult, VoiceBoxTarget, WholeMissionResult } from './narrator-types';

const K = {
    mode: 'bce.narrator.mode', endpoint: 'bce.narrator.endpoint', briefings: 'bce.narrator.briefings',
    aars: 'bce.narrator.aars', cumulative: 'bce.narrator.cumulative', cap: 'bce.spa.cap',
    model: 'bce.narrator.model',
};
const DEFAULT_ENDPOINT = 'http://127.0.0.1:8081';

function lsGet(k: string, fallback: string): string { try { return localStorage.getItem(k) ?? fallback; } catch { return fallback; } }
function lsSet(k: string, v: string): void { try { localStorage.setItem(k, v); } catch { /* private mode */ } }

interface VoiceCard { name: string; speechRules: string[] }
export interface Cumulative { refineRuns: number; validateRuns: number; promptTokens: number; completionTokens: number }

@Injectable({ providedIn: 'root' })
export class NarratorService {
    readonly mode = signal<NarratorMode>(lsGet(K.mode, 'off') === 'local' ? 'local' : 'off');
    readonly endpoint = signal<string>(lsGet(K.endpoint, DEFAULT_ENDPOINT));
    readonly briefingsOn = signal<boolean>(lsGet(K.briefings, '1') === '1');
    readonly aarsOn = signal<boolean>(lsGet(K.aars, '1') === '1');
    readonly capVariant = signal<string>(lsGet(K.cap, 'standard'));
    readonly activeModel = signal<string>(lsGet(K.model, ''));
    readonly cumulative = signal<Cumulative>(this.loadCumulative());
    /** Live, last refine pass's per-section results (for the package/AAR result UI). */
    readonly lastRun = signal<RefineResult[]>([]);
    readonly busy = signal<boolean>(false);

    private loadCumulative(): Cumulative {
        try { const j = JSON.parse(lsGet(K.cumulative, '')); if (j && typeof j === 'object') return { refineRuns: j.refineRuns || 0, validateRuns: j.validateRuns || 0, promptTokens: j.promptTokens || 0, completionTokens: j.completionTokens || 0 }; } catch { /* */ }
        return { refineRuns: 0, validateRuns: 0, promptTokens: 0, completionTokens: 0 };
    }
    private bumpCumulative(d: Partial<Cumulative>): void {
        const c = this.cumulative();
        const next = { refineRuns: c.refineRuns + (d.refineRuns || 0), validateRuns: c.validateRuns + (d.validateRuns || 0), promptTokens: c.promptTokens + (d.promptTokens || 0), completionTokens: c.completionTokens + (d.completionTokens || 0) };
        this.cumulative.set(next); lsSet(K.cumulative, JSON.stringify(next));
    }

    setMode(m: NarratorMode): void {
        this.mode.set(m); lsSet(K.mode, m);
        if (m === 'local') void this.load(); else void this.unload();
    }
    setEndpoint(e: string): void { this.endpoint.set(e.trim() || DEFAULT_ENDPOINT); lsSet(K.endpoint, this.endpoint()); }
    setBriefings(on: boolean): void { this.briefingsOn.set(on); lsSet(K.briefings, on ? '1' : '0'); }
    setAars(on: boolean): void { this.aarsOn.set(on); lsSet(K.aars, on ? '1' : '0'); }
    setCapVariant(v: string): void { this.capVariant.set(v); lsSet(K.cap, v); }
    setModel(id: string): void {
        this.activeModel.set(id); lsSet(K.model, id);
        if (this.mode() === 'local') void this.load();
    }

    private async hit(path: string, init?: RequestInit, timeoutMs = 8000): Promise<Response> {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), timeoutMs);
        try { return await fetch(this.endpoint() + path, { ...init, signal: ctrl.signal }); } finally { clearTimeout(t); }
    }

    constructor() {
        // Mode ON loads on demand: a session that starts in LOCAL (persisted) warms the model so the
        // GM's first REFINE is ready. The sidecar's grace/idle timers reclaim the 4090 if it goes unused.
        if (this.mode() === 'local') void this.load();
    }

    async load(): Promise<void> {
        const id = this.activeModel();
        try { await this.hit('/load', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(id ? { id } : {}) }); } catch { /* sidecar offline */ }
    }
    async unload(): Promise<void> { try { await this.hit('/unload', { method: 'POST' }); } catch { /* */ } }
    /** Ensure llama-server is loaded + ready before a refine (load-on-demand). Returns false if it never
     *  comes ready within the window (the caller's calls then 503 → graceful template-stands). */
    private async ensureReady(timeoutMs = 120000): Promise<boolean> {
        const want = this.activeModel();
        // ready AND serving the chosen model (a swap to a different id must not be accepted as ready)
        const onTarget = (s: NarratorStats | null) => s?.llama?.status === 'ready' && (!want || s.llama.activeId === want);
        const h = await this.stats();
        if (onTarget(h)) return true;
        await this.load(); // loads or SWAPS to the chosen model
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            await new Promise((r) => setTimeout(r, 1500));
            this.heartbeat(true); // keep it alive while it loads
            const s = await this.stats();
            if (onTarget(s)) return true;
            if (!s || s.sidecar === 'offline') return false;
        }
        return false;
    }
    heartbeat(focused: boolean): void { void this.hit('/heartbeat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ focused }) }, 4000).catch(() => { /* */ }); }

    async stats(): Promise<NarratorStats | null> {
        try { const r = await this.hit('/stats', undefined, 4000); if (!r.ok) return null; return await r.json(); } catch { return null; }
    }
    /** TEST CONNECTION — round-trip + latency. Reports the sidecar + model-load state. */
    async testConnection(): Promise<{ ok: boolean; ms: number; llama: string; model: string; error?: string }> {
        const t0 = performance.now();
        try {
            const r = await this.hit('/health', undefined, 6000);
            const ms = Math.round(performance.now() - t0);
            if (!r.ok) return { ok: false, ms, llama: 'offline', model: '', error: `HTTP ${r.status}` };
            const j = await r.json();
            return { ok: true, ms, llama: j.llama, model: j.model };
        } catch (e) { return { ok: false, ms: Math.round(performance.now() - t0), llama: 'offline', model: '', error: (e as Error).message }; }
    }

    private async chat(body: ChatBody, timeoutMs: number): Promise<{ text: string; usage: { prompt_tokens?: number; completion_tokens?: number } }> {
        const r = await this.hit('/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, timeoutMs);
        if (!r.ok) { const txt = await r.text().catch(() => ''); throw new Error(`server ${r.status}${txt ? ': ' + txt.slice(0, 120) : ''}`); }
        const j = await r.json();
        return { text: j.choices?.[0]?.message?.content ?? '', usage: j.usage ?? {} };
    }

    /**
     * Refine a list of sections. PER-SECTION: one bad section degrades alone. Each: REFINE → cleanProse
     * → MACHINE DIFF (accept only on zero drift) → VALIDATE lint. Returns the per-section results AND
     * applies nothing itself — the caller stores accepted text on the spec/AAR record.
     */
    async refine(targets: RefineTarget[], register: string, voiceFor: (roleFamily: string | null) => VoiceCard | null): Promise<RefineResult[]> {
        this.busy.set(true);
        const results: RefineResult[] = [];
        let runRefine = 0, runValidate = 0, pTok = 0, cTok = 0;
        try {
            await this.ensureReady(); // load-on-demand: the GM's REFINE click IS the demand
            for (const target of targets) {
                const t0 = performance.now();
                let res: RefineResult;
                try {
                    const out = await this.chat(buildRefine(target, voiceFor(target.roleFamily), register), 120000);
                    runRefine++; pTok += out.usage.prompt_tokens || 0; cTok += out.usage.completion_tokens || 0;
                    // outside the JSON — the §2/AAR leak fix), then cleanProse as a belt-and-braces final pass.
                    let refined = cleanProse(this.refinedText(out.text));
                    // TEST SEAM (forceDrift): localStorage 'bce.narrator.forceDrift'==='1' appends a FABRICATED
                    // figure so the §2/AAR noInventedNumbers guard MUST reject — proves the auto-reject path.
                    if (refined && this.driftForced()) refined = this.injectDrift(refined);
                    const diff = diffLocked(target.names, target.text, refined);
                    // own numbers; per-section scope). Closes the DATA-003 hole where §2/AAR shipped fabricated
                    // figures (a hallucinated "3h40m" deadline) that diffLocked never checked for.
                    const inv = noInventedNumbers(refined, numbersIn(target.text));
                    if (!refined) {
                        res = this.fail(target, 'empty model output — template stands', performance.now() - t0, out.usage);
                    } else if (!diff.ok) {
                        res = { id: target.id, label: target.label, status: 'rejected', gate: `machine diff: locked value drift — ${diff.missing.slice(0, 4).join(', ')}${diff.missing.length > 4 ? '…' : ''}`, text: null, validate: null, ms: Math.round(performance.now() - t0), promptTokens: out.usage.prompt_tokens || 0, completionTokens: out.usage.completion_tokens || 0 };
                    } else if (!inv.ok) {
                        res = { id: target.id, label: target.label, status: 'rejected', gate: `machine diff: invented figure — ${inv.missing.slice(0, 4).join(', ')}${inv.missing.length > 4 ? '…' : ''}`, text: null, validate: null, ms: Math.round(performance.now() - t0), promptTokens: out.usage.prompt_tokens || 0, completionTokens: out.usage.completion_tokens || 0 };
                    } else {
                        // THE MACHINE DIFF is authoritative (it just verified every number + name survived).
                        // VALIDATE is an advisory lint, rendered for honesty — never overrides the gate.
                        let validate: ValidateReport | null = null;
                        try { const v = await this.chat(buildValidate(refined, target.text), 60000); runValidate++; pTok += v.usage.prompt_tokens || 0; cTok += v.usage.completion_tokens || 0; validate = this.parseValidate(v.text); } catch { /* validate best-effort */ }
                        res = { id: target.id, label: target.label, status: 'accepted', gate: null, text: refined, validate, ms: Math.round(performance.now() - t0), promptTokens: out.usage.prompt_tokens || 0, completionTokens: out.usage.completion_tokens || 0 };
                    }
                } catch (e) {
                    res = this.fail(target, (e as Error).message, performance.now() - t0, {});
                }
                results.push(res);
                this.lastRun.set([...results]);
            }
        } finally {
            this.bumpCumulative({ refineRuns: runRefine, validateRuns: runValidate, promptTokens: pTok, completionTokens: cTok });
            this.busy.set(false);
        }
        return results;
    }

    async refineWholeMission(pkg: string, boxes: VoiceBoxTarget[], register: string, lockedManifest: string[]): Promise<WholeMissionResult> {
        this.busy.set(true);
        const t0 = performance.now();
        const voices: VoiceBoxResult[] = [];
        let coherence: CoherenceVerdict | null = null;
        let pTok = 0, cTok = 0, runRefine = 0;
        const allowed = numbersIn(`${pkg}\n${lockedManifest.join(' ')}`); // every figure the model may use
        try {
            if (!(await this.ensureReady())) {
                for (const b of boxes) voices.push({ id: b.id, status: 'error', gate: 'engine not ready — stubs stand', text: null });
                return { voices, coherence, ms: Math.round(performance.now() - t0), tokS: 0, promptTokens: 0, completionTokens: 0 };
            }
            const model = this.activeModel() || 'active';
            // ── Job 1: mission-aware voice ──
            try {
                const out = await this.chat(buildVoiceRewrite(pkg, boxes, register, lockedManifest), 120000);
                runRefine++; pTok += out.usage.prompt_tokens || 0; cTok += out.usage.completion_tokens || 0;
                const map = this.parseVoiceBoxes(out.text);
                let forcedOnce = false;
                for (const b of boxes) {
                    let text = cleanProse(map[b.id] || '');
                    if (text && this.driftForced() && !forcedOnce) { text = this.injectVoiceDrift(text); forcedOnce = true; } // test seam
                    if (!text) { voices.push({ id: b.id, status: 'error', gate: 'empty voice — stub stands', text: null }); continue; }
                    const guard = noInventedNumbers(text, allowed);
                    if (!guard.ok) voices.push({ id: b.id, status: 'rejected', gate: `machine diff: invented figure — ${guard.missing.slice(0, 4).join(', ')}`, text: null });
                    else voices.push({ id: b.id, status: 'accepted', gate: null, text });
                }
            } catch (e) {
                for (const b of boxes) voices.push({ id: b.id, status: 'error', gate: (e as Error).message, text: null });
            }
            // ── Job 2: coherence verdict ──
            try {
                const out = await this.chat(buildCoherence(pkg), 90000);
                runRefine++; pTok += out.usage.prompt_tokens || 0; cTok += out.usage.completion_tokens || 0;
                coherence = this.parseCoherence(out.text, model);
            } catch { coherence = null; }
        } finally {
            this.bumpCumulative({ refineRuns: runRefine, promptTokens: pTok, completionTokens: cTok });
            this.busy.set(false);
        }
        const ms = Math.round(performance.now() - t0);
        return { voices, coherence, ms, tokS: ms > 0 ? Math.round((cTok / ms) * 1000) : 0, promptTokens: pTok, completionTokens: cTok };
    }

    /** Extract a JSON object from a model reply — strip channel scaffolding/fences (cleanProse) then
     *  slice the outermost braces (some models, esp. the 26B-A4B MoE, wrap JSON in prose/markers). */
    private extractJson(s: string): string {
        const c = cleanProse(s || '');
        const a = c.indexOf('{'), b = c.lastIndexOf('}');
        return a >= 0 && b > a ? c.slice(a, b + 1) : c;
    }
    private refinedText(s: string): string {
        try { const j = JSON.parse(this.extractJson(s)); if (j && typeof j.text === 'string') return j.text; } catch { /* not JSON → raw */ }
        return s || '';
    }
    private parseVoiceBoxes(s: string): Record<string, string> {
        const out: Record<string, string> = {};
        try {
            const j = JSON.parse(this.extractJson(s));
            for (const b of Array.isArray(j.boxes) ? j.boxes : []) if (b && typeof b.id === 'string' && typeof b.text === 'string') out[b.id] = b.text;
        } catch { /* malformed → empty → stubs stand */ }
        return out;
    }
    private parseCoherence(s: string, model: string): CoherenceVerdict | null {
        try {
            const j = JSON.parse(this.extractJson(s));
            const flags = (Array.isArray(j.flags) ? j.flags : []).filter((f: unknown): f is { where: string; issue: string } => !!f && typeof (f as { where?: unknown }).where === 'string' && typeof (f as { issue?: unknown }).issue === 'string').map((f: { where: string; issue: string }) => ({ where: f.where, issue: f.issue }));
            const reads = j.reads === 'flags' || flags.length ? 'flags' : 'clean';
            return { reads, flags, model };
        } catch { return null; }
    }
    /** Test seam (acceptance #3): corrupt a number in a voice box so noInventedNumbers MUST reject it. */
    private injectVoiceDrift(text: string): string {
        return /\d/.test(text) ? text.replace(/\d[\d,]*/, '99999') : text + ' (est. 99999 hostiles).';
    }

    private driftForced(): boolean { try { return localStorage.getItem('bce.narrator.forceDrift') === '1'; } catch { return false; } }
    private injectDrift(refined: string): string {
        return (refined || '') + ' (intel revised — an estimated 87654 additional hostiles massing; unconfirmed).';
    }

    private fail(t: RefineTarget, msg: string, ms: number, usage: { prompt_tokens?: number; completion_tokens?: number }): RefineResult {
        return { id: t.id, label: t.label, status: 'error', gate: msg, text: null, validate: null, ms: Math.round(ms), promptTokens: usage.prompt_tokens || 0, completionTokens: usage.completion_tokens || 0 };
    }
    private parseValidate(s: string): ValidateReport | null {
        try {
            const j = JSON.parse(s);
            return { vagueWords: Array.isArray(j.vagueWords) ? j.vagueWords : [], missingIntelAge: !!j.missingIntelAge, optionImbalance: !!j.optionImbalance, numberDrift: !!j.numberDrift, verdict: ['pass', 'warn', 'fail'].includes(j.verdict) ? j.verdict : 'warn' };
        } catch { return null; }
    }
}
