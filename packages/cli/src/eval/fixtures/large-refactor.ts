import { fileURLToPath } from 'url';
import type { DiffFile, DiffHunk, DiffLine } from '../../github/types';
import type { EvalFixture } from '../types';

/**
 * The shape that motivated the whole triage project: a 43-file PR where three files decide whether the
 * change is correct and forty are a mechanical rename the reviewer has to scroll past to reach them.
 *
 * Three hotspots, deliberately protected by three different signals so a lucky selection cannot pass:
 *
 * - `src/billing/invoice-calculator.ts` — a return-type change whose callers are all outside this PR.
 *   Carries criticality keywords (`billing`, `invoice`).
 * - `db/migrations/0117_add_currency_to_invoices.sql` — a backfill with no rollback. Criticality again
 *   (`migration`, `.sql`), and nothing else in the diff resembles it.
 * - `src/http/retry-policy.ts` — a behavioral change with no criticality keyword anywhere in its path
 *   and an adjacent test in the same PR, so neither of the other two signals fires. Only its unchanged
 *   callers keep it open. This is the one that fails if `callersOf`'s exclude set is wrong.
 *
 * The mechanical tail is a `formatMoney` -> `formatCurrency` rename across thirty leaf presentation
 * components plus the twelve-line test churn that follows it. It is deliberately *not* built from
 * `dist/`-style paths: `partitionMechanicalFiles` drops those before the planner runs, so a real
 * narrative would contain no chapters for them at all and the compression measurement would be a
 * measurement of nothing.
 */

type Marker = '+' | '-' | ' ';

/**
 * One-hunk `DiffFile` from unified-diff marker lines, with old/new line numbers walked out the way the
 * real parser produces them.
 *
 * The other fixtures spell every `DiffLine` literally, which costs about 65 lines of source per diff
 * file. At 43 files that is two thousand lines of near-identical object literals, and a fixture nobody
 * will read is a fixture nobody will notice is wrong. The hotspots below are still written out line by
 * line — their content is the part that carries meaning — and only the repetitive tail is generated.
 */
function oneHunkFile(path: string, markers: [Marker, string][], opts: { new?: boolean; deleted?: boolean } = {}) {
  const lines: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  for (const [marker, content] of markers) {
    if (marker === '+') {
      newLine++;
      lines.push({ type: 'add', content, lineNumber: { new: newLine } });
    } else if (marker === '-') {
      oldLine++;
      lines.push({ type: 'remove', content, lineNumber: { old: oldLine } });
    } else {
      oldLine++;
      newLine++;
      lines.push({ type: 'context', content, lineNumber: { old: oldLine, new: newLine } });
    }
  }
  const oldStart = opts.new ? 0 : 1;
  const newStart = opts.deleted ? 0 : 1;
  const hunk: DiffHunk = {
    header: `@@ -${oldStart},${oldLine} +${newStart},${newLine} @@`,
    oldStart,
    oldCount: oldLine,
    newStart,
    newCount: newLine,
    lines,
  };
  return {
    file: path,
    isNewFile: opts.new === true,
    isDeleted: opts.deleted === true,
    hunks: [hunk],
  } satisfies DiffFile;
}

const invoiceCalculator = oneHunkFile('src/billing/invoice-calculator.ts', [
  [' ', "import { taxFor } from './tax-rules';"],
  ['-', "import { formatMoney } from '../format/money';"],
  ['+', "import { formatCurrency } from '../format/currency';"],
  [' ', ''],
  ['-', 'export type InvoiceTotal = {'],
  ['-', '  subtotal: number;'],
  ['-', '  tax: number;'],
  ['-', '  total: number;'],
  ['-', '};'],
  ['+', '/**'],
  ['+', ' * Money amounts are minor units plus an explicit ISO-4217 code as of this change. The bare'],
  ['+', ' * `number` fields are gone, so every caller that read `.total` now reads `.total.amount`.'],
  ['+', ' */'],
  ['+', 'export type Money = { amount: number; currency: string };'],
  ['+', ''],
  ['+', 'export type InvoiceTotal = {'],
  ['+', '  subtotal: Money;'],
  ['+', '  tax: Money;'],
  ['+', '  total: Money;'],
  ['+', '  display: string;'],
  ['+', '};'],
  [' ', ''],
  ['-', 'export function calculateInvoice(lines: LineItem[]): InvoiceTotal {'],
  ['+', 'export function calculateInvoice(lines: LineItem[], currency = "USD"): InvoiceTotal {'],
  [' ', '  const subtotal = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);'],
  ['-', '  const tax = taxFor(subtotal);'],
  ['-', '  return { subtotal, tax, total: subtotal + tax };'],
  ['+', '  const tax = taxFor(subtotal, currency);'],
  ['+', '  const total = subtotal + tax;'],
  ['+', '  return {'],
  ['+', '    subtotal: { amount: subtotal, currency },'],
  ['+', '    tax: { amount: tax, currency },'],
  ['+', '    total: { amount: total, currency },'],
  ['+', '    display: formatCurrency(total, currency),'],
  ['+', '  };'],
  [' ', '}'],
  [' ', ''],
  ['-', 'export function invoiceIsSettled(total: InvoiceTotal, paid: number): boolean {'],
  ['-', '  return paid >= total.total;'],
  ['+', 'export function invoiceIsSettled(total: InvoiceTotal, paid: Money): boolean {'],
  ['+', '  // Currency is not compared here. A payment in a different currency settles the invoice.'],
  ['+', '  return paid.amount >= total.total.amount;'],
  [' ', '}'],
  [' ', ''],
  [' ', 'export function emptyInvoice(): InvoiceTotal {'],
  ['-', '  return { subtotal: 0, tax: 0, total: 0 };'],
  ['+', '  return emptyTotal("USD");'],
  [' ', '}'],
]);

const taxRules = oneHunkFile('src/billing/tax-rules.ts', [
  [' ', "import { rateTable } from './rate-table';"],
  [' ', ''],
  ['-', 'export function taxFor(subtotal: number): number {'],
  ['-', '  return Math.round(subtotal * rateTable.default);'],
  ['+', 'export function taxFor(subtotal: number, currency: string): number {'],
  ['+', '  const rate = rateTable.byCurrency[currency] ?? rateTable.default;'],
  ['+', '  return Math.round(subtotal * rate);'],
  [' ', '}'],
  [' ', ''],
  [' ', 'export function taxIsExempt(region: string): boolean {'],
  [' ', '  return EXEMPT_REGIONS.has(region);'],
  [' ', '}'],
  [' ', ''],
  ['+', 'export function emptyTotal(currency: string) {'],
  ['+', '  const zero = { amount: 0, currency };'],
  ['+', '  return { subtotal: zero, tax: zero, total: zero, display: "" };'],
  ['+', '}'],
  ['+', ''],
  [' ', 'const EXEMPT_REGIONS = new Set(["US-OR", "US-NH"]);'],
  [' ', ''],
  [' ', 'export const DEFAULT_CURRENCY = "USD";'],
]);

const currencyMigration = oneHunkFile(
  'db/migrations/0117_add_currency_to_invoices.sql',
  [
    ['+', '-- Store an explicit currency on every invoice line.'],
    ['+', 'ALTER TABLE invoices'],
    ['+', "  ADD COLUMN currency CHAR(3) NOT NULL DEFAULT 'USD';"],
    ['+', ''],
    ['+', 'ALTER TABLE invoice_lines'],
    ['+', "  ADD COLUMN currency CHAR(3) NOT NULL DEFAULT 'USD';"],
    ['+', ''],
    ['+', '-- Backfill historical rows from the owning account so the default never leaks into'],
    ['+', '-- reporting for non-US accounts.'],
    ['+', 'UPDATE invoices i'],
    ['+', '  SET currency = a.billing_currency'],
    ['+', '  FROM accounts a'],
    ['+', '  WHERE a.id = i.account_id;'],
    ['+', ''],
    ['+', 'UPDATE invoice_lines l'],
    ['+', '  SET currency = i.currency'],
    ['+', '  FROM invoices i'],
    ['+', '  WHERE i.id = l.invoice_id;'],
    ['+', ''],
    ['+', 'ALTER TABLE invoices'],
    ['+', '  ALTER COLUMN currency DROP DEFAULT;'],
    ['+', ''],
    ['+', 'ALTER TABLE invoice_lines'],
    ['+', '  ALTER COLUMN currency DROP DEFAULT;'],
  ],
  { new: true },
);

const retryPolicy = oneHunkFile('src/http/retry-policy.ts', [
  [' ', "import { sleep } from './sleep';"],
  [' ', ''],
  ['-', 'const MAX_ATTEMPTS = 3;'],
  ['+', 'const MAX_ATTEMPTS = 6;'],
  [' ', 'const BASE_DELAY_MS = 100;'],
  [' ', ''],
  ['-', 'export function shouldRetry(status: number): boolean {'],
  ['-', '  return status >= 500;'],
  ['+', 'export function shouldRetry(status: number, method: string): boolean {'],
  ['+', '  if (status === 429) return true;'],
  ['+', '  if (status < 500) return false;'],
  ['+', '  // Non-idempotent verbs are now retried too, which is the behavioral change in this PR.'],
  ['+', '  return true;'],
  [' ', '}'],
  [' ', ''],
  [' ', 'export async function withRetry<T>(fn: () => Promise<Response>, opts: RetryOpts = {}): Promise<T> {'],
  [' ', '  let attempt = 0;'],
  [' ', '  for (;;) {'],
  [' ', '    const res = await fn();'],
  ['-', '    if (res.ok || !shouldRetry(res.status)) return res.json() as Promise<T>;'],
  ['+', "    if (res.ok || !shouldRetry(res.status, opts.method ?? 'GET')) return res.json() as Promise<T>;"],
  [' ', '    attempt++;'],
  [' ', '    if (attempt >= MAX_ATTEMPTS) throw new Error(`giving up after ${attempt} attempts`);'],
  ['-', '    await sleep(BASE_DELAY_MS * attempt);'],
  ['+', '    // Exponential rather than linear, so six attempts is 6.3s of backoff, not 2.1s.'],
  ['+', '    await sleep(BASE_DELAY_MS * 2 ** attempt);'],
  [' ', '  }'],
  [' ', '}'],
  [' ', ''],
  [' ', 'export type RetryOpts = {'],
  ['+', '  method?: string;'],
  [' ', '  signal?: AbortSignal;'],
  [' ', '};'],
  [' ', ''],
  [' ', 'export const retryDefaults = {'],
  [' ', '  maxAttempts: MAX_ATTEMPTS,'],
  [' ', '  baseDelayMs: BASE_DELAY_MS,'],
  [' ', '};'],
]);

const retryPolicyTest = oneHunkFile('src/http/__tests__/retry-policy.test.ts', [
  [' ', "import { describe, expect, it } from 'vitest';"],
  [' ', "import { shouldRetry, withRetry } from '../retry-policy';"],
  [' ', ''],
  [' ', "describe('shouldRetry', () => {"],
  ['-', "  it('retries 5xx', () => {"],
  ['-', '    expect(shouldRetry(503)).toBe(true);'],
  ['+', "  it('retries 5xx for any method', () => {"],
  ['+', "    expect(shouldRetry(503, 'POST')).toBe(true);"],
  [' ', '  });'],
  [' ', ''],
  ['+', "  it('retries 429', () => {"],
  ['+', "    expect(shouldRetry(429, 'GET')).toBe(true);"],
  ['+', '  });'],
  ['+', ''],
  [' ', "  it('does not retry 4xx', () => {"],
  ['-', '    expect(shouldRetry(404)).toBe(false);'],
  ['+', "    expect(shouldRetry(404, 'GET')).toBe(false);"],
  [' ', '  });'],
  [' ', '});'],
  [' ', ''],
  [' ', "describe('withRetry', () => {"],
  [' ', "  it('resolves on the first success', async () => {"],
  [' ', '    const res = await withRetry(() => Promise.resolve(okResponse()));'],
  [' ', '    expect(res).toEqual({ ok: true });'],
  [' ', '  });'],
  [' ', '});'],
]);

/**
 * The rename itself, in a leaf presentation component: one import line and one call site. Nothing here
 * changes behavior, nothing here is imported by anything else, and there are thirty of them.
 */
function renamedComponent(name: string): DiffFile {
  return oneHunkFile(`src/components/${name}.tsx`, [
    ['-', "import { formatMoney } from '../format/money';"],
    ['+', "import { formatCurrency } from '../format/currency';"],
    [' ', ''],
    [' ', `export function ${name}({ total }: { total: Money }) {`],
    [' ', '  return ('],
    [' ', '    <span className="amount">'],
    ['-', '      {formatMoney(total.amount)}'],
    ['+', '      {formatCurrency(total.amount, total.currency)}'],
    [' ', '    </span>'],
    [' ', '  );'],
    [' ', '}'],
  ]);
}

/** Test churn following the rename: same two edits, in the component's own spec file. */
function renamedComponentTest(name: string): DiffFile {
  return oneHunkFile(`src/components/__tests__/${name}.test.tsx`, [
    [' ', "import { render } from '@testing-library/react';"],
    [' ', "import { describe, expect, it } from 'vitest';"],
    [' ', `import { ${name} } from '../${name}';`],
    ['-', "import { formatMoney } from '../../format/money';"],
    ['+', "import { formatCurrency } from '../../format/currency';"],
    [' ', ''],
    [' ', `describe('${name}', () => {`],
    [' ', "  it('renders the formatted amount', () => {"],
    ['-', `    const { container } = render(<${name} total={{ amount: 1250 }} />);`],
    ['+', `    const { container } = render(<${name} total={{ amount: 1250, currency: "USD" }} />);`],
    [' ', '    expect(container.textContent).toContain(formatCurrency(1250, "USD"));'],
    [' ', '  });'],
    [' ', ''],
    [' ', "  it('renders nothing for a zero total', () => {"],
    [' ', `    const { container } = render(<${name} total={{ amount: 0, currency: "USD" }} />);`],
    [' ', "    expect(container.textContent).toBe('');"],
    [' ', '  });'],
    [' ', '});'],
  ]);
}

/**
 * Thirty leaf components. Basenames are unique on purpose: `callersOf` buckets by basename, so a
 * repeated `index.tsx` would share one caller entry with everything else named `index` and the
 * caller-free evidence would move for reasons that have nothing to do with this PR. None of the names
 * contain a criticality keyword either (no `payment`, `token`, `session`, `config`, ...), because a
 * mechanical file that trips the criticality veto stops being mechanical.
 */
const RENAMED_COMPONENTS = [
  'OrderRow',
  'CartSummary',
  'PriceTag',
  'LineItemList',
  'TotalsPanel',
  'CurrencyBadge',
  'RefundNotice',
  'ShippingRow',
  'DiscountChip',
  'SubtotalLine',
  'TaxLine',
  'GrandTotal',
  'ReceiptHeader',
  'ReceiptFooter',
  'ItemThumbnail',
  'QuantityStepper',
  'PromoBanner',
  'CheckoutButton',
  'MiniCart',
  'CartDrawer',
  'OrderTimeline',
  'StatusPill',
  'AddressCard',
  'DeliveryEstimate',
  'MethodRow',
  'CouponField',
  'GiftNote',
  'WarrantyBadge',
  'ReturnWindow',
  'PrintLink',
];

/** The eight components whose spec files needed the same two edits. */
const CHURNED_COMPONENT_TESTS = [
  'OrderRow',
  'CartSummary',
  'PriceTag',
  'TotalsPanel',
  'GrandTotal',
  'ReceiptHeader',
  'MiniCart',
  'StatusPill',
];

const files: DiffFile[] = [
  invoiceCalculator,
  taxRules,
  currencyMigration,
  retryPolicy,
  retryPolicyTest,
  ...RENAMED_COMPONENTS.map(renamedComponent),
  ...CHURNED_COMPONENT_TESTS.map(renamedComponentTest),
];

export const fixture: EvalFixture = {
  id: 'large-refactor',
  description: 'Multi-currency invoice change buried under a 38-file formatMoney -> formatCurrency rename',
  pr: {
    number: 903,
    title: 'Multi-currency invoices',
    body: 'Invoice totals now carry an explicit ISO-4217 currency instead of a bare number. Adds the column and backfills it, changes the calculator return shape, and renames formatMoney to formatCurrency everywhere it is called. Retry policy is unrelated but was blocking CI on the flaky payments provider, so it rides along.',
    state: 'open',
    draft: false,
    author: { login: 'rey', avatarUrl: '' },
    branch: 'multi-currency-invoices',
    base: 'main',
    labels: ['refactor', 'billing'],
    createdAt: '2026-05-04T09:00:00Z',
    updatedAt: '2026-05-04T09:00:00Z',
    additions: 214,
    deletions: 96,
    changedFiles: files.length,
    commits: 9,
    headSha: '0000000000000000000000000000000000000903',
  },
  files,
  recordedNarrativePath: fileURLToPath(new URL('./recorded/large-refactor.narrative.json', import.meta.url)),
  groundTruth: {
    expectedConcerns: [
      'calculateInvoice changes InvoiceTotal from bare numbers to { amount, currency } objects, and every caller outside this PR that reads total.total as a number keeps typechecking against the old shape only if it was untyped — the unchanged callers are the blast radius',
      'invoiceIsSettled compares paid.amount to total.total.amount without comparing currency, so a payment in a different currency settles the invoice',
      'The migration backfills invoices from accounts.billing_currency in a single UPDATE with no batching and provides no rollback for the two ADD COLUMN statements',
      'shouldRetry now retries any 5xx regardless of HTTP method, so non-idempotent POSTs can be replayed up to six times',
      'MAX_ATTEMPTS went from 3 to 6 and the backoff went from linear to exponential at the same time, multiplying worst-case latency by roughly 3x',
      'No test covers the new Money shape returned by calculateInvoice, only the retry policy gained tests',
    ],
    expectedHotspots: [
      'src/billing/invoice-calculator.ts',
      'db/migrations/0117_add_currency_to_invoices.sql',
      'src/http/retry-policy.ts',
    ],
    expectedMissing: [
      'rollback for the currency columns',
      'batched backfill',
      'currency comparison in invoiceIsSettled',
      'tests for the new InvoiceTotal shape',
    ],
    shouldNotBeSafe: true,
  },
};
