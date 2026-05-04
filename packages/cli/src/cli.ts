#!/usr/bin/env bun
import { resolveGitHubToken } from './auth';
import { readConfig, resetConfig, runConfig, showConfig } from './config';
import { GitHubClient } from './github/client';
import { cacheNarrative, clearCache, getCachedNarrative } from './narrative/cache';
import { generateNarrative, setCliOverride } from './narrative/engine';
import { createServer } from './server';

const a = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  purple: '\x1b[38;5;99m',
  green: '\x1b[38;5;78m',
  red: '\x1b[38;5;204m',
  yellow: '\x1b[38;5;221m',
  cyan: '\x1b[38;5;117m',
  gray: '\x1b[38;5;243m',
  white: '\x1b[97m',
};

const DAD_JOKES = [
  "I'm not mad, just diff-appointed.",
  'Why do programmers prefer dark mode? Because light attracts bugs.',
  "What did the merge conflict say? 'We need to resolve our differences.'",
  "I'd tell you a Git joke, but I'm afraid you'd rebase it.",
  'Why did the developer go broke? Because he used up all his cache.',
  'I reviewed your code. It was a-parent-ly good.',
  'Measure twice, merge once.',
  "This PR? Son, I'm proud of you.",
  'I used to hate rebasing. Then it grew on me.',
  'What do you call a pull request from your kid? A chip off the old block.',
  'Your code is like my lawn — time to review it.',
  "I'm reading this diff so you don't have to. You're welcome.",
  'A clean diff is a happy diff.',
  "Don't worry about that force push, champ. We all make mistakes.",
  'Back in my day, we reviewed diffs uphill both ways.',
  "Hi diff, I'm dad.",
];

interface ParsedPr {
  owner: string;
  repo: string;
  number: number;
}

const USAGE = `dad - GitHub PRs as narrated stories

Usage:
  dad <pr>                           Review a PR (shorthand for dad review)
  dad review <pr>                    Review a PR
  dad config                         Configure dad (interactive)
  dad config show                    Print the current config (secrets redacted)
  dad config reset [--yes]           Delete the saved config
  dad cache clear                    Clear all cached narratives
  dad --help, -h                     Show this help

PR argument formats:
  https://github.com/owner/repo/pull/123
  owner/repo#123
  139                                (bare PR number; requires being inside a git repo with a GitHub remote)
`;

export function parsePrArg(arg: string): ParsedPr | null {
  if (!arg) return null;
  const trimmed = arg.trim();

  // Full URL: https://github.com/owner/repo/pull/123
  const urlMatch = trimmed.match(/^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)(?:[/?#].*)?$/i);
  if (urlMatch) {
    const [, owner, repo, num] = urlMatch;
    if (owner && repo && num) {
      return { owner, repo, number: Number(num) };
    }
  }

  // Shorthand: owner/repo#123
  const shortMatch = trimmed.match(/^([^/\s#]+)\/([^/\s#]+)#(\d+)$/);
  if (shortMatch) {
    const [, owner, repo, num] = shortMatch;
    if (owner && repo && num) {
      return { owner, repo, number: Number(num) };
    }
  }

  // Bare number: 139 — handled by reviewCommand via inferRepoFromGit()
  if (/^\d+$/.test(trimmed)) {
    return null;
  }

  return null;
}

export async function inferRepoFromGit(): Promise<{ owner: string; repo: string } | null> {
  try {
    const proc = Bun.spawn(['git', 'remote', 'get-url', 'origin'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) return null;

    const url = (await new Response(proc.stdout).text()).trim();
    if (!url) return null;

    // git@github.com:owner/repo(.git)?
    const sshMatch = url.match(/^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i);
    if (sshMatch) {
      const [, owner, repo] = sshMatch;
      if (owner && repo) return { owner, repo };
    }

    // https://github.com/owner/repo(.git)?
    const httpsMatch = url.match(/^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
    if (httpsMatch) {
      const [, owner, repo] = httpsMatch;
      if (owner && repo) return { owner, repo };
    }

    return null;
  } catch {
    return null;
  }
}

async function reviewCommand(prArg: string | undefined): Promise<number> {
  if (!prArg) {
    console.error('error: missing PR argument');
    console.error('usage: dad review <pr-url-or-shorthand>');
    return 2;
  }

  let parsed = parsePrArg(prArg);
  if (!parsed) {
    const trimmed = prArg.trim();
    if (/^\d+$/.test(trimmed)) {
      const inferred = await inferRepoFromGit();
      if (!inferred) {
        console.error(
          `error: bare PR number "${trimmed}" requires being inside a git repo with a GitHub "origin" remote`,
        );
        return 2;
      }
      parsed = { owner: inferred.owner, repo: inferred.repo, number: Number(trimmed) };
      console.log(`  ${a.dim}Inferred repo from git remote: ${a.cyan}${inferred.owner}/${inferred.repo}${a.reset}`);
    } else {
      console.error(`error: could not parse PR argument: ${prArg}`);
      console.error('expected: https://github.com/owner/repo/pull/123, owner/repo#123, or a bare PR number (e.g. 139)');
      return 2;
    }
  }

  const token = await resolveGitHubToken();
  if (!token) {
    console.error(`\n  ${a.red}${a.bold}error:${a.reset} no GitHub token found.`);
    console.error(
      `  ${a.dim}set DIFFDAD_GITHUB_TOKEN, run ${a.cyan}gh auth login${a.reset}${a.dim}, or run ${a.cyan}dad config${a.reset}\n`,
    );
    return 1;
  }

  const withFlag = Bun.argv.find((f) => f.startsWith('--with='));
  if (withFlag) setCliOverride(withFlag.split('=')[1]!);

  const config = await readConfig();
  const github = new GitHubClient(token);

  const slug = `${parsed.owner}/${parsed.repo}#${parsed.number}`;
  console.log(`\n  ${a.purple}${a.bold}Diff Dad${a.reset}  ${a.dim}—${a.reset}  ${a.white}${slug}${a.reset}`);
  console.log(`  ${a.dim}Fetching PR data...${a.reset}`);

  let metadata, files, comments;
  try {
    [metadata, files, comments] = await Promise.all([
      github.getPR(parsed.owner, parsed.repo, parsed.number),
      github.getDiff(parsed.owner, parsed.repo, parsed.number),
      github.getComments(parsed.owner, parsed.repo, parsed.number),
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('404')) {
      console.error(
        `\n  ${a.red}${a.bold}error:${a.reset} PR #${parsed.number} not found in ${a.cyan}${parsed.owner}/${parsed.repo}${a.reset}`,
      );
      console.error(
        `  ${a.dim}If this PR is in a different repo, use: ${a.cyan}dad owner/repo#${parsed.number}${a.reset}\n`,
      );
    } else {
      console.error(`\n  ${a.red}${a.bold}error:${a.reset} ${msg}\n`);
    }
    return 1;
  }

  const [checkRuns, reviews] = await Promise.all([
    github.getCheckRuns(parsed.owner, parsed.repo, metadata.headSha).catch(() => []),
    github.getReviews(parsed.owner, parsed.repo, parsed.number).catch(() => []),
  ]);

  const stateLabel =
    metadata.state === 'merged'
      ? `${a.purple}merged${a.reset}`
      : metadata.state === 'closed'
        ? `${a.red}closed${a.reset}`
        : metadata.draft
          ? `${a.gray}draft${a.reset}`
          : `${a.green}open${a.reset}`;

  console.log(`\n  ${a.bold}${metadata.title}${a.reset}`);
  console.log(
    `  ${stateLabel}  ${a.green}+${metadata.additions}${a.reset} ${a.red}-${metadata.deletions}${a.reset}  ${a.dim}${files.length} files · ${comments.length} comments · ${checkRuns.length} checks${a.reset}`,
  );

  if (reviews.length > 0) {
    const reviewLine = reviews
      .map((r) => {
        const icon =
          r.state === 'APPROVED'
            ? `${a.green}✓${a.reset}`
            : r.state === 'CHANGES_REQUESTED'
              ? `${a.red}✗${a.reset}`
              : `${a.gray}●${a.reset}`;
        return `${icon} ${a.dim}${r.user}${a.reset}`;
      })
      .join('  ');
    console.log(`  ${reviewLine}`);
  }

  const noCache = Bun.argv.includes('--no-cache');
  const cached = noCache ? null : await getCachedNarrative(parsed.owner, parsed.repo, parsed.number, metadata.headSha);

  const ctx = {
    narrative: cached,
    pr: metadata,
    files,
    comments,
    checkRuns,
    reviews,
    github,
    owner: parsed.owner,
    repo: parsed.repo,
    headSha: metadata.headSha,
  };

  const { app, broadcast } = createServer(ctx);
  const portFlag = Bun.argv.find((f) => f.startsWith('--port='));
  const port = portFlag ? parseInt(portFlag.split('=')[1]) : 0;
  const server = Bun.serve({ fetch: app.fetch, port, idleTimeout: 255 });
  const url = `http://localhost:${server.port}`;

  if (cached) {
    console.log(`\n  ${a.dim}Using cached narrative ${a.gray}(${metadata.headSha.slice(0, 7)})${a.reset}`);
  }

  console.log(`\n  ${a.purple}${a.bold}${url}${a.reset}`);
  const joke = DAD_JOKES[Math.floor(Math.random() * DAD_JOKES.length)];
  console.log(`\n  ${a.italic}${a.gray}"${joke}"${a.reset}\n`);

  if (!Bun.argv.includes('--no-open')) {
    const { default: open } = await import('open');
    await open(url);
  }

  if (!cached) {
    const withCli = Bun.argv.find((f) => f.startsWith('--with='))?.split('=')[1];
    const providerHint = withCli ?? config.aiProvider ?? config.defaultCli ?? 'claude';
    const waitJoke = DAD_JOKES[Math.floor(Math.random() * DAD_JOKES.length)];
    console.log(
      `  ${a.yellow}Generating narrative${a.reset} ${a.gray}via${a.reset} ${a.cyan}${providerHint}${a.reset}`,
    );
    console.log(`  ${a.italic}${a.gray}"${waitJoke}"${a.reset}`);
    const isTty = Boolean(process.stdout.isTTY);
    let lastRender = 0;
    const onProgress = ({ chars }: { chars: number }) => {
      broadcast('narrative-progress', { chars });
      if (!isTty) return;
      const now = Date.now();
      if (now - lastRender < 100) return;
      lastRender = now;
      process.stdout.write(`\r  ${a.dim}${chars.toLocaleString()} chars generated...${a.reset}`);
    };
    const { narrative: generated, provider: usedProvider } = await generateNarrative(
      metadata,
      files,
      [],
      config,
      undefined,
      onProgress,
    );
    if (isTty) process.stdout.write('\r\x1b[2K');
    ctx.narrative = generated;
    await cacheNarrative(parsed.owner, parsed.repo, parsed.number, metadata.headSha, generated);
    console.log(
      `  ${a.green}✓${a.reset} ${generated.chapters.length} chapters generated ${a.dim}via ${usedProvider}${a.reset}`,
    );
    broadcast('narrative', {
      narrative: generated,
      pr: metadata,
      files,
      comments,
    });
  }

  await new Promise(() => {});
}

async function configCommand(sub?: string): Promise<number> {
  if (sub === 'show') return await showConfig();
  if (sub === 'reset') {
    const yes = Bun.argv.includes('--yes') || Bun.argv.includes('-y');
    return await resetConfig({ yes });
  }
  if (sub) {
    console.error(`error: unknown config subcommand: ${sub}`);
    console.error('usage: dad config [show|reset]');
    return 2;
  }
  return await runConfig();
}

async function main(argv: string[]): Promise<number> {
  if (argv.includes('--help')) {
    console.log(USAGE);
    return 0;
  }
  if (argv.includes('--version')) {
    const pkg = await import('../package.json');
    console.log(pkg.version ?? '0.0.0');
    return 0;
  }

  const positional = argv.filter((a) => !a.startsWith('--'));
  const [cmd, ...rest] = positional;

  if (!cmd || cmd === '-h' || cmd === 'help') {
    console.log(USAGE);
    return 0;
  }

  if (cmd === '-v' || cmd === '-V') {
    const pkg = await import('../package.json');
    console.log(pkg.version ?? '0.0.0');
    return 0;
  }

  switch (cmd) {
    case 'review':
      return await reviewCommand(rest[0]);
    case 'config':
      return await configCommand(rest[0]);
    case 'cache': {
      if (rest[0] === 'clear') {
        const count = await clearCache();
        console.log(count > 0 ? `Cleared ${count} cached narrative${count === 1 ? '' : 's'}.` : 'Cache already empty.');
        return 0;
      }
      console.error('usage: dad cache clear');
      return 2;
    }
    default:
      return await reviewCommand(cmd);
  }
}

const exitCode = await main(Bun.argv.slice(2));
process.exit(exitCode);
