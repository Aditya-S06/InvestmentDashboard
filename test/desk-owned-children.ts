import type { ChildProcess } from 'child_process';

// Cold pinned imports get a separate budget from post-ready work and retirement.
export const CHECKPOINT_COLD_MS = 45_000;
export const CHILD_EXIT_MS = 15_000;
const KILL_EXIT_MS = 5_000;
const READY = 'DESK_FIXTURE_READY\n';
type Receipt = { child: ChildProcess; label: string; started: number; ready: boolean;
  closed: boolean; spawnError: boolean; stdoutBytes: number; stderrBytes: number };

/** Own handles immediately. Diagnostics retain counts/stages, never child payloads,
 * argv, paths, environment or raw errors (including split credential strings). */
export class OwnedChildren {
  private receipts = new Map<ChildProcess, Receipt>();
  track(child: ChildProcess, label: string): ChildProcess {
    const receipt: Receipt = { child, label, started: performance.now(), ready: false,
      closed: false, spawnError: false, stdoutBytes: 0, stderrBytes: 0 };
    this.receipts.set(child, receipt);
    let suffix = '';
    child.stdout?.on('data', (data: Buffer) => {
      receipt.stdoutBytes += data.length;
      // The only retained output is a fixed marker prefix, at most READY.length.
      for (const byte of data) {
        const char = String.fromCharCode(byte);
        suffix = READY.startsWith(suffix + char) ? suffix + char : char === READY[0] ? char : '';
        if (suffix === READY) { receipt.ready = true; suffix = ''; }
      }
    });
    child.stderr?.on('data', (data: Buffer) => { receipt.stderrBytes += data.length; });
    child.on('error', () => { receipt.spawnError = true; });
    child.once('close', () => { receipt.closed = true; });
    return child;
  }
  diagnostics(child: ChildProcess) {
    const r = this.receipts.get(child)!;
    return JSON.stringify({ fixture: r.label, elapsedMs: Math.round(performance.now() - r.started),
      ready: r.ready, closed: r.closed, spawnError: r.spawnError,
      exitCode: child.exitCode, signal: child.signalCode, stdoutBytes: r.stdoutBytes, stderrBytes: r.stderrBytes });
  }
  async wait(child: ChildProcess, phase: 'ready' | 'exit', budget: number) {
    const r = this.receipts.get(child);
    if (!r) throw new Error('Unregistered fixture child');
    const end = performance.now() + budget;
    while (true) {
      if (r.spawnError) throw new Error(`Fixture spawn failed: ${this.diagnostics(child)}`);
      if (phase === 'exit' ? r.closed : r.ready) return;
      if (r.closed || performance.now() >= end) {
        throw new Error(`Fixture ${phase} ${r.closed ? 'closed early' : 'budget exceeded'} (${budget}ms): ${this.diagnostics(child)}`);
      }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  async checkpoint(child: ChildProcess, exitBudget = CHILD_EXIT_MS) {
    await this.wait(child, 'ready', CHECKPOINT_COLD_MS);
    await this.wait(child, 'exit', exitBudget);
    if (child.exitCode !== 0) throw new Error(`Checkpoint fixture failed: ${this.diagnostics(child)}`);
  }
  get allClosed() { return [...this.receipts.values()].every(r => r.closed); }
  async retire() {
    // Concurrent settlement ensures one bad child cannot skip later children.
    const results = await Promise.allSettled([...this.receipts.values()].map(async r => {
      if (r.closed) return;
      // Release fixture/control leases before signalling the process. In a
      // Windows venv the handle can belong to an interpreter launcher, while
      // the real interpreter still owns its pipes. EOF reaches that interpreter.
      r.child.stdin?.end();
      let failure: unknown;
      try { await this.wait(r.child, 'exit', CHILD_EXIT_MS); }
      catch (error) { failure = error; }
      if (!r.closed) {
        // Signal only the ChildProcess we created, never a PID from a file/list.
        // Supervisors own graph jobs/leases; cancellation runs before retirement.
        if (r.child.exitCode === null && r.child.signalCode === null) r.child.kill('SIGKILL');
        await this.wait(r.child, 'exit', KILL_EXIT_MS);
      }
      if (failure) throw failure; // Forced retirement never turns a timeout into a pass.
    }));
    const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failures.length) throw new Error(`Owned fixture retirement failed:\n${failures.map(r => String(r.reason)).join('\n')}`);
  }
}
