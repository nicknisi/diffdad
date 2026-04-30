#!/usr/bin/env bun
import { resolveGitHubToken } from "./auth";

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

  return null;
}

async function reviewCommand(prArg: string | undefined): Promise<number> {
  if (!prArg) {
    console.error("error: missing PR argument");
    console.error("usage: dad review <pr-url-or-shorthand>");
    return 2;
  }

  const parsed = parsePrArg(prArg);
  if (!parsed) {
    console.error(`error: could not parse PR argument: ${prArg}`);
    console.error(
      "expected: https://github.com/owner/repo/pull/123 or owner/repo#123",
    );
    return 2;
  }

  const token = await resolveGitHubToken();
  if (!token) {
    console.error(
      "error: no GitHub token found. set DIFFDAD_GITHUB_TOKEN, run `gh auth login`, or run `dad config`.",
    );
    return 1;
  }

  console.log(
    `dad: reviewing ${parsed.owner}/${parsed.repo}#${parsed.number}`,
  );
  console.log(`dad: github token resolved (length ${token.length})`);
  console.log("dad: fetch + narration not yet wired (Task 6)");
  return 0;
}

function configCommand(): number {
  console.log("dad config: not yet implemented");
  return 0;
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
      return configCommand();
    default:
      console.error(`error: unknown command: ${cmd}`);
      console.error(USAGE);
      return 2;
  }
}

const exitCode = await main(Bun.argv.slice(2));
process.exit(exitCode);
