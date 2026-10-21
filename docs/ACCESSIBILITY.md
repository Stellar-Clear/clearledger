# Accessibility statement

This statement covers the ClearLedger web interface in [`apps/web`](../apps/web)
on Stellar Testnet. It records what the repository currently tests, what is
known to be incomplete, and how to report an accessibility problem.

ClearLedger is an experimental testnet prototype. This statement is not a
formal WCAG conformance claim, an audit certificate, or a guarantee that the
interface works with every assistive-technology combination.

## Scope

In scope:

- the Next.js interface in [`apps/web`](../apps/web), including shared
  components in [`apps/web/components`](../apps/web/components) and route
  handlers in [`apps/web/app`](../apps/web/app);
- keyboard operation of in-app dialogs, forms, navigation and the invoice
  table;
- automated accessibility checks that ship with the repository.

Out of scope:

- the Freighter browser extension and its own connection/signing dialogs;
- Stellar Horizon, Soroban RPC and on-chain contract behavior;
- the Go indexer/API, SDK and CLI packages;
- the separate smart-contract repository.

## Tested browsers and assistive technologies

The repository does not currently record manual screen-reader testing. Do not
assume support for a named screen reader, operating system or browser based on
this statement.

What is exercised automatically:

| Coverage | Environment | What it proves |
| --- | --- | --- |
| Component and route tests | Vitest with jsdom, configured in [`apps/web/vitest.config.ts`](../apps/web/vitest.config.ts) | Accessible names, roles, ARIA state, label association and keyboard handlers. jsdom is not a screen reader and does not prove real assistive-technology behavior. |
| End-to-end browser tests | Playwright with Desktop Chrome/Chromium, configured in [`apps/web/playwright.config.ts`](../apps/web/playwright.config.ts) | Main flows in one desktop Chromium build, including opening dialogs, selecting dates and pressing Escape in the onboarding tour. |
| Automated accessibility rules | `vitest-axe` in [`apps/web/vitest.setup.ts`](../apps/web/vitest.setup.ts) | Scoped axe-core rule checks, currently on the Marketplace route and `AmountInput`. Axe cannot detect every accessibility problem. |

As a result:

- **Tested browser:** desktop Chromium through Playwright. Unit tests use
  jsdom, not a browser.
- **Not verified:** Firefox, Safari, mobile browsers, and screen readers such as
  NVDA, JAWS, VoiceOver or TalkBack.
- **Language:** only the English interface is configured and tested. The root
  layout passes the `en` messages from
  [`apps/web/messages/en.json`](../apps/web/messages/en.json) and sets
  `locale="en"` in [`apps/web/app/layout.tsx`](../apps/web/app/layout.tsx).

## Tested keyboard flows

### Navigation and controls

- The root layout provides a "Skip to main content" link that becomes visible
  on focus and targets `#main-content`
  ([`apps/web/app/layout.tsx`](../apps/web/app/layout.tsx)).
- The navbar uses native links, a native role `<select>`, and a mobile menu
  button with `aria-expanded` and changing accessible names. Tests cover role
  selection, translated labels and the mobile menu label/state
  ([`apps/web/components/shared/Navbar.tsx`](../apps/web/components/shared/Navbar.tsx),
  [`apps/web/components/shared/Navbar.test.tsx`](../apps/web/components/shared/Navbar.test.tsx)).
- The theme toggle exposes a descriptive name and `aria-pressed`
  ([`apps/web/components/shared/ThemeToggle.tsx`](../apps/web/components/shared/ThemeToggle.tsx),
  [`apps/web/components/shared/ThemeToggle.test.tsx`](../apps/web/components/shared/ThemeToggle.test.tsx)).
- The network activity ticker is exposed as a polite status region, with a
  pause/play button, duplicated visual content hidden from assistive
  technology, and reduced-motion handling
  ([`apps/web/components/shared/TopStatusBar.tsx`](../apps/web/components/shared/TopStatusBar.tsx),
  [`apps/web/components/shared/TopStatusBar.test.tsx`](../apps/web/components/shared/TopStatusBar.test.tsx)).

The navbar does not have a dedicated tab-order test. Link and control order
relies on the document order shown in the component.

### Wallet connection controls

- `WalletConnect` renders native buttons with accessible names for connecting,
  copying the address and disconnecting, plus status text for connecting,
  connected, rejected and unsupported-network states
  ([`apps/web/components/shared/WalletConnect.tsx`](../apps/web/components/shared/WalletConnect.tsx),
  [`apps/web/components/shared/WalletConnect.test.tsx`](../apps/web/components/shared/WalletConnect.test.tsx)).
- Network switching is tested as a normal button flow, including disabled and
  re-enabled states while a switch is pending. Keyboard operation comes from
  the native `<button>` element; the tests assert names and states rather than
  dispatching keyboard events.
- The Freighter extension's own approval dialog is outside the application and
  outside this statement. Its keyboard behavior is controlled by Freighter.

### Invoice table and selection

- The invoice ledger uses a roving `tabindex`: only one interactive data row is
  in the tab order at a time
  ([`apps/web/components/invoice/InvoiceTable.tsx`](../apps/web/components/invoice/InvoiceTable.tsx)).
- Tests cover `ArrowDown` to move to the next row, `Enter` to select the focused
  row, and `Space` for the same selection behavior. They also verify that row
  checkboxes stay in the tab order, toggle on Space without also triggering the
  row handler, and expose selected rows with `aria-selected`
  ([`apps/web/components/invoice/InvoiceTable.test.tsx`](../apps/web/components/invoice/InvoiceTable.test.tsx)).
- The table implementation also handles `ArrowUp`, `Home` and `End`
  ([`apps/web/components/invoice/InvoiceTable.tsx`](../apps/web/components/invoice/InvoiceTable.tsx)).

### Dialogs, focus trapping and Escape

- The shared `useFocusTrap` hook moves focus into a dialog, cycles `Tab` and
  `Shift+Tab` inside it, closes on `Escape`, stops Escape propagation, and
  restores focus to the previously focused element
  ([`apps/web/hooks/useFocusTrap.ts`](../apps/web/hooks/useFocusTrap.ts),
  [`apps/web/hooks/useFocusTrap.test.ts`](../apps/web/hooks/useFocusTrap.test.ts)).
- The profile registration dialog is tested end to end at the component level
  for `aria-modal`, initial focus, forward and backward Tab cycling, Escape
  dismissal, and focus restoration to the trigger button
  ([`apps/web/app/profile/page.tsx`](../apps/web/app/profile/page.tsx),
  [`apps/web/app/profile/page.test.tsx`](../apps/web/app/profile/page.test.tsx)).
- The transaction pending dialog exposes `role="dialog"`, `aria-modal` and an
  accessible name. Escape and backdrop dismissal are intentionally blocked
  until a transaction hash exists, then allowed; a close button is rendered
  when `onClose` is supplied
  ([`apps/web/components/shared/TransactionPending.tsx`](../apps/web/components/shared/TransactionPending.tsx),
  [`apps/web/components/shared/TransactionPending.test.tsx`](../apps/web/components/shared/TransactionPending.test.tsx),
  [`apps/web/regression/audit-001-transaction-modal-dismiss.test.tsx`](../apps/web/regression/audit-001-transaction-modal-dismiss.test.tsx),
  [`apps/web/regression/audit-008-focus-trap.test.tsx`](../apps/web/regression/audit-008-focus-trap.test.tsx)).
- The confirmation dialog uses the same focus trap and exposes an accessible
  title and close button. Its tests cover confirm, cancel, close and backdrop
  dismissal, but mock the focus-trap hook
  ([`apps/web/components/shared/ConfirmationDialog.tsx`](../apps/web/components/shared/ConfirmationDialog.tsx),
  [`apps/web/components/shared/ConfirmationDialog.test.tsx`](../apps/web/components/shared/ConfirmationDialog.test.tsx)).
- The onboarding tour traps Tab focus, moves focus to each step heading,
  supports `ArrowLeft`/`ArrowRight` navigation, dismisses on Escape, and
  restores focus to its launcher. Playwright also checks Escape in desktop
  Chromium
  ([`apps/web/components/shared/OnboardingTour.tsx`](../apps/web/components/shared/OnboardingTour.tsx),
  [`apps/web/components/shared/OnboardingTour.test.tsx`](../apps/web/components/shared/OnboardingTour.test.tsx),
  [`apps/web/e2e/onboarding-tour.spec.ts`](../apps/web/e2e/onboarding-tour.spec.ts)).
- The invoice comparison modal uses the shared focus trap and closes on Escape,
  but does not have a dedicated keyboard test
  ([`apps/web/components/invoice/InvoiceCompareModal.tsx`](../apps/web/components/invoice/InvoiceCompareModal.tsx)).

### Forms

- Form controls are native inputs and buttons with visible labels. `AmountInput`
  is covered by axe checks and tests that each label's `htmlFor` matches the
  input `id`, including multiple instances on one page
  ([`apps/web/components/shared/AmountInput.tsx`](../apps/web/components/shared/AmountInput.tsx),
  [`apps/web/components/shared/AmountInput.test.tsx`](../apps/web/components/shared/AmountInput.test.tsx)).
- Marketplace minimum and maximum value filters are tested for label/input
  association and scoped axe rules
  ([`apps/web/app/marketplace/page.label.test.tsx`](../apps/web/app/marketplace/page.label.test.tsx)).
- Invoice creation tests cover the visible labels, the review step and
  validation errors for the buyer address and due-date limits. These tests use
  native input changes and button clicks rather than a full keyboard-only
  submission run
  ([`apps/web/components/invoice/InvoiceForm.tsx`](../apps/web/components/invoice/InvoiceForm.tsx),
  [`apps/web/components/invoice/InvoiceForm.test.tsx`](../apps/web/components/invoice/InvoiceForm.test.tsx)).
- The date picker is built on Radix UI Popover and `react-day-picker`. The
  end-to-end flow opens the picker and selects a day
  ([`apps/web/components/ui/date-picker.tsx`](../apps/web/components/ui/date-picker.tsx),
  [`apps/web/e2e/sme-issuer-flow.spec.ts`](../apps/web/e2e/sme-issuer-flow.spec.ts)).
  Unit tests cover date formatting and timezone behavior, not calendar
  arrow-key navigation.

### Charts, status and reduced motion

- The pool performance chart exposes a text summary to assistive technology and
  labels the chart region, with tests for the summary and accessible name
  ([`apps/web/components/shared/PoolPerformanceChart.tsx`](../apps/web/components/shared/PoolPerformanceChart.tsx),
  [`apps/web/components/shared/PoolPerformanceChart.test.tsx`](../apps/web/components/shared/PoolPerformanceChart.test.tsx)).
- Invoice status and verification badges expose status roles and accessible
  labels ([`apps/web/components/invoice/InvoiceStatus.tsx`](../apps/web/components/invoice/InvoiceStatus.tsx),
  [`apps/web/components/invoice/VerificationBadge.tsx`](../apps/web/components/invoice/VerificationBadge.tsx)).
- `prefers-reduced-motion` is handled by the transaction pending dialog, the
  invoice status timeline and the status ticker. Automated reduced-motion tests
  cover the first two
  ([`apps/web/components/shared/TransactionPending.reducedMotion.test.tsx`](../apps/web/components/shared/TransactionPending.reducedMotion.test.tsx),
  [`apps/web/components/invoice/InvoiceStatusTimeline.reducedMotion.test.tsx`](../apps/web/components/invoice/InvoiceStatusTimeline.reducedMotion.test.tsx)).

## Known limitations

1. **No manual assistive-technology testing has been recorded.** There is no
   verified support statement for NVDA, JAWS, VoiceOver, TalkBack, Dragon or
   other tools.
2. **Only desktop Chromium is exercised end to end.** Firefox, Safari, mobile
   browsers and browser zoom/reflow combinations are unverified.
3. **The interface is English-only.** Only the `en` locale is configured, and
   no right-to-left or translated-layout testing exists.
4. **Automated accessibility coverage is partial.** Route-level axe checks are
   limited to the Marketplace discount slider and filter labels; component
   checks cover `AmountInput`. Axe cannot detect all barriers, and the full
   application is not scanned on every route.
5. **The date picker's keyboard behavior is not directly tested.** Calendar
   navigation depends on Radix UI Popover and `react-day-picker`; repository
   tests cover opening, selecting and date formatting rather than arrow-key
   movement between days or months.
6. **Some dialogs are covered indirectly.** The confirmation dialog mocks the
   focus-trap hook in its unit tests, and the invoice comparison modal has no
   dedicated keyboard test. Both rely on the shared `useFocusTrap` behavior
   tested separately.
7. **The comparison chart summary is not a data table.** The chart exposes a
   text summary and accessible name, but there is no per-point table
   alternative.
8. **Virtualized rows and large lists are only tested with small fixtures.**
   Keyboard navigation is implemented for the table, but very large result sets
   have not been manually tested with a screen reader.
9. **Reduced-motion coverage is not exhaustive.** Two animated components have
   dedicated tests, and the ticker uses reduced-motion classes, but every
   animation in the application has not been audited.

## Feedback and reporting

Use the existing public issue tracker:

- **Report an accessibility issue:**
  <https://github.com/Stellar-Clear/clearledger/issues>
- **Contribution and issue guidance:**
  [`docs/contributing/how-to-contribute.md`](contributing/how-to-contribute.md)

Please include:

- the route or URL and the task you were attempting;
- browser, operating system and assistive-technology versions;
- the keyboard or assistive-technology steps that failed;
- what you expected and what happened instead.

Do not include wallet secret keys, recovery phrases or other sensitive data in
an issue. For security vulnerabilities, use the private reporting process in
[`SECURITY.md`](../SECURITY.md) instead of a public issue.

## Testnet notice

ClearLedger is deployed for evaluation on Stellar Testnet only. There is no
Mainnet deployment and no Mainnet accessibility or availability guarantee.
Testnet behavior, data and interfaces may change without notice. Do not use real
funds or submit real confidential business information.

See the [documentation index](README.md) and the [project README](../README.md)
for the broader testnet and security context.
