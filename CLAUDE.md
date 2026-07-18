# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Instruction Sources

This project was scaffolded with Codex and keeps its rules in `AGENTS.md`. Those rules apply to Claude as well:

- Read and follow [AGENTS.md](AGENTS.md) in this repository. It covers build/verification commands, architecture and persistence boundaries, helper ownership, routing/type-safety rules, environment/secrets policy, and repository access restrictions.
- `AGENTS.md` inherits from the global `D:\Projects\AGENTS.md`. Never modify the global file.
- This file adds Claude-specific guidance only. If this file and `AGENTS.md` ever conflict, `AGENTS.md` wins; flag the conflict instead of silently picking one.

## Quick Orientation

MemoCards is a private, per-user Next.js 16 flashcard app (React 19, TypeScript, Supabase) for spaced repetition, deck/card management, OCR, lesson-to-cards generation, answer evaluation, and server-generated audio.

- `src/app` — App Router pages; `(protected)` holds authenticated routes, `auth` holds auth flows.
- `src/app/api` — the only place for server-only work: provider integrations (Google Cloud TTS/Vision), service-role Supabase access, privileged mutations.
- `src/views` — page-level UI composed by routes.
- `src/components` — reusable UI.
- `src/services/memocards.ts` — client-side data operations against Supabase (RLS-scoped CRUD); `notifyDataChanged()` broadcasts refreshes.
- `src/lib` — utilities: `quickAdd.ts`/`cardEntry.ts` (card-entry parsing and drafts), `spacedRepetition.ts`, `cardAudioGeneration.ts`, `supabase/` clients, `env.ts`.
- `src/hooks`, `src/types`, `src/styles` — as named.

## Commands

- `npm run typecheck` — routine verification after code changes. Run this before considering a change done.
- `npm run build` — required when a change touches routing, config, server behavior, environment handling, or production-sensitive paths.
- `npm run dev` — local development server.
- `npm run start` — production-like smoke testing only.
- There is no test suite or linter configured; typecheck and build are the verification gates.

## Claude-Specific Working Rules

- Verify with `npm run typecheck` (or `npm run build` per the rule above) before reporting a change complete; do not add MSBuild or other Windows-native build steps.
- Prefer extending the existing helpers named in `AGENTS.md` (`saveCard`, `saveDeck`, `saveCardsBatch`, `notifyDataChanged`, `quickAdd.ts`, `cardEntry.ts`) over introducing parallel implementations — search for an existing helper before writing a new one.
- Keep `typedRoutes: true` working: use typed route helpers, never weaken types to make navigation compile.
- New environment variables must land in `.env.example` and `README.md` in the same change; never read secrets into client components.
- Server/client boundary is load-bearing: anything touching service-role keys or external providers belongs in `src/app/api`, everything user-scoped in the browser goes through Supabase with RLS.
- When updating features, keep `README.md`'s feature surface section accurate if the user-visible behavior changed.
