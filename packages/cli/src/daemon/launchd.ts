import { mkdir, rm, writeFile } from 'fs/promises';
import { homedir } from 'os';
import { basename, join } from 'path';
import { dataDir } from '../paths';
import { DEFAULT_DAEMON_PORT } from './daemon';

/** Reverse-DNS label for the per-user LaunchAgent. Also the plist basename and the launchctl target. */
export const LAUNCH_AGENT_LABEL = 'com.diffdad.daemon';

/** ~/Library/LaunchAgents/com.diffdad.daemon.plist — per-user agent (no root, no sudo). */
function plistPath(): string {
  return join(homedir(), 'Library', 'LaunchAgents', `${LAUNCH_AGENT_LABEL}.plist`);
}

/** Daemon stdout/stderr land beside the rest of dad's state so logs are findable. */
function logDir(): string {
  return dataDir();
}

/** The `gui/<uid>` domain a per-user LaunchAgent is bootstrapped into (modern launchctl). */
function guiDomain(): string {
  return `gui/${process.getuid?.() ?? ''}`;
}

/**
 * Resolve the program + args launchd should exec to run the daemon on the stable port.
 *
 * - Compiled binary (`dad`): `process.execPath` IS the dad executable, so it runs directly with
 *   the `daemon` subcommand. This is the only path `dad daemon install` is meant for in production.
 * - Dev fallback (`bun packages/cli/src/cli.ts daemon install`): `process.execPath` is the *bun*
 *   binary, not dad — exec'ing it alone would just start a REPL. We detect that and emit
 *   `bun <abs cli.ts> daemon` so an install done from a dev checkout still produces a working agent.
 */
export function resolveProgramArgs(): string[] {
  const exec = process.execPath;
  // `import.meta.dir` is this file's dir under the source tree only when run from source.
  const isCompiledDad = basename(exec) === 'dad';
  if (isCompiledDad) {
    return [exec, 'daemon', `--port=${DEFAULT_DAEMON_PORT}`, '--no-open'];
  }
  // Dev: point bun at this checkout's cli.ts (…/daemon/launchd.ts → …/cli.ts).
  const cliEntry = join(import.meta.dir, '..', 'cli.ts');
  return [exec, cliEntry, 'daemon', `--port=${DEFAULT_DAEMON_PORT}`, '--no-open'];
}

/** XML-escape a string for safe interpolation into the plist (paths can contain `&`, `<`, etc.). */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Build the LaunchAgent plist XML. Pure (no I/O) so it is unit-testable / eyeball-able. `RunAtLoad`
 * starts it at login; `KeepAlive` {SuccessfulExit:false} restarts it only on a *non-zero* exit (a
 * crash) — never on the single-instance guard's clean exit-0 refusal, so a launchd copy and a manual
 * `dad daemon` can't fight in a respawn loop. `ThrottleInterval` caps respawn frequency at 10s.
 */
export function buildPlist(programArgs: string[] = resolveProgramArgs(), logs: string = logDir()): string {
  const argXml = programArgs.map((arg) => `    <string>${xmlEscape(arg)}</string>`).join('\n');
  const out = xmlEscape(join(logs, 'daemon.out.log'));
  const err = xmlEscape(join(logs, 'daemon.err.log'));
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${argXml}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${out}</string>
  <key>StandardErrorPath</key>
  <string>${err}</string>
  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
`;
}

/** Run `launchctl <args>`, returning {ok, stderr}. Never throws on a non-zero exit. */
async function launchctl(args: string[]): Promise<{ ok: boolean; stderr: string }> {
  try {
    const proc = Bun.spawn(['launchctl', ...args], { stdout: 'pipe', stderr: 'pipe' });
    const code = await proc.exited;
    const stderr = (await new Response(proc.stderr).text()).trim();
    return { ok: code === 0, stderr };
  } catch (err) {
    return { ok: false, stderr: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Install (or reinstall) the LaunchAgent: write the plist, then (re)load it via launchctl.
 * Idempotent — overwrites the plist and bootstraps a fresh copy each call (bootout-then-bootstrap).
 *
 * GUARD: this performs real side effects (writes ~/Library and runs launchctl). It must only ever be
 * invoked from the `dad daemon install` CLI command, never at import time.
 */
export async function install(): Promise<{ ok: boolean; path: string; message: string }> {
  const path = plistPath();
  const xml = buildPlist();

  try {
    await mkdir(logDir(), { recursive: true });
    await mkdir(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true });
    await writeFile(path, xml);
  } catch (err) {
    return {
      ok: false,
      path,
      message: `could not write the LaunchAgent plist: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const domain = guiDomain();
  // Reload semantics: bootout any prior copy (ignore "not loaded" errors), then bootstrap the new one.
  await launchctl(['bootout', `${domain}/${LAUNCH_AGENT_LABEL}`]);
  const boot = await launchctl(['bootstrap', domain, path]);
  if (!boot.ok) {
    return {
      ok: false,
      path,
      message: `wrote the plist but launchctl bootstrap failed: ${boot.stderr || 'unknown error'}. The daemon is still runnable from a terminal with \`dad daemon\`.`,
    };
  }
  return { ok: true, path, message: `installed and loaded the LaunchAgent (${LAUNCH_AGENT_LABEL}).` };
}

/**
 * Uninstall the LaunchAgent: bootout (unload) it, then remove the plist. Idempotent — a missing
 * plist or an already-unloaded agent is treated as success.
 *
 * GUARD: real side effects (launchctl + unlink). CLI-command-only, never at import.
 */
export async function uninstall(): Promise<{ ok: boolean; path: string; message: string }> {
  const path = plistPath();
  const domain = guiDomain();
  await launchctl(['bootout', `${domain}/${LAUNCH_AGENT_LABEL}`]);
  try {
    await rm(path, { force: true });
  } catch (err) {
    return {
      ok: false,
      path,
      message: `unloaded the agent but could not remove the plist: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  return { ok: true, path, message: `unloaded and removed the LaunchAgent (${LAUNCH_AGENT_LABEL}).` };
}
