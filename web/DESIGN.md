# Kept web: design brief

The single source of truth for anyone building screens in `web/`. Read it before writing UI.

## The look in one sentence

**Lint Studios' editorial calm with PayPal's confidence.** Inter with tight tracking, white cards on a soft grey canvas, black statement blocks, real photography of real people, numbers set like a bank statement, and PayPal blue as the only accent color.

It must not look "AI-generated": no purple gradients, no glowing blobs, no emoji, no icon in every heading, no centered-everything hero with three identical feature cards. Use asymmetric editorial layouts, generous whitespace, and real content (real numbers from the backend, real example deals).

## Tokens (Tailwind v4 classes, defined in `app/globals.css`)

| Purpose | Class |
|---|---|
| Page background | `bg-canvas` (#f5f5f5) |
| Cards | `bg-surface` (white), `rounded-card` (20px), no border, no shadow (flat like Lint) |
| Statement blocks | `bg-ink text-white` (#0a0a0a) |
| Text | `text-ink` (primary), `text-ink-2` (body), `text-muted` (#7a7a7a, secondary), `text-faint` (#a3a3a3, tertiary / faded statement tails) |
| Lines | `border-line` (#e5e5e5), `border-line-2` (#d4d4d4) |
| Accent | `text-pp` / `bg-pp` (PayPal #0066f5), `text-pp-deep` (#002991), `bg-pp-tint` (8% blue: secondary buttons, info), `text-pp-sky` (#60cdff on dark) |
| States | `ok` / `warn` / `bad` with `-tint` backgrounds (`bg-ok-tint text-ok`) |
| Floating chrome | `glass` (white 74% + blur) and `shadow-float` |
| Small caps labels | `eyebrow` (12px, uppercase, muted) |
| Numbers | `tabular` (tabular figures) on every amount, counter, timer |
| Motion | `animate-rise` (fade + 16px rise), `animate-fade`; respect reduced motion (global rule exists) |

## Typography

- Inter Variable everywhere (`font-sans`), JetBrains Mono for hashes, ids and code (`font-mono`).
- Headings are weight 400-500, never bold, tracking `-0.04em` to `-0.045em` (the base layer already applies `-0.04em` to h1-h5). Body tracking is `-0.018em` (on `body`).
- Display: `text-[clamp(2.5rem,6vw,4.75rem)] leading-[1.02] tracking-[-0.05em]`.
- Section statements: use `<Statement lead=… tail=…/>`: the tail fades to `text-faint` (Lint's signature move; PayPal uses the same fade on stacked lists).
- Labels: `<SectionLabel index="01">How it works</SectionLabel>` renders "(01) · HOW IT WORKS".
- The wordmark is `Kept.` (bold, blue full stop): `<Logo />`.

## Components (import from `@/components/...`)

- `ui/button`: `<Button variant="primary|secondary|ghost|outline|danger|inverse|inverse-ghost|link" size="sm|md|lg" loading icon iconRight href>`. Primary = black pill (PayPal's main CTA), secondary = blue-tint pill. `IconButton` = round arrow button (photo cards).
- `ui/card`: `Card tone="light|dark|sunken|outline|blue"`, `CardHeader eyebrow title action`, `DataRow label value hint` (inside a `<dl>`).
- `ui/chip`: `Chip tone dot live icon`, `StatusChip meta={contractStatus(s)}` (metadata in `lib/status.ts`).
- `ui/field`: `Field label hint error optional>{(p) => <Input {...p} />}</Field>`, `Input`, `Textarea`, `Select`, `Notice tone title`.
- `ui/type`: `SectionLabel`, `Statement`, `PageHeader eyebrow title description actions`, `Stat label value sub`, `Kbd`.
- `ui/copy`: `CopyButton value`, `Hash value mode="short|fingerprint|full"`, `SecretReveal value title` (secrets shown once).
- `ui/time`: `Countdown to`, `RelativeTime at`, `CountdownRing startedAt endsAt`.
- `ui/dialog`: `Dialog open onClose title description footer` (native `<dialog>`).
- `ui/toast`: `const toast = useToast(); toast({ title, body, tone: "ok"|"bad"|"neutral" })`.
- `ui/misc`: `Segmented value onChange options`, `Skeleton`, `EmptyState icon title body action`, `StackedBar total segments`, `Meter value max`.
- `ui/spinner`: `Spinner`, `LiveDot`.
- `brand/logo`: `Logo tagline dark href`. `brand/paypal`: `PayPalButton` (gold, official logo: the only place the funder is sent to PayPal), `PayPalBadge`, `PaymentAssurance`.
- `site/site-nav` + `site/site-footer` for public pages (`<SiteNav overDark />` over a dark hero). `site/app-shell` wraps every signed-in page via `app/(app)/layout.tsx` (don't add it again).
- Icons: `lucide-react`, sized `size-4` (16px) in text, `size-5` in buttons. Use sparingly.

## Layout patterns

- Page container: `mx-auto max-w-6xl px-4 sm:px-5`. Public sections: `py-24 sm:py-32`.
- Bento grids: `grid gap-3 md:grid-cols-6` with cards spanning 2/3/4 columns; mix white, black and photo cards.
- Photo cards: `relative overflow-hidden rounded-card` + `<img>` `object-cover` + `bg-gradient-to-t from-black/75` overlay, white text bottom-left, glass chips top-left (`Chip tone="glass-dark"`), round arrow button bottom-right.
- Numbers lead: show the amount big (`Stat`) and the explanation small beneath.
- Photography: `photo(PHOTOS.x, width)` from `lib/site.ts` (free Unsplash images). Always meaningful `alt` text.

## Data rules (non-negotiable)

1. All data comes from Convex: `useQuery(api.x.y, args)`, `useMutation`, `useAction` with `api` from `@/lib/convex`. Queries are live; never poll.
2. Buttons come from `contract.nextActions` / `canAccept` / `canDecide` flags. Never compute permissions in the UI.
3. Money: use the formatted strings the API returns (`money.*`, `amount`). Only format cents yourself with `money()` from `lib/format.ts` when the API gives none. Expose every number the API gives (fees, holds, timers, bounds): users must see exactly where every cent goes.
4. Errors: `errorMessage(e)` from `lib/errors.ts`, shown with `toast({ tone: "bad" })` or `<Notice tone="bad">`. Rate limits (`RATE_LIMITED`) say when to retry.
5. Loading: `Skeleton` shapes that match the final layout; `undefined` from `useQuery` means loading, `null` means not found.
6. Secrets (API keys, agent tokens, webhook secrets) are shown once with `SecretReveal` and never stored client-side.
7. Microcopy: say promise, hold, release, return. Never IR, clause, capture in consumer screens (technical names go in the proof drawer). Always say who acts next and by when.

## Scam-proofing in the UI

- Never render user-supplied text as HTML. Never put personal data in URLs.
- Every payment entry point shows `PaymentAssurance`: you approve on paypal.com, Kept never sees your card or password.
- Show the terms fingerprint (`Hash mode="fingerprint"` of `termsHash`) wherever people approve, so both sides can compare it out loud.
- Red-flag checks on invites (off-platform payment requests, urgency, overpayment, gift cards or crypto) are shown before anyone signs up or approves.
- `PhishingGuard` warns on any host other than `NEXT_PUBLIC_OFFICIAL_HOST`. Internal redirects accept only same-site paths.
- Receipts are verifiable in the browser against the public keys (`site.keysUrl`) with `verifyChain` from `@kept/core`.
