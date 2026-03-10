# MemoCards

MemoCards is a production-ready Next.js flashcard app for private studying, spaced repetition, and audio-assisted review. It uses a shared Supabase backend project named `justinapp-core`, but isolates all MemoCards data inside the `memocards` PostgreSQL schema. Shared cross-app identity data lives in the `common` schema.

Firebase has been removed from this codebase.

## Stack

- Next.js App Router
- React 19 + TypeScript
- Supabase Auth with Google OAuth
- Supabase Postgres with Row Level Security
- Supabase Storage
- Google Cloud Text-to-Speech
- Vercel deployment

## Architecture

- Frontend, routing, authenticated pages, and API routes all live in one Next.js app.
- Browser-side deck and card CRUD goes directly to Supabase through RLS-protected queries.
- Privileged operations run through Next.js route handlers:
  - `POST /api/audio/generate`
  - `POST /api/answer-evaluations/queue`
- Shared user identity data is stored in `common.profiles`.
- Every MemoCards-specific table is stored in `memocards.*`.

## Project structure

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

## Data model

### Shared schema

- `common.profiles`
  - One row per authenticated user
  - Shared across apps in the `justinapp-core` Supabase project

### MemoCards schema

- `memocards.user_settings`
- `memocards.folders`
- `memocards.decks`
- `memocards.cards`
- `memocards.activity`
- `memocards.sessions`
- `memocards.answer_evaluations`

### Storage

- Bucket: `memocards-audio`
- Private paths are scoped by user id:
  - `${user_id}/decks/${deck_id}/cards/${card_id}/...`

## Security model

- All application tables use Row Level Security.
- Every MemoCards query is scoped by `auth.uid() = user_id`.
- Audio files are private by default.
- The browser never talks directly to Google Text-to-Speech.
- Future AI answer evaluation is queued server-side only.

## Future AI-ready design

Explanation cards already store:

- canonical answers
- accepted variants
- keywords
- grading rubric text
- evaluation queue metadata

The app does not score answers yet, but the schema and API shape are already in place for a future evaluator.

## Environment variables

Copy `.env.example` to `.env.local` and fill in:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
NEXT_PUBLIC_SITE_URL=http://localhost:3000
SUPABASE_SERVICE_ROLE_KEY=
GOOGLE_CLOUD_PROJECT_ID=
GOOGLE_CLOUD_CLIENT_EMAIL=
GOOGLE_CLOUD_PRIVATE_KEY=
```

Notes:

- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is the web publishable key from Supabase.
- `NEXT_PUBLIC_SITE_URL` should be `http://localhost:3000` locally.
- In Vercel, set `NEXT_PUBLIC_SITE_URL` to the production URL for the `memocards` project.
- `GOOGLE_CLOUD_PRIVATE_KEY` must preserve line breaks. In `.env` files, keep it escaped with `\n`.

## Supabase setup

MemoCards is designed for the shared Supabase project `justinapp-core`.

### 1. Configure Auth

- Enable Google in `Authentication -> Providers`.
- Add your local and production callback URLs.
- This app uses `/auth/callback`.

Examples:

- `http://localhost:3000/auth/callback`
- `https://memocards.vercel.app/auth/callback`

### 2. Expose the required schemas

In Supabase project settings, expose these schemas to the API:

- `common`
- `memocards`

MemoCards uses `supabase.schema('common')` and `supabase.schema('memocards')`, so both must be available through the API.

### 3. Run the SQL migration

Apply:

- `supabase/migrations/20260310230000_init_memocards.sql`

You can run it through:

- Supabase SQL Editor
- Supabase CLI with `supabase db push`

Important:

- If `common.profiles` already exists in `justinapp-core`, compare the existing definition before running this migration.
- All MemoCards-specific tables belong in the `memocards` schema only.

### 4. Storage

The migration creates or updates the private bucket:

- `memocards-audio`

### 5. Google Cloud Text-to-Speech

- Enable the Google Cloud Text-to-Speech API for the same GCP project used by your credentials.
- Create a service account with permission to call Text-to-Speech.
- Copy the project id, client email, and private key into the environment variables above.

## Local development

Install dependencies:

```bash
npm install
```

Run the app:

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

## Deployment

### GitHub

This repository is intended to live at:

- `https://github.com/JustinTagarda/memocards`

### Vercel

Use Vercel Git integration for automatic deployments from the GitHub repo.

Recommended setup:

1. Create a Vercel project named `memocards`.
2. Import the `JustinTagarda/memocards` repository.
3. Add the environment variables from this README.
4. Set `NEXT_PUBLIC_SITE_URL` to the deployed URL.
5. Deploy.

After that, every push to the connected branch will trigger a Vercel deployment automatically.

## Current route map

- `/`
- `/app`
- `/app/decks/[deckId]`
- `/app/decks/[deckId]/study`
- `/auth/callback`
- `/api/audio/generate`
- `/api/answer-evaluations/queue`

## UX features included

- Google sign-in
- private per-user data isolation
- folders and tags
- deck and card CRUD
- JSON and CSV import/export
- basic, term/definition, multiple choice, and explanation cards
- spaced repetition
- shuffle and favorites filters
- progress summary and streaks
- recent activity and recent sessions
- mobile-first responsive layout
- server-generated audio playback

## Notes for the shared backend project

Because `justinapp-core` is shared across apps:

- keep shared identity tables in `common`
- keep MemoCards tables in `memocards`
- avoid putting MemoCards tables in `public`
- review SQL changes carefully before applying them to the shared project

That separation is the main boundary that keeps MemoCards isolated while still using one Supabase project.
