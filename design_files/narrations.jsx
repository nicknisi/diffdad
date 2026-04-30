/* AI narration text per chapter, at three densities */
const Narrations = {
  ch1: {
    terse: 'Adds <code>discoveryMode</code> to the connection model and makes the OIDC URLs optional.',
    normal:
      "Before any UI or network code, the connection schema gets a new <b>discoveryMode</b> field that records whether endpoints came from a paste or from a fetch. Authorization, token, and JWKS URLs become <em>optional</em> on <code>OidcConfig</code> — they'll be filled in by discovery later. A new <code>EntraOIDC</code> connection type is added alongside the existing <code>MicrosoftOIDC</code>.",
    verbose:
      "Before any UI or network code, the connection schema gains the foundation everything else hangs off of: a new <b>discoveryMode</b> field that records whether endpoints came from a paste or from a fetch. This lets the rest of the codebase ask a connection <em>'do we have the metadata, or do we need to fetch it?'</em> without re-parsing URLs each time. Authorization, token, and JWKS URLs are demoted from required to optional on <code>OidcConfig</code> — they will be populated either by manual entry or by discovery, and the type now reflects both possibilities. A new <code>EntraOIDC</code> connection type is added alongside the existing <code>MicrosoftOIDC</code>; the two share most behavior but discovery is enabled only for the new one until we backfill existing tenants.",
  },
  ch2: {
    terse: 'New <code>discover()</code> fetches and validates a well-known doc.',
    normal:
      "Now we actually go get it. A small, focused fetcher takes an issuer URL, normalizes it, hits <code>/.well-known/openid-configuration</code>, and validates the response with Zod. We deliberately don't cache here — that's the next chapter's job — so this stays trivially testable. A typed <code>DiscoveryError</code> wraps the three failure modes the caller cares about: unreachable, malformed, and TLS failure.",
    verbose:
      "Now we actually go get it. A small, focused fetcher takes an issuer URL, strips trailing slashes, hits <code>/.well-known/openid-configuration</code> with a 5-second timeout, and validates the response with a Zod schema that captures only the fields we use. We deliberately don't cache here — that's the next chapter's job — so this module stays a pure async function and is trivially testable. The schema is intentionally narrower than the spec: <em>we ignore everything we don't consume</em>. A typed <code>DiscoveryError</code> wraps the three failure modes the caller actually needs to disambiguate: <code>issuer_unreachable</code>, <code>malformed_document</code>, and <code>tls_failure</code> — each carrying enough metadata that a customer-facing humanizer can produce a useful message.",
  },
  ch3: {
    terse: 'Caches discovery docs with a 1h fresh / 24h stale TTL.',
    normal:
      'Discovery documents are stable but not immutable — Microsoft has rotated signing keys mid-quarter before. We cache by issuer URL with a 1-hour <em>fresh</em> TTL and a 24-hour <em>stale</em> ceiling. If the issuer is unreachable on a refresh, we serve the stale doc rather than break logins. The cache is process-local and bounded at 5,000 entries.',
    verbose:
      "Discovery documents are stable but not immutable — Microsoft has rotated signing keys mid-quarter before, and the spec explicitly allows providers to update their well-known doc at any time. The cache layer enforces two clocks: a <b>1-hour fresh window</b> within which we always serve from cache without touching the network, and a <b>24-hour stale ceiling</b> beyond which entries are evicted entirely. Between those, we revalidate on read but fall back to the cached value if revalidation fails — classic stale-while-revalidate, so an outage at the issuer doesn't take down sign-ins for affected tenants. The cache is process-local and bounded at 5,000 entries; in production we run multiple instances behind a load balancer so cold caches are common, which is fine because the upstream call is cheap.",
  },
  ch4: {
    terse: 'The Admin Portal form calls <code>discover()</code> on issuer blur and pre-fills the rest.',
    normal:
      "The actual user-visible change. When an admin selects <em>Microsoft Entra ID</em> and pastes their tenant's issuer URL, we call <code>api.sso.discover()</code> on blur and pre-populate authorization, token, and JWKS URLs from the response. They can still override anything — discovery is a starting point, not a constraint. A spinner shows in the field's trailing slot while we fetch; errors are humanized inline.",
    verbose:
      "The actual user-visible change. When an admin selects <em>Microsoft Entra ID</em> in the Admin Portal and pastes their tenant's issuer URL, we hook into the Issuer URL field's blur event and call <code>api.sso.discover()</code>. The response pre-populates authorization, token, and JWKS URLs in the draft state, but those fields remain editable — discovery is a starting point, not a constraint, and admins with non-standard tenant configs can still override anything. While the request is in flight, a small spinner appears in the field's trailing slot to make the work visible without blocking the form. Failure modes get humanized error copy beneath the field, mapping the typed <code>DiscoveryError</code> codes from chapter 2 into language an admin can act on. We also added a <code>isLikelyIssuerUrl()</code> guard so we don't fire discovery on every keystroke as the user types.",
  },
  ch5: {
    terse: 'Tests for happy path, malformed responses, and SWR. Adds a duration histogram metric.',
    normal:
      'Three new test files exercise the happy path, malformed responses, and the stale-while-revalidate branch. We also wire a <code>sso.discovery.duration_ms</code> histogram so we can see in production whether the 5-second timeout is the right call.',
    verbose:
      'Three new test files. <code>discovery.test.ts</code> uses the existing <code>mockHttp</code> harness to exercise the happy path and the two error branches in isolation. <code>discovery-cache.test.ts</code> covers the fresh / stale / SWR matrix using fake timers. <code>SetupFormOIDC.test.tsx</code> uses Testing Library to verify the form pre-fills correctly after a successful discovery and surfaces a humanized error otherwise. On the telemetry side, we wire a <code>sso.discovery.duration_ms</code> histogram with tags for <code>issuer_host</code> and <code>cache_state</code> so we can see in production whether the 5-second timeout is the right call and whether SWR is firing more often than expected.',
  },
};

window.Narrations = Narrations;
