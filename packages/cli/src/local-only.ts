import type { Context, Next } from 'hono';

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Reject requests whose Host header isn't a loopback name. The servers bind 127.0.0.1, but a DNS
 * rebinding page (attacker domain re-pointed at 127.0.0.1) is same-origin to the browser and could
 * otherwise read responses — including /api/trace/intent, which serves local session prompts. A Host
 * check breaks that: the rebound request carries the attacker's hostname.
 */
export async function localOnly(c: Context, next: Next): Promise<Response | void> {
  const host = c.req.header('host');
  // No Host header means a non-browser client (curl, in-process tests). The rebinding attack needs a
  // browser, and browsers always send Host — so only a present-but-foreign Host is rejected.
  if (host !== undefined) {
    const name = host.replace(/:\d+$/, '').toLowerCase();
    if (!LOCAL_HOSTNAMES.has(name)) return c.text('Forbidden', 403);
  }
  await next();
}
