# MemoCards

MemoCards is a private, per-user Next.js flashcard app for spaced repetition, deck and card management, fast entry workflows, OCR, lesson-to-cards generation, answer evaluation, and server-generated audio.

## What It Does

- Private study data backed by Supabase Auth, Postgres, and RLS.
- Deck organization with folders, tags, search, filtering, and study preferences.
- Card creation and editing through the full form, Quick Add, paste-many preview, and bulk generation flows.
- Spaced repetition study sessions with review, learn, and cram modes.
- Import and export via JSON and CSV.
- Card audio generation, auto-play preference, and queued audio processing.
- Answer evaluation queueing for submitted study responses.
- Recent study history and activity tracking.

## Current Feature Surface

### Home and Dashboard

- Public landing page at `/` with sign-in entry points and local dev bypass messaging.
- Dashboard at `/app` showing due cards, streak, session totals, deck search, folder filtering, and tag filtering.
- Create deck, import deck, and create folder actions from the dashboard.

### Deck Management

- Create, edit, delete, and open decks.
- Organize decks with folders and tags.
- Configure per-deck study defaults, including default mode, daily goal, shuffle preference, and new-card entry defaults.
- Import decks from a saved bundle and export cards to CSV.

### Card Entry

- Full card editor with keyboard-first submit support.
- Save card, save and add another, and duplicate-last-saved conveniences.
- Lightweight local draft persistence for unfinished card edits.
- Compact Quick Add with single-card and paste-many modes.
- Quick Add parsing for `front :: back`, `term -> definition`, `prompt ::: answer`, tab-separated pairs, and blank-line paired blocks.
- Paste-many preview that shows valid cards and isolates invalid rows before saving.

### Study

- Study mode at `/app/decks/[deckId]/study`.
- Review queueing with spaced repetition updates after each session.
- Favorites-only filtering inside study sessions.
- Auto-play audio preference per user and audio warmup while studying.
- Session logging and progress history.

### Generation and Capture

- Image OCR at `/api/cards/extract-from-images`.
- Lesson text to cards at `/api/cards/generate-from-lesson`.
- Deck question generation at `/app/decks/[deckId]/questions/generate`.
- Legacy bulk route at `/app/decks/[deckId]/cards/bulk` redirects to question generation.
- Reviewable bulk generation flow with edit-before-save support.

### Activity

- Recent activity at `/app/activity`.
- Recent study session history and latest activity items.

## Tech Stack

- Next.js 16 App Router
- React 19
- TypeScript 5.9
- Supabase (`@supabase/ssr`, `@supabase/supabase-js`)
- Google Cloud Vision for OCR
- Google Vertex AI / Gemini for lesson-to-cards generation
- Google Cloud Text-to-Speech for card audio

## Scripts

- `npm run dev` - start the development server
- `npm run typecheck` - run TypeScript checks only
- `npm run build` - create a production build
- `npm run start` - run the production server

## Routes

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
- `/app/decks/[deckId]/questions/generate`

### Auth

- `/auth/callback`

### API

- `POST /api/audio/generate`
- `POST /api/audio/process-queue`
- `POST /api/cards/extract-from-images`
- `POST /api/cards/generate-from-lesson`
- `POST /api/answer-evaluations/queue`

## Architecture Notes

- Browser clients perform most CRUD directly against Supabase with RLS.
- Privileged work, provider integrations, and server-only mutation paths stay inside `src/app/api`.
- Reusable UI lives in `src/components`, page-level UI in `src/views`, client data operations in `src/services/memocards.ts`, and utilities in `src/lib`.
- Keep route typing enabled through `typedRoutes: true` in `next.config.ts`.

## Database

Migrations:

- `supabase/migrations/20260310230000_init_memocards.sql`
- `supabase/migrations/20260320150000_add_audio_generation_queue.sql`
- `supabase/migrations/20260718090000_queue_recovery_and_activity_pruning.sql`

Primary tables and schemas:

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

- Bucket: `memocards-audio`, private and user-scoped

## Environment Variables

Copy `.env.example` to `.env.local` and fill in the values:

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
- The Google Cloud credentials are used for both Vision OCR and lesson generation through Vertex AI.

## Local Development

Install dependencies:

```bash
npm install
```

Run the development server:

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

Run the production server:

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
|   |-- styles/
|   |-- types/
|   `-- views/
|-- supabase/
|   `-- migrations/
|-- .env.example
|-- middleware.ts
|-- next.config.ts
`-- README.md
```
