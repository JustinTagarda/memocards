# MemoCards Architecture

Developer-facing map of how the app actually works. For features, routes, and setup, see [README.md](../README.md). For agent rules, see [AGENTS.md](../AGENTS.md) and [CLAUDE.md](../CLAUDE.md).

## Big Picture

MemoCards is a single-user-scoped flashcard app with two data paths:

1. **Browser → Supabase (RLS)** — nearly all CRUD. Client components call functions in `src/services/memocards.ts`, which use the browser Supabase client. Postgres RLS policies (`*_all_own`, keyed on `user_id = auth.uid()`) enforce ownership; there is no app-level authorization layer on this path.
2. **Browser → Next.js API routes → providers/service-role** — anything privileged: Google Cloud Vision OCR, Gemini lesson generation, Cloud TTS audio, and the audio/evaluation queues. Routes live in `src/app/api`, authenticate the caller via the server Supabase client, then use the service-role admin client (`src/lib/supabase/admin.ts`) for cross-cutting reads/writes.

```text
views/ ── components/ ── hooks/useMemoCards.ts ─┐
                                                ├─ services/memocards.ts ── Supabase (RLS)
                                                └─ fetch('/api/...') ── app/api/* ── admin client + Google Cloud
```

## Module Responsibilities

| Layer | Location | Role |
| --- | --- | --- |
| Routes | `src/app/(protected)/app/**` | Thin page wrappers; render a view from `src/views` |
| Views | `src/views/*.tsx` | Page-level UI and state orchestration (Dashboard, Deck, Study, editors, bulk generator, activity) |
| Components | `src/components` | Reusable UI: `AppShell`, `StudySessionView`, `QuickAddComposer`, `BulkCardGenerator`, `Modal`, `ConfirmDialog`, `forms.tsx` |
| Hooks | `src/hooks` | `useAuth` (session + OAuth sign-in + dev bypass), `useMemoCards` (resource hooks wrapping the service layer with load/refresh state) |
| Service layer | `src/services/memocards.ts` (~1400 lines) | The only sanctioned persistence path. Row↔model mapping, all CRUD, session recording, export/import, API-route callers |
| Domain helpers | `src/lib` | Parsing, spaced repetition, drafts, audio, env — see below |
| Types | `src/types/models.ts` (domain), `src/types/database.ts` (row shapes) | Domain model is camelCase; DB rows are snake_case with JSONB blobs |

## Data Model

Two Postgres schemas (see `supabase/migrations/`):

- `common.profiles` — user profile + `settings` and `summary` JSONB (streaks, totals).
- `memocards.user_settings`, `folders`, `decks`, `cards`, `activity`, `sessions`, `answer_evaluations`, `audio_generation_queue` — all with `user_id` and owner-only RLS policies.

Cards are **JSONB-heavy**: `review_state`, `study_stats`, `audio`, `ai_evaluation`, `expected_answer`, `choices` are JSONB columns mapped to typed objects in `models.ts`. When adding card fields, prefer extending an existing JSONB blob (backward-compatible, no migration) over new columns; normalize defaults in the row→model mapper in `memocards.ts` so old rows stay valid.

Card types: `basic` (front/back), `term` (term/definition), `multiple_choice` (choices with `isCorrect`), `explanation` (prompt/answer/rubric with `expectedAnswer` for future AI evaluation).

Storage: private `memocards-audio` bucket, paths scoped by user id, accessed via signed URLs.

## Key Flows

### Auth and the dev bypass

- Production auth is Supabase OAuth (`useAuth.tsx` → `signInWithOAuth`), sessions refreshed by `middleware.ts` → `src/lib/supabase/middleware.ts`; `/auth/callback` completes the flow.
- **Local dev bypass** (`src/lib/devBypass.ts`): when `NEXT_PUBLIC_LOCAL_DEV_BYPASS=true`, not production, and the site host is localhost, a fixed user id (`11111111-…`) and cookie replace real auth. `src/services/devBypassStore.ts` provides the matching data layer. Middleware short-circuits entirely in bypass mode. Never let bypass ids or cookies work in production paths.

### Data change propagation

`notifyDataChanged()` in `memocards.ts` is a client-side event bus. Every mutation in the service layer calls it; `useMemoCards` hooks subscribe via `subscribeToDataChanged` and refetch. If you add a mutation and skip `notifyDataChanged()`, other views silently go stale — always route writes through the existing `saveCard` / `saveDeck` / `saveCardsBatch` helpers, which handle it.

### Study and spaced repetition

`StudyPage` → `StudySessionView` runs a session; each answer calls `reviewCard(...)`, which applies `src/lib/spacedRepetition.ts` (SM-2 variant: `again/hard/good/easy` → quality, ease factor, interval, mastery). Reviews update deck counts *incrementally* and deliberately do not fire `notifyDataChanged()` — broadcasting mid-session would refetch every subscribed view after each answer. `recordStudySession(...)` persists the session at the end, bumps streaks (local-day keys via `startOfLocalDayKey`), and broadcasts the refresh.

### Card entry (fast-entry workflow)

- `src/lib/quickAdd.ts` — parsing for `front :: back`, `term -> definition`, `prompt ::: answer`, tab-separated pairs, and blank-line blocks; produces preview items with invalid rows isolated.
- `src/lib/cardEntry.ts` — draft cloning, per-deck entry defaults application, localStorage persistence for unsaved drafts, Quick Add state, and per-deck "entry memory" (recent tags/type).
- `QuickAddComposer` (single + paste-many modes) and the full `CardEditorPage` both save through `saveCard` / `saveCardsBatch`. Extend these helpers rather than adding parallel parsers or persistence.

### Audio pipeline

Two paths, both in `src/app/api/audio`:

- `POST /api/audio/generate` — synchronous: authenticates, ensures TTS audio for one card side via `src/lib/cardAudioGeneration.ts` (text hash dedupe, Cloud TTS, upload to storage), returns a signed URL.
- `POST /api/audio/process-queue` — drains `memocards.audio_generation_queue` in the background (rows are enqueued by a DB trigger on card insert/text change). `claim_audio_generation_jobs` also reclaims jobs stuck in `processing` for >5 min and retries `failed` jobs up to 3 attempts (hard cap 5). Client-side warmup is limited to the current/next card in the study flow (`buildCachedAudioKey`); regeneration deletes the superseded storage object, and card/deck deletes remove their audio files best-effort.

Audio variants track `status` (`idle/processing/ready/failed`) and `textHash`; regeneration is skipped when the hash matches.

### Generation and OCR

- `POST /api/cards/extract-from-images` — Google Cloud Vision OCR on uploaded images (multi-page, request-id correlated).
- `POST /api/cards/generate-from-lesson` — Gemini (via Google auth) turns lesson text into card drafts; the bulk generator UI (`/app/decks/[deckId]/questions/generate`) lets users review/edit before `saveCardsBatch`.
- `POST /api/answer-evaluations/queue` — records evaluation requests for explanation cards; actual AI evaluation is **not implemented yet** (`status: 'not_configured'` / `ready_for_future_ai` markers in the model are forward-compatibility scaffolding).

## Conventions and Gotchas

- **Strict TS**: `noUncheckedIndexedAccess`, `noPropertyAccessFromIndexSignature`, `noUnusedLocals` are on — index access returns `T | undefined`, dynamic env access needs bracket notation.
- **Typed routes**: `typedRoutes: true`; use `Route`-typed hrefs, don't hand-build URL strings.
- **Path alias**: `@/*` → `src/*`.
- **Env access** goes through `src/lib/env.ts` (`hasSupabaseEnvironment`, `hasGoogleCloudEnvironment` guards let the app degrade gracefully when providers aren't configured).
- **No test suite / linter**: `npm run typecheck` is the routine gate; `npm run build` for routing/config/server changes.
- `enhance.md` at the repo root is the historical spec for the fast-entry workflow (already implemented) — reference, not a pending task list.
- Timestamps are ISO strings end-to-end; `date-fns` for formatting.

## Known Extension Points

Deliberate seams left for future work:

- **AI answer evaluation**: `CardAiEvaluation` model, `answer_evaluations` table, and the queue route exist; the evaluator itself does not.
- **Deck AI config**: `DeckAiConfig.provider` is `'not_configured'` — a placeholder for per-deck provider selection.
- **Export format**: `DeckExportBundle.formatVersion` gates future format evolution; import validates it.
