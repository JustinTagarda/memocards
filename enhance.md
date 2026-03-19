Implement production-safe UX enhancements to speed up deck/card entry without disrupting the current system.

Treat all requested changes as additive enhancements only. Do not rewrite the system. Keep the current logic layer as intact as possible. Prefer UI additions, helper utilities, and optional workflows over invasive refactors. If a feature already exists, improve or extend it instead of duplicating it.

Preserve existing behavior unless a change is explicitly required. Maintain backward compatibility for current deck/card create/edit flows. Avoid database schema changes unless absolutely necessary; any change must be minimal, backward-compatible, and clearly justified. Do not break current RLS assumptions, ownership checks, deck/card relationships, activity logs, `notifyDataChanged()`, audio metadata defaults, AI metadata defaults, or study flows. Keep all changes incremental, production-safe, and easy to review.

Goal: improve speed and convenience for repeated or high-volume deck/card entry while preserving current production behavior.

Implement, in priority order:

1. Add an optional compact Quick Add flow to `DeckPage.tsx` while keeping the full card form intact. Support quick syntax such as `front :: back` and `term -> definition`. If practical, support multiline quick-add for a single card. Reuse the existing `saveCard(...)` path where possible, preserve defaults/metadata, keep the user ready for the next entry, and provide a clear way to open the full editor for advanced fields.

2. Add or extend a Paste Many workflow on `DeckPage.tsx` that turns pasted text into multiple cards. Support common formats such as repeated front/back blocks, blank-line separated pairs, `front :: back`, `term -> definition`, and reasonable tab- or delimiter-separated pairs. Show a preview before saving, allow confirmation, reuse existing save/create logic, and prefer batched sequential creates through the current flow. Invalid rows should be isolated and clearly shown without blocking valid rows where feasible.

3. Extend existing deck preferences/config for repeated entry, if present. Support optional defaults such as default card type, default tags, optional audio-related defaults only if they do not affect current audio behavior, and other clearly additive per-deck defaults. Defaults must apply only to newly created cards. Both the full form and Quick Add should use them when available. Do not create a parallel config structure if one already exists.

4. Improve repeated creation with lightweight post-save conveniences such as create another with the same card type, duplicate the previous draft structure, or reuse previous tags/default selections. Keep this additive and do not affect normal save behavior. Prefer reusing current form state or last-saved card shape over changing persistence logic.

5. Add safe keyboard-first improvements, including a save/submit shortcut, quick focus for new card input where practical, and smooth tab order. Avoid shortcuts that conflict with browser defaults unless clearly scoped. Maintain accessibility. Existing mouse and touch flows must continue working normally.

6. Make entry lower-friction without replacing current flows. Keep advanced fields collapsed or secondary in quick-entry contexts. Preserve full advanced editing. Where possible, remember recent selections across consecutive creates, reduce repeated clicks for card type or tags, and keep users on `DeckPage` ready for the next entry. Avoid multiple sources of truth for draft state.

7. If feasible, add lightweight local persistence for unsaved drafts. Use client-side storage only, scoped by deck and entry mode. Do not interfere with saved server data. Restore should be helpful but unobtrusive. If draft support already exists, extend it instead of duplicating it.

Implementation guidance:
Favor additive components, hooks, and helper utilities. Keep `memocards.ts` core logic intact whenever possible. Reuse existing `saveCard(...)` and `saveDeck(...)` paths instead of reimplementing persistence. Put new parsing logic in isolated helpers, not core service logic, unless absolutely necessary. Keep new UI state local to the relevant page/component unless there is a strong reason otherwise.

Suggested scope:
Start with `DeckPage.tsx`. Extend `DashboardPage.tsx` only if deck defaults belong there. Keep `memocards.ts` changes minimal and only where needed for optional additive inputs or ergonomics.

Helper areas may include:

* quick-add parsing
* bulk paste parsing/normalization
* recent-entry/default-state helpers
* local draft persistence

Do not:

* rewrite deck/card creation architecture
* move writes to a new backend API
* replace RLS protections
* replace existing forms with a new system
* remove existing features
* duplicate existing features
* introduce speculative schema or architecture changes
* change study, review, deck count, audio, or AI metadata logic unless required for compatibility

First inspect the current implementation. If any requested capability already exists fully or partially, do not recreate it. Improve discoverability, usability, speed, flexibility, or integration with the new fast-entry workflow instead.

Expected output:
Provide a complete, production-ready patch based on the actual codebase.

Before patching, review:

* `src/views/DashboardPage.tsx`
* `src/views/DeckPage.tsx`
* `src/services/memocards.ts`
* relevant hooks, types, and components used by those files

Base all changes on the actual codebase. Do not guess.

Deliverables:
Update the relevant files with complete copy/paste-ready changes. Keep comments minimal. Preserve original code/comments unless they are part of the modification. Keep TypeScript types correct, handle new UI state cleanly, and ensure all new flows gracefully fall back to the existing full form.

Acceptance criteria:

* existing deck/card create and edit behavior still works
* `saveDeck(...)` and `saveCard(...)` remain the main persistence paths
* users can add cards faster through at least one new compact flow
* users can paste multiple cards and preview them before creation
* defaults and repeated-entry conveniences reduce manual input
* no duplicate feature is introduced where one already exists
* the result feels like a polished enhancement, not a rewrite

When done, summarize:

1. what was added
2. what existing functionality was extended instead of duplicated
3. any unavoidable logic-layer changes and why
4. any follow-up recommendations intentionally left out
