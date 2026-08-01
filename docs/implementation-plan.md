# Implementation Plan: Fragile Poker (Planning Poker Web App)

This plan turns `docs/product-description.md` into a concrete, buildable design on top of the
existing TanStack Start (Solid.js) + Tailwind + TanStack Query/Form skeleton, deployed to
Cloudflare Workers.

Implementation baseline: use the Solid packages and APIs already in this scaffold
(`@tanstack/solid-start`, `@tanstack/solid-router`, and `solid-js`), never their React
equivalents. All framework APIs, package compatibility, and Worker APIs must be verified against
the versions locked in `pnpm-lock.yaml` before implementation.

## 1. Confirmed Product Decisions

These were clarified with the product owner before finalizing the design below. They are load-bearing decisions — the data model and protocol in this plan assume them.

| Decision                   | Choice                                                                                                                                                                                                                |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reveal / reset permissions | **Symmetric** — any participant can reveal or reset. No facilitator/host role, no accounts.                                                                                                                           |
| Card decks                 | **Presets** — user picks a deck at room creation (e.g. Fibonacci, T-shirt sizes, plus a sequential/linear option). Fixed, non-customizable options only (no deck builder).                                            |
| Round history              | **Lightweight in-session history** — a bounded scrollback list of prior rounds (values plus applicable average/median) visible for the lifetime of the room. Not persisted beyond the room's life, not exportable, no analytics. |
| Identity persistence       | **Remembered via `localStorage`** — a participant's display name and a stable participant id persist locally so refreshing or reopening the room link auto-rejoins them under the same identity.                      |
| Room creation              | **Explicit server-side creation** — the homepage calls a validated server function which creates the room with its selected deck before navigating to its canonical URL. Unknown or expired URLs never create a room. |

Everything else in "Explicitly Excluded Features" from the product description (accounts, integrations, dashboards, analytics, custom deck builder, ceremonies) remains out of scope and is not re-litigated below.

## 2. High-Level Architecture

```
┌────────────────────────┐        HTTPS (SSR / server fns)      ┌───────────────────────────┐
│   Browser (Solid.js)   │ ────────────────────────────────────▶│  Cloudflare Worker         │
│   TanStack Router/Query│                                       │  (TanStack Start handler)  │
│   Room client store    │◀──────────── WebSocket ───────────────│  + custom entrypoint       │
└────────────────────────┘                                       └─────────────┬─────────────┘
                                                                                 │ getByName(roomId)
                                                                                 ▼
                                                                   ┌───────────────────────────┐
                                                                   │  Room Durable Object       │
                                                                   │  (one per room code)       │
                                                                   │  - SQLite storage          │
                                                                   │  - Hibernatable WebSockets │
                                                                   │  - Alarm-based cleanup     │
                                                                   └───────────────────────────┘
```

**Why Durable Objects instead of polling / TanStack Query alone:** planning poker is fundamentally
a shared, low-latency, multi-writer state machine (who's voted, reveal, reset) with no database
of record needed elsewhere. A single Durable Object per room gives us:

- Strong consistency for the "everyone sees reveal at the same instant" requirement.
- A natural home for ephemeral state (no D1/KV needed) — SQLite storage inside the DO is the
  source of truth, in-memory is just cache.
- WebSocket Hibernation API so idle rooms (e.g. during a long discussion) cost ~nothing and the
  Worker isn't billed for idle connection time.
- One DO instance per room code (`env.ROOM.getByName(roomCode)`), never a single global actor —
  avoids bottlenecks and matches "support multiple teams and sessions at the same time."

**Why not plain polling with server functions + TanStack Query:** it would work, but adds
perceptible latency to "vote status" and "reveal" (must feel instant/synchronous per the product
brief), and would need a debounced polling interval that either wastes requests or feels laggy in
a live meeting. WebSockets over a DO are a better fit for near-zero cost given hibernation, and no
harder to deploy since the project already targets Cloudflare Workers.

## 3. Cloudflare Worker Entrypoint & Wrangler Changes

Today `wrangler.jsonc` points `main` directly at the framework's server entry
(`@tanstack/solid-start/server-entry`). To export a Durable Object class alongside the Start
handler, we need a **custom entrypoint** that re-exports the Start handler's `fetch` and adds the
DO class as a named export (this is the officially documented pattern for TanStack Start on
Workers when Durable Objects/Queues/Cron are needed).

```
src/server.ts                 # new custom Worker entrypoint
src/server/durable-objects/room.ts   # RoomDurableObject class
```

`src/server.ts` (illustrative):

```ts
import handler from "@tanstack/solid-start/server-entry";
export { RoomDurableObject } from "./server/durable-objects/room";

export default {
  fetch: handler.fetch,
};
```

`wrangler.jsonc` changes:

```jsonc
{
  "main": "src/server.ts", // was "@tanstack/solid-start/server-entry"
  "durable_objects": {
    "bindings": [{ "name": "ROOM_DO", "class_name": "RoomDurableObject" }],
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["RoomDurableObject"] }],
  "observability": { "enabled": true },
}
```

A generated `Env` type (via a `cf-typegen` script that runs `wrangler types`) will expose
`ROOM_DO: DurableObjectNamespace<RoomDurableObject>` to server routes and server functions.
Server-only modules access this binding through `env` from `cloudflare:workers`; it must never be
imported into client code.

## 4. Room Durable Object: Data Model & Lifecycle

### 4.1 Storage schema (SQLite, inside the DO)

```sql
CREATE TABLE room (
  id TEXT PRIMARY KEY,             -- room code, e.g. "swift-otter-42"
  deck_type TEXT NOT NULL,         -- 'fibonacci' | 'tshirt' | 'sequential'
  revealed INTEGER NOT NULL,       -- 0/1
  round_number INTEGER NOT NULL,   -- increments on each reset
  created_at INTEGER NOT NULL,
  last_activity_at INTEGER NOT NULL
);

CREATE TABLE participant (
  id TEXT PRIMARY KEY,             -- stable client-generated id (persisted in localStorage)
  name TEXT NOT NULL,
  vote TEXT,                       -- current round's selection; NULL = no vote yet
  joined_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE TABLE round_history (
  round_number INTEGER PRIMARY KEY,
  revealed_at INTEGER NOT NULL,
  results_json TEXT NOT NULL,      -- [{participantId, name, vote}]
  average REAL,                    -- NULL unless every revealed vote is numeric
  median REAL                      -- NULL unless every revealed vote is numeric
);
```

`vote` is never broadcast to other clients until `revealed = 1` — only a derived `hasVoted`
boolean per participant is sent, matching the "voting progress without exposing values" requirement.
`connected` is not persisted. It is calculated for each snapshot from the attachments of
`ctx.getWebSockets()`, which remains correct after hibernation and when one participant has
multiple browser tabs open.
Keep at most 100 history records per room, deleting the oldest after inserting a new record, so a
long-running room has a bounded SQLite footprint and broadcast payload.

### 4.2 WebSocket protocol

Transport: one WebSocket per active browser tab per room, upgraded through a server route and forwarded
to the DO (`stub.fetch(request)`), using the **Hibernation API** (`ctx.acceptWebSocket`), not the
plain `WebSocketPair`-only pattern — this lets idle sessions hibernate. Immediately after accept,
call `ws.serializeAttachment({ participantId })` so identity survives hibernation without relying
on an in-memory `Map`.

Client → Server messages (JSON, validated with a shared Zod schema):

| Type     | Payload                   | Effect                                                                 |
| -------- | ------------------------- | ---------------------------------------------------------------------- |
| `join`   | `{ participantId, name }` | Upserts participant, attaches identity to this socket, broadcasts state |
| `rename` | `{ name }`                | Updates display name                                                   |
| `vote`   | `{ value }`               | Records vote for the current hidden round                               |
| `reveal` | `{}`                      | Sets `revealed = 1`, appends to `round_history`, broadcasts full votes |
| `reset`  | `{}`                      | Clears votes, `revealed = 0`, increments `round_number`, broadcasts    |
| `leave`  | `{}`                      | Closes this socket (also handled implicitly on socket close)           |

Validate the JSON envelope, message size, room code, display name, and card value with shared Zod
schemas before any mutation. Reject malformed, out-of-order, or invalid-state actions with a
typed error sent only to the originating socket; do not silently treat them as success.

Server → Client messages: a complete snapshot is sent after every mutation (simpler and safer than
diff-patching for the expected room sizes — typically well under a few dozen participants). Build
the snapshot separately for each socket: while votes are hidden, `selfVote` is sent only to the
socket's attached participant identity so reconnecting users retain their selected-card state, and
other participants never receive that value.

```ts
type RoomState = {
  roomId: string;
  deckType: "fibonacci" | "tshirt" | "sequential";
  revealed: boolean;
  roundNumber: number;
  participants: Array<{
    id: string;
    name: string;
    connected: boolean;
    hasVoted: boolean;
    vote?: string; // included for every participant only when revealed === true
  }>;
  selfVote?: string; // included only for this participant while votes are hidden
  history: Array<{
    roundNumber: number;
    average: number | null;
    median: number | null;
    results: Array<{ name: string; vote: string }>;
  }>;
};
```

`reveal` is idempotent: it only transitions a hidden round once and appends one history record.
`reset` may clear a hidden or revealed round, increments the round number, and only preserves
history for rounds that were revealed. Average and median are populated only when every vote in
that revealed round is numeric; otherwise both are `null`. This avoids presenting a misleading
partial consensus when a team selected `?` or `coffee`.

### 4.3 Lifecycle & cleanup

- The homepage invokes a POST `createRoom` server function. It validates the selected deck,
  generates a high-entropy room code, calls an idempotent DO `createRoom` RPC, and retries a code
  collision. Only after success does it navigate to `/room/$roomId`. A `join` can only join an
  existing room and never accepts a deck type.
- The DO initializes its room row atomically in `createRoom`, including `round_number = 1`, then
  schedules its cleanup alarm, and returns the canonical room metadata. The server function is the
  only creation path.
- Update `last_activity_at` for accepted joins and successful state mutations. Schedule the one
  available DO alarm for `last_activity_at + ROOM_TTL_MS` (24 hours, a named server-side
  constant). The alarm deletes room storage only when there are no active sockets; otherwise it
  reschedules for another TTL interval. Do not wake every 10 minutes.
- A closed socket does not delete its participant row. Snapshot connection status is calculated
  from all currently open sockets, so closing one of several tabs cannot mark that participant
  disconnected. A reconnect using the same participant ID preserves the existing vote and history
  until TTL cleanup.
- The first message on a socket must be `join`; serialize that participant ID only after validation.
  Reject subsequent `join` messages with a different ID and reject all other actions on an
  unattached socket. The participant ID is a convenience identity, not authentication: anyone who
  receives a room URL may join and has the symmetric reveal/reset permissions in §1.

## 5. Application Routing Plan

```
src/routes/
  __root.tsx                      (existing shell)
  index.tsx                       Homepage — create room CTA + deck picker
  room.$roomId.tsx                 Room screen (join dialog, deck, participants, reveal/reset)
  api/
    rooms/
      $roomId/
        socket.ts                  GET — WebSocket upgrade, forwards to the Room DO
```

- `room.$roomId` uses a route `loader` which calls a server-only `getRoom` function/DO RPC. It
  returns the immutable room metadata (`roomId`, deck type) or a typed not-found result, letting
  the route render a clean "room not found / expired" state without a client round trip.
- `index.tsx` invokes the server-side `createRoom` function described in §4.3, then navigates to
  the returned canonical URL. Do not pass deck choice in router state: it would disappear on
  reload and permit a shared URL to initialize with different configuration.
- The only HTTP server route is the WebSocket upgrade endpoint. It validates the request method,
  same-origin WebSocket request, and room-code format, then forwards the upgrade request to the
  deterministic room DO. Confirm the final file-route syntax against the installed Solid Start
  router plugin before adding it, and regenerate `routeTree.gen.ts`; do not hand-edit that file.

## 6. Shared Domain Types & Validation

New module `src/lib/room-protocol.ts` (isomorphic — imported by both the client hook and the
server route/DO):

- Zod schemas for room codes, deck types, every client→server message, server→client snapshot, and
  typed protocol errors. Infer TypeScript types from these schemas; Router type generation does not
  generate protocol types.
- Deck presets as plain constants:
  - `fibonacci`: `0, 1, 2, 3, 5, 8, 13, 21, 34, ?, ☕`
  - `tshirt`: `XS, S, M, L, XL, XXL, ?, ☕`
  - `sequential`: `1..10, ?, ☕`
- Name constraints: 1–30 chars, trimmed, basic sanitization (strip control chars) — no profanity
  filtering (out of scope for a minimal tool).
- Room code generation: use a server-only, human-shareable, URL-safe `nanoid` alphabet without
  ambiguous characters and at least 10 characters of entropy. Client code never generates room
  codes.

## 7. Client Architecture

### 7.1 Identity & persistence (`src/lib/identity.ts`)

- On first visit, generate a `participantId` (nanoid) and store `{ participantId, name }` in
  `localStorage` under a single key. Reuse it across rooms so returning to any room link auto-fills
  the join dialog and reconnects under the same identity. Each browser tab is a separate socket;
  the server treats multiple sockets with the same participant ID as one participant.
- This is browser-only state — implemented as a `createIsomorphicFn`/`ClientOnly`-guarded utility
  per the Start execution model (localStorage must never be touched during SSR render).

### 7.2 Room connection hook (`src/lib/use-room-connection.ts`)

A Solid primitive that:

- Opens the WebSocket only on the client (`onMount`, guarded so it never runs during SSR).
- Exposes a Solid store (`createStore`) with the current `RoomState`, updated wholesale on each
  server broadcast (simplest correct approach; avoids partial-update bugs).
- Exposes action functions: `vote(value)`, `reveal()`, `reset()`, `rename(name)`, `leave()`.
- Implements reconnect with capped exponential backoff and a visible "reconnecting…" status,
  since Wi-Fi drops mid-meeting are the primary reliability risk for this tool.
- Sends a `join` message immediately on `onopen` using the stored identity, and does not enable
  room actions until it receives an accepted snapshot.

### 7.3 Data fetching / mutation split

- The route loader/server function owns the one-shot SSR room lookup; **TanStack Query is not
  required for this lookup** and is not used for live room state. The WebSocket store is the sole
  client authority for live state, so no cache can race it.
- **TanStack Form** is used for the two small forms in the app: the "join room" (name entry)
  dialog and the homepage's deck-preset selector — both are simple enough that Form's validation
  wiring is more about consistency with the rest of the stack than necessity.

### 7.4 Solid-specific pitfalls to guard against during implementation

- Router hooks (`useParams`, `useSearch`) return `Accessor<T>` — must be called (`params()`), not
  destructured, or reactivity breaks (this bit is called out because it's the #1 React→Solid
  migration mistake and directly affects `room.$roomId`'s `roomId` param usage).
- `loader`/`beforeLoad` are plain async functions — no Solid primitives inside them; pass data via
  loader data / router context, not hooks.
- WebSocket setup must live in `onMount`/an effect, never at component top-level, to avoid running
  during any server-side pass.

## 8. UI / Component Plan

`ui.config.json` configures solid-ui aliases but the empty scaffold contains no installed component
primitives. In Phase 0, verify the generator and its current package requirements. Generate only
the accessible primitives actually needed (for example dialog, button, and select), or implement
small application-local equivalents if the generator is incompatible with the locked stack. Do not
assume a component exists merely because `ui.config.json` exists, and do not introduce a second UI
system.

Components to add under `src/components/`:

- `home/create-room-form.tsx` — hero copy, deck-preset select, single "Start a session" CTA.
- `room/join-dialog.tsx` — modal shown when no confirmed name exists yet for this room; prefilled
  from stored identity if present.
- `room/room-header.tsx` — room code, copy-link button (with a brief "Copied!" affordance),
  connection status indicator.
- `room/participant-list.tsx` — avatar/initials + name + state chip (`waiting` / `voted` /
  disconnected greyed-out), no vote value shown pre-reveal.
- `room/card-deck.tsx` — the selected preset's cards, tap/click to vote, clear "selected" affordance,
  disabled once revealed until reset.
- `room/reveal-results.tsx` — post-reveal view: each participant's value, the server-authoritative
  average/median when all votes are numeric, simple outlier highlight (e.g. min/max badges), and
  "Reset" CTA.
- `room/round-history.tsx` — collapsible list of up to 100 previous rounds (round #, applicable
  average/median, values) for the current session only.
- `ui/copy-link-button.tsx` — thin wrapper using the Clipboard API with `ClientOnly` guarding.

Layout/UX notes tying back to the product brief:

- Every screen has exactly one dominant primary action (Start a session → Join → Vote → Reveal →
  Reset), consistent with "one immediate action per screen."
- Mobile: card deck wraps into a tap-friendly grid (min. 44px touch targets), participant list
  becomes a horizontally scrollable strip or simple stacked list below the deck on narrow
  viewports; no drag-and-drop or hover-only affordances.
- States to explicitly design: empty room (just created, waiting for others), room not
  found/expired, disconnected/reconnecting, revealed vs. hidden vote states.

## 9. Non-Functional Concerns

- **Security/abuse:** validate all inbound WS messages with Zod inside the DO (never trust the
  client); cap frame size and participants per room (100) to bound broadcast cost; enforce a
  per-socket action budget stored in that socket's serialized attachment so it survives
  hibernation. Close sockets which exceed the budget with a policy-violation close code. Do not
  rely on an in-memory-only token bucket, because hibernation resets it.
- **Privacy:** no accounts, no cookies beyond what's functionally required, no analytics/tracking
  — consistent with the product's explicit exclusions. `localStorage` identity never leaves the
  browser except as a `participantId`/`name` pair sent over the room's own WebSocket.
- **Performance:** hibernatable WebSockets keep idle-room cost near zero; full-state broadcast is
  cheap at expected room sizes (tens of participants, not thousands).
- **Accessibility:** keyboard-operable card selection, explicit visible focus states, sufficient
  color contrast for status chips, `aria-live` region for
  "X has voted" / "Votes revealed" announcements.
- **Observability:** enable Workers `observability.enabled` in `wrangler.jsonc`; structured
  `console.log` in the DO for join/leave/reveal/reset events using room ID and participant ID
  hashes, not display names, to aid debugging without collecting PII in logs.

## 10. New Dependencies

| Package                                     | Purpose                                                                                      |
| ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `nanoid`                                    | Room codes and participant ids (already a transitive dep; promote to a direct dependency).   |
| `zod`                                       | Shared runtime validation for the WS protocol (already a transitive dep; promote to direct). |
| `@cloudflare/vitest-pool-workers` (dev)     | Integration tests for the Room Durable Object against the real Workers runtime.              |
| `@solidjs/testing-library` + `vitest` (dev) | Component tests for Solid UI pieces.                                                         |
| `@playwright/test` (dev)                    | Multi-tab end-to-end test of the join/vote/reveal/reset flow.                                |

No new production runtime dependencies beyond `nanoid`/`zod` — deliberately avoiding a state
management library, real-time SDK, or UI kit beyond what's already scaffolded, per the "no extra
features" scope discipline. Select versions compatible with the locked Vite/TypeScript/Workers
toolchain instead of using unbounded `latest`, add `test`, `test:unit`, and `test:e2e` scripts,
and commit their lockfile changes.

## 11. Testing Strategy

1. **Unit tests** — deck preset math (average/median calc, non-numeric vote handling), room code
   generation, Zod schemas for protocol messages.
2. **Durable Object integration tests** (`@cloudflare/vitest-pool-workers`) — full lifecycle: join
   → vote → reveal → reset → history entry appended; reconnection reusing `participantId`;
   unknown room rejection; duplicate reveal idempotency; two sockets for one participant; and
   inactivity cleanup by setting the stored timestamp, then invoking the alarm with
   `runDurableObjectAlarm` (rather than relying on wall-clock time).
3. **Component tests** — `CardDeck` selection state, `ParticipantList` vote-state rendering without
   leaking hidden values, `RevealResults` averaging.
4. **End-to-end (Playwright)** — two browser contexts simulating two participants: create room →
   second joins via link → both vote → first reveals → both see identical results → reset →
   history shows prior round. Assert that hidden vote values are absent from the other
   participant's received snapshot. Cover reload/reconnect and a mobile-viewport smoke pass.
5. **Manual/local verification** — use the scaffold's `pnpm dev` (Vite plus the Cloudflare plugin)
   and `pnpm preview` to exercise the real DO binding before deployment. Do not prescribe
   standalone `wrangler dev` unless the finalized Vite/Cloudflare integration supports that
   workflow.

## 12. Phased Delivery Plan

**Phase 0 — Scaffolding & config**
First run the existing build/check commands to establish the scaffold baseline. Resolve the
known compatibility risk that the scaffold locks Vite 8 while its installed
`@tanstack/devtools-vite` documentation supports Vite 6 or 7: upgrade, downgrade, or remove that
development-only plugin according to its verified release support before proceeding. Correct the
Biome include globs so nested source and test files are checked. Add `nanoid`/`zod` as direct
dependencies; add compatible test tooling and scripts; generate only needed solid-ui primitives;
create `src/server.ts`; update `wrangler.jsonc` (main, DO binding, migration, observability); and
add `cf-typegen` to generate the Worker binding declaration. Acceptance: `pnpm build`,
`pnpm check`, and `pnpm dev` succeed with the generated binding types included. Deployment is not
an acceptance criterion because it requires account credentials and is Phase 6 work.

**Phase 1 — Room Durable Object & protocol**
Implement `RoomDurableObject` (schema, hibernatable WS accept/close/message handlers, alarm-based
cleanup), shared `room-protocol.ts` schemas, `createRoom`/`getRoom` server functions, and the
WebSocket server route. Acceptance: DO integration tests pass; an automated WebSocket integration
test creates a room, joins, votes, reveals, resets, and proves that a hidden vote is never sent to
another participant.

**Phase 2 — Client connection layer**
Build `identity.ts` and `use-room-connection.ts`; wire reconnect/backoff. Acceptance: two browser
contexts reflect each other's join/vote/reveal/reset in real time, while reload restores the
originating participant's selected card without exposing it to peers.

**Phase 3 — Core UI**
Homepage (deck picker + CTA), join dialog, room screen composition (header, participant list, card
deck, reveal results, round history). The homepage must wait for explicit room creation to succeed
before navigation and surface a retryable failure state. Acceptance: the full functional flow in
§"Functional Flow" of the product description works end-to-end in the browser, desktop viewport.

**Phase 4 — Mobile polish & empty/error states**
Responsive layout pass, room-not-found/expired screen, reconnecting indicator, copy-link
affordance, accessibility pass (focus states, `aria-live`). Acceptance: usable one-handed on a
360px-wide viewport; Lighthouse a11y score check.

**Phase 5 — Hardening & tests**
Hibernation-safe rate limiting, input-validation edge cases, DO cleanup verification through the
test runtime's alarm helper, full Playwright suite, and component test coverage for the pieces in
§11. Acceptance: `pnpm check`, unit/DO integration tests, and the Playwright suite are green in a
CI-equivalent local run.

**Phase 6 — Deployment**
`wrangler deploy` to a `*.workers.dev` subdomain; smoke test the real multi-user flow against the
deployed URL; document prerequisite Cloudflare account configuration, deployment, version rollback,
and generated-type refresh steps in `README.md`.

## 13. Explicit Non-Goals (unchanged from product description)

No accounts, no project dashboards, no backlog/Jira/Linear/Trello/Slack integrations, no
retrospectives/standups, no custom deck builder beyond the fixed presets in §6, no analytics
dashboards, admin panels, onboarding flows, or premium upsells.
