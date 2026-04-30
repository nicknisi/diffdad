import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { generateText } from "ai";
import { resolve } from "path";
import { readConfig } from "./config";
import type { GitHubClient } from "./github/client";
import { mapCommentsToChapters } from "./github/comments";
import type { CheckRun, DiffFile, PRComment, PRMetadata } from "./github/types";
import { getModel } from "./narrative/engine";
import type { NarrativeResponse } from "./narrative/types";

export type ServerContext = {
  narrative: NarrativeResponse;
  pr: PRMetadata;
  files: DiffFile[];
  comments: PRComment[];
  checkRuns: CheckRun[];
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
  type SseClient = (event: string, data: unknown) => void;
  const sseClients = new Set<SseClient>();

  function broadcast(event: string, data: unknown) {
    for (const send of sseClients) {
      send(event, data);
    }
  }

  app.get("/api/narrative", async (c) => {
    const config = await readConfig();
    return c.json({
      narrative: ctx.narrative,
      pr: ctx.pr,
      files: ctx.files,
      comments: mapCommentsToChapters(ctx.comments, ctx.narrative),
      checkRuns: ctx.checkRuns,
      repoUrl: `https://github.com/${ctx.owner}/${ctx.repo}`,
      config: {
        storyStructure: config.storyStructure ?? "chapters",
        layoutMode: config.layoutMode ?? "toc",
        displayDensity: config.displayDensity ?? "comfortable",
        defaultNarrationDensity: config.defaultNarrationDensity ?? "normal",
        clusterBots: config.clusterBots ?? true,
      },
    });
  });

  app.post("/api/ai", async (c) => {
    let body: {
      action?: string;
      chapterIndex?: number;
      question?: string;
      lens?: string;
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }

    const { action, chapterIndex, question, lens } = body;

    if (typeof chapterIndex !== "number") {
      return c.json({ error: "missing chapterIndex" }, 400);
    }

    const chapter = ctx.narrative.chapters[chapterIndex];
    if (!chapter) return c.json({ error: "invalid chapter" }, 400);

    const allHunks = ctx.files.flatMap((f) =>
      f.hunks.map((h) => ({ hunk: h, file: f.file })),
    );
    const chapterDiff = chapter.sections
      .filter((s): s is Extract<typeof s, { type: "diff" }> => s.type === "diff")
      .map((s) => {
        const flat = allHunks[s.hunkIndex];
        if (!flat) return "";
        return (
          `--- ${flat.file} ---\n` +
          flat.hunk.lines
            .map((l) => {
              const prefix =
                l.type === "add" ? "+" : l.type === "remove" ? "-" : " ";
              return prefix + l.content;
            })
            .join("\n")
        );
      })
      .join("\n\n");

    const config = await readConfig();
    let model;
    try {
      model = getModel(config);
    } catch (err) {
      return c.json(
        { error: `model unavailable: ${(err as Error).message}` },
        500,
      );
    }

    let systemPrompt: string;
    let userPrompt: string;

    if (action === "ask") {
      if (!question || typeof question !== "string") {
        return c.json({ error: "missing question" }, 400);
      }
      systemPrompt =
        "You are a code review assistant. Answer questions about the code changes concisely. Use markdown.";
      userPrompt = `Chapter: ${chapter.title}\n\nNarration: ${chapter.summary}\n\nDiff:\n${chapterDiff}\n\nQuestion: ${question}`;
    } else if (action === "renarrate") {
      if (!lens || typeof lens !== "string") {
        return c.json({ error: "missing lens" }, 400);
      }
      const densityLenses = ["terse", "normal", "verbose"];
      const isDensity = densityLenses.includes(lens);
      if (isDensity) {
        const sizing =
          lens === "terse"
            ? "One sentence max."
            : lens === "verbose"
              ? "One detailed paragraph."
              : "Two to three sentences.";
        systemPrompt = `You are a code review narrator. Rewrite this chapter narration in a ${lens} style. ${sizing} Use markdown.`;
      } else {
        systemPrompt = `You are a code review narrator. Re-narrate through a ${lens} lens. Focus on what matters from that perspective. 2-3 sentences, markdown.`;
      }
      userPrompt = `Chapter: ${chapter.title}\n\nOriginal: ${chapter.summary}\n\nDiff:\n${chapterDiff}`;
    } else {
      return c.json({ error: "unknown action" }, 400);
    }

    try {
      const result = await generateText({
        model,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      });
      return c.json({ text: result.text });
    } catch (err) {
      return c.json(
        { error: `AI request failed: ${(err as Error).message}` },
        500,
      );
    }
  });

  app.get("/api/checks", async (c) => {
    const fresh = await ctx.github.getCheckRuns(
      ctx.owner,
      ctx.repo,
      ctx.headSha,
    );
    ctx.checkRuns = fresh;
    return c.json(fresh);
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

  app.get("/api/events", (c) => {
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        const send = (event: string, data: unknown) => {
          try {
            controller.enqueue(
              encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
            );
          } catch {
            // controller closed
          }
        };

        send("connected", { timestamp: Date.now() });
        sseClients.add(send);

        const interval = setInterval(async () => {
          try {
            const fresh = await ctx.github.getComments(
              ctx.owner,
              ctx.repo,
              ctx.pr.number,
            );
            const newComments = fresh.filter(
              (cm) => !ctx.comments.find((existing) => existing.id === cm.id),
            );
            for (const comment of newComments) {
              send("comment", comment);
            }
            ctx.comments = fresh;

            const freshChecks = await ctx.github.getCheckRuns(
              ctx.owner,
              ctx.repo,
              ctx.headSha,
            );
            ctx.checkRuns = freshChecks;
            send("checks", freshChecks);
          } catch {
            // swallow polling errors
          }
        }, 10000);

        c.req.raw.signal.addEventListener("abort", () => {
          clearInterval(interval);
          sseClients.delete(send);
          try {
            controller.close();
          } catch {
            // already closed
          }
        });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
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
    broadcast("comment", posted);
    return c.json(posted, 201);
  });

  app.post("/api/review", async (c) => {
    let payload: { event?: string; body?: string };
    try {
      payload = (await c.req.json()) as { event?: string; body?: string };
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const eventMap: Record<string, "COMMENT" | "APPROVE" | "REQUEST_CHANGES"> = {
      comment: "COMMENT",
      approve: "APPROVE",
      request_changes: "REQUEST_CHANGES",
    };
    const ghEvent = payload.event ? eventMap[payload.event] : undefined;
    if (!ghEvent) return c.json({ error: "invalid event" }, 400);

    await ctx.github.submitReview(
      ctx.owner,
      ctx.repo,
      ctx.pr.number,
      ghEvent,
      payload.body,
    );
    broadcast("review", { event: ghEvent, body: payload.body });
    return c.json({ ok: true });
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
