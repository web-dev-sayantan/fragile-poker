# Fragile Poker

Minimal real-time planning poker for small teams. Create a room, share the link, vote privately, reveal together, reset for the next round.

## Stack

- [TanStack Start](https://tanstack.com/start) (Solid) + Vite
- Cloudflare Workers + Durable Objects (SQLite + hibernatable WebSockets)
- Tailwind CSS 4
- Zod message validation

## Getting started

```bash
pnpm install
pnpm cf-typegen   # generate worker-configuration.d.ts from wrangler.jsonc
pnpm dev          # http://localhost:3000
```

## Scripts

| Script               | Purpose                               |
| -------------------- | ------------------------------------- |
| `pnpm dev`           | Local Vite + Workers dev server       |
| `pnpm build`         | Production client + SSR build         |
| `pnpm deploy`        | Build and deploy with Wrangler        |
| `pnpm cf-typegen`    | Regenerate Cloudflare `Env` types     |
| `pnpm run test`      | Unit + Durable Object tests (Vitest)  |
| `pnpm run test:unit` | Protocol / pure helper tests          |
| `pnpm run test:do`   | Room Durable Object integration tests |
| `pnpm run test:e2e`  | Playwright two-browser session flow   |
| `pnpm check`         | Biome lint + format check             |

> Prefer `pnpm run test` over `pnpm test` if your shell has `correct` enabled (zsh may try to rewrite `test` → `tests`).

## How it works

1. **Home** — choose a deck (Fibonacci / T-shirt / 1–10) and create a room.
2. **Room URL** — `/room/:roomId` loads metadata via a server function; unknown codes do not auto-create rooms.
3. **WebSocket** — browser connects to `/api/rooms/:roomId/socket`, which upgrades and forwards to the room Durable Object.
4. **Identity** — `participantId` + display name live in `localStorage` (`fragile-poker:identity`).
5. **Protocol** — client messages: `join`, `rename`, `vote`, `reveal`, `reset`, `leave`. Server pushes full `state` snapshots (private `selfVote` while hidden; peer votes only after reveal).
6. **Lifecycle** — rooms expire after 24h of inactivity (alarm). Unattached sockets are closed after a short join timeout.

## Deploy

```bash
pnpm install
pnpm cf-typegen
pnpm deploy
```

Requires Cloudflare auth (`wrangler login`). Bindings and the SQLite Durable Object migration live in `wrangler.jsonc`.

After deploy, open the `*.workers.dev` URL and smoke-test create → join → vote → reveal with two browsers. To roll back, use `wrangler deployments list` and `wrangler rollback` (or the Cloudflare dashboard Versions UI). Re-run `pnpm cf-typegen` whenever `wrangler.jsonc` bindings change.

## Testing notes

- Durable Object tests use `@cloudflare/vitest-pool-workers` with a **minimal** worker entry at `tests/do/worker.ts` (exports `RoomDurableObject` only) so Solid/Start SSR is not loaded into the pool.
- E2E starts `pnpm dev` on port 3000 and drives two isolated browser contexts through create → join → vote → reveal → reset.

## Product docs

- [docs/product-description.md](docs/product-description.md)
- [docs/implementation-plan.md](docs/implementation-plan.md)
