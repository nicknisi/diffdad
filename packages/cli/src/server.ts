import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { resolve } from "path";
import type { GitHubClient } from "./github/client";
import { mapCommentsToChapters } from "./github/comments";
import type { DiffFile, PRComment, PRMetadata } from "./github/types";
import type { NarrativeResponse } from "./narrative/types";

export type ServerContext = {
  narrative: NarrativeResponse;
  pr: PRMetadata;
  files: DiffFile[];
  comments: PRComment[];
  github: GitHubClient;
  owner: string;
  repo: string;
  headSha: string;
};

type PostCommentBody = {
  body?: string;
  path?: string;
  line?: number;
  side?: "LEFT" | "RIGHT";
  commitId?: string;
};

export function createServer(ctx: ServerContext) {
  const app = new Hono();

  app.get("/api/narrative", (c) => {
    return c.json({
      narrative: ctx.narrative,
      pr: ctx.pr,
      files: ctx.files,
      comments: mapCommentsToChapters(ctx.comments, ctx.narrative),
      repoUrl: `https://github.com/${ctx.owner}/${ctx.repo}`,
    });
  });

  app.get("/api/comments", async (c) => {
    const fresh = await ctx.github.getComments(
      ctx.owner,
      ctx.repo,
      ctx.pr.number,
    );
    ctx.comments = fresh;
    return c.json(mapCommentsToChapters(fresh, ctx.narrative));
  });

  app.post("/api/comments", async (c) => {
    let payload: PostCommentBody;
    try {
      payload = (await c.req.json()) as PostCommentBody;
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }

    if (!payload.body || typeof payload.body !== "string") {
      return c.json({ error: "missing 'body'" }, 400);
    }

    const posted = await ctx.github.postComment(
      ctx.owner,
      ctx.repo,
      ctx.pr.number,
      payload.body,
      payload.path && payload.line
        ? {
            path: payload.path,
            line: payload.line,
            side: payload.side ?? "RIGHT",
            commitId: payload.commitId ?? ctx.headSha,
          }
        : undefined,
    );
    ctx.comments = [...ctx.comments, posted];
    return c.json(posted, 201);
  });

  const webDist = resolve(import.meta.dir, "../../web/dist");

  app.use(
    "/*",
    serveStatic({
      root: webDist,
      rewriteRequestPath: (path) => (path === "/" ? "/index.html" : path),
    }),
  );

  // SPA fallback: any unmatched route serves index.html
  app.get("/*", serveStatic({ root: webDist, path: "index.html" }));

  return app;
}
