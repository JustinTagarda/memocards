# MemoCards

MemoCards is a Next.js flashcard application for private, per-user studying with spaced repetition, deck/card management, import/export, and server-generated audio.

## Quick Project Analysis

- Framework: Next.js App Router (`src/app`) with React 19 + TypeScript.
- Data/Auth: Supabase Auth + Postgres, using `common` (shared profile) and `memocards` (app data) schemas.
- API surface: 5 server routes under `src/app/api` for audio, OCR/text extraction, lesson-to-cards generation, and answer-evaluation queueing.
- Domain split: page-level UI in `src/views`, reusable UI in `src/components`, client data operations in `src/services/memocards.ts`, and utilities in `src/lib`.
- Infra note: database migrations exist in `supabase/migrations`, including an `audio_generation_queue` migration.

## Tech Stack

- Next.js 16
- React 19
- TypeScript 5.9
- Supabase (`@supabase/supabase-js`, `@supabase/ssr`)
- Google Cloud Vision (image text extraction)
- Google Cloud Text-to-Speech (card audio)

## Implemented App Routes

### Pages

- `/`
- `/app`
- `/app/activity`
- `/app/decks/new`
- `/app/decks/[deckId]`
- `/app/decks/[deckId]/edit`
- `/app/decks/[deckId]/study`
- `/app/decks/[deckId]/cards/new`
- `/app/decks/[deckId]/cards/bulk`
- `/app/decks/[deckId]/cards/[cardId]/edit`

### Auth

- `/auth/callback`

### API

- `POST /api/audio/generate`
- `POST /api/audio/process-queue`
- `POST /api/cards/extract-from-images`
- `POST /api/cards/generate-from-lesson`
- `POST /api/answer-evaluations/queue`

## High-Level Architecture

- Frontend and backend live in one Next.js app.
- Browser clients perform most CRUD directly against Supabase with RLS.
- Privileged/external-provider work runs through server route handlers.
- Core client data flows are centralized in `src/services/memocards.ts`.

## Database

Migrations:

- `supabase/migrations/20260310230000_init_memocards.sql`
- `supabase/migrations/20260320150000_add_audio_generation_queue.sql`

Primary tables/schemas:

- `common.profiles`
- `memocards.user_settings`
- `memocards.folders`
- `memocards.decks`
- `memocards.cards`
- `memocards.activity`
- `memocards.sessions`
- `memocards.answer_evaluations`
- `memocards.audio_generation_queue`

Storage:

- Bucket: `memocards-audio` (private, user-scoped paths)

## Environment Variables

Copy `.env.example` to `.env.local` and fill values:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_LOCAL_DEV_BYPASS=false
SUPABASE_SERVICE_ROLE_KEY=
GOOGLE_CLOUD_PROJECT_ID=
GOOGLE_CLOUD_CLIENT_EMAIL=
GOOGLE_CLOUD_PRIVATE_KEY=
```

Notes:

- `GOOGLE_CLOUD_PRIVATE_KEY` must keep newline escapes (`\n`) in `.env` format.
- `NEXT_PUBLIC_LOCAL_DEV_BYPASS` is optional and intended for local development workflows.

## Local Development

Install dependencies:

```bash
npm install
```

Run dev server:

```bash
npm run dev
```

Type-check:

```bash
npm run typecheck
```

Production build:

```bash
npm run build
```

Run production server:

```bash
npm run start
```

## Project Structure

```text
.
|-- public/
|-- src/
|   |-- app/
|   |   |-- (protected)/
|   |   |-- api/
|   |   `-- auth/
|   |-- components/
|   |-- hooks/
|   |-- lib/
|   |-- services/
|   |-- types/
|   `-- views/
|-- supabase/
|   `-- migrations/
|-- .env.example
|-- middleware.ts
|-- next.config.ts
`-- README.md
```
