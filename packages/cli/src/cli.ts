#!/usr/bin/env bun
import { resolveGitHubToken } from "./auth";
import { readConfig, runConfig } from "./config";
import { GitHubClient } from "./github/client";
import { cacheNarrative, getCachedNarrative } from "./narrative/cache";
import { generateNarrative } from "./narrative/engine";
import type { NarrativeResponse } from "./narrative/types";
import { createServer } from "./server";

interface ParsedPr {
  owner: string;
  repo: string;
  number: number;
}

const USAGE = `dad - GitHub PRs as narrated stories

Usage:
  dad review <pr-url-or-shorthand>   Review a PR
  dad config                         Configure dad (interactive)
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
  const urlMatch = trimmed.match(
    /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)(?:[/?#].*)?$/i,
  );
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
    const proc = Bun.spawn(["git", "remote", "get-url", "origin"], {
      stdout: "pipe",
      stderr: "pipe",
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
    console.error("error: missing PR argument");
    console.error("usage: dad review <pr-url-or-shorthand>");
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
    } else {
      console.error(`error: could not parse PR argument: ${prArg}`);
      console.error(
        "expected: https://github.com/owner/repo/pull/123, owner/repo#123, or a bare PR number (e.g. 139)",
      );
      return 2;
    }
  }

  const token = await resolveGitHubToken();
  if (!token) {
    console.error(
      "error: no GitHub token found. set DIFFDAD_GITHUB_TOKEN, run `gh auth login`, or run `dad config`.",
    );
    return 1;
  }

  const config = await readConfig();
  const github = new GitHubClient(token);

  console.log(`Fetching ${parsed.owner}/${parsed.repo}#${parsed.number}...`);
  const [metadata, files, comments] = await Promise.all([
    github.getPR(parsed.owner, parsed.repo, parsed.number),
    github.getDiff(parsed.owner, parsed.repo, parsed.number),
    github.getComments(parsed.owner, parsed.repo, parsed.number),
  ]);

  const checkRuns = await github
    .getCheckRuns(parsed.owner, parsed.repo, metadata.headSha)
    .catch((err) => {
      console.warn(`warn: failed to fetch check runs: ${err instanceof Error ? err.message : err}`);
      return [];
    });

  console.log(`${metadata.title} — ${files.length} files, +${metadata.additions} -${metadata.deletions}`);

  const noCache = Bun.argv.includes("--no-cache");
  const cached = noCache
    ? null
    : await getCachedNarrative(parsed.owner, parsed.repo, parsed.number, metadata.headSha);
  let narrative: NarrativeResponse;
  if (cached) {
    console.log("Using cached narrative (same commit SHA).");
    narrative = cached;
  } else {
    console.log("Generating narrative...");
    narrative = await generateNarrative(metadata, files, [], config);
    await cacheNarrative(parsed.owner, parsed.repo, parsed.number, metadata.headSha, narrative);
    console.log(`${narrative.chapters.length} chapters generated.`);
  }
  console.log("Starting server...");

  const app = createServer({ narrative, pr: metadata, files, comments, checkRuns, github, owner: parsed.owner, repo: parsed.repo, headSha: metadata.headSha });

  // Check for --port=N flag
  const portFlag = Bun.argv.find(a => a.startsWith("--port="));
  const port = portFlag ? parseInt(portFlag.split("=")[1]) : 0;
  const server = Bun.serve({ fetch: app.fetch, port });

  const url = `http://localhost:${server.port}`;
  console.log(`\n  Diff Dad — ${url}\n`);
  console.log(`  Reviewing: ${parsed.owner}/${parsed.repo}#${parsed.number}`);
  console.log(`  ${narrative.chapters.length} chapters · ${comments.length} comments\n`);

  if (!Bun.argv.includes("--no-open")) {
    const { default: open } = await import("open");
    await open(url);
  }

  // Keep process alive
  await new Promise(() => {});
}

async function configCommand(): Promise<number> {
  return await runConfig();
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;

  if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") {
    console.log(USAGE);
    return 0;
  }

  switch (cmd) {
    case "review":
      return await reviewCommand(rest[0]);
    case "config":
      return await configCommand();
    default:
      console.error(`error: unknown command: ${cmd}`);
      console.error(USAGE);
      return 2;
  }
}

const exitCode = await main(Bun.argv.slice(2));
process.exit(exitCode);
