# Papra live-coding prep: updated sections

Verified against upstream commit `93a569f` (fork branch `aa-live-coding` adds only agent instructions, an architecture PDF + this Markdown document, and a `.gitignore` change). Runtime evidence comes from server logs of a local run on Nov 3, 2026, with llama3.1:8b served by Ollama. Items marked † were seen only in imports, greps or logs; their bodies are unread.

## Stack and layout

Papra is a minimalist, AGPL-3.0 document archive in a pnpm monorepo. The server is where most backend tasks land.

| Area | What it uses | Where we saw it |
| --- | --- | --- |
| Client | SolidJS, Shadcn Solid, UnoCSS (`apps/papra-client`, port 3000); reads server flags from `/api/config` at runtime | README, CONTRIBUTING.md, client code, logs |
| Server | Hono, Drizzle ORM with libSQL/SQLite (`db.sqlite`), Better Auth, Valibot, CadenceMQ in-process jobs (`apps/papra-server`, port 1221) | README, server `package.json`, logs |
| Shared code | `packages/*`: `std`, `search-parser`, `lecture`, `webhooks` | Server `package.json` |
| Docs | Astro Starlight (`apps/docs`) | CONTRIBUTING.md |
| Tooling | Vitest (unit tests, plus `*.int.test.ts` needing Docker), oxlint + oxfmt, Changesets | Root and server `package.json` |
| Runtime | Node 26.12.1, pnpm 12.4.2, TypeScript 7. Node 26 is required: the config code uses the global `Temporal`, and Node 24 fails with "Temporal is not defined" | Git log, root `package.json`, a local error |
| AI | `@tanstack/ai` with OpenAI-compatible adapters; Ollama default `http://localhost:11434/v1` (key `ollama`); llama3.1:8b tested | `ai` module, logs |
| Test data | The client's "Devtools" button (`apps/papra-client/src/modules/devtools`) generates fake invoice documents | Client code |

The server has about 30 modules under `src/modules`. The ones this exploration touched: `tags`, `documents` (with `content-extraction`, `tasks`, `events`), `ai`, `ai-credits`, `document-enrichment`, `auto-tagging`, `tagging-rules`, `tasks`, `organizations` (including organization settings), `storage`, `plans` and `plan-entitlements`.

Gotchas:
- Port 3000 must be free. If the client starts on 3001, login fails with "Invalid callbackURL".
- `node_modules` holds a copy of the server package (`@papra/app-server`), which doubles every search result. Search with `--exclude-dir=node_modules` and edit only files under `apps/papra-server/src`.
- After switching commits, run `pnpm dev:reset` in `apps/papra-server` (this wipes local data).
- CONTRIBUTING.md recommends ESLint, but the repo uses oxlint and oxfmt; trust `pnpm check`.

## Code conventions seen

A module such as `tags` is layered: `.table`, `.repository`, `.usecases`, `.api.contracts`, `.api.routes`, `.schemas`, `.errors`, `.config`, each with a colocated `.test.ts`.

- **Routes.** Two styles coexist. Tags uses `setupXRoute(deps)` returning `defineApiRoute({ contract, resolveContext: resolveAuthenticationContext({ apiKeyPermissions }), handler })`, with `{ status, contentType, body }` responses and dates as ISO strings. Documents still uses the older Hono style: `app.post(path, requireAuthentication(...), validateParams(...), handler)`. New endpoints use contracts (a migration that has been under way since mid-October); match the surrounding style when editing an existing route. In both, scope data loads by `organizationId`; the tags routes call `ensureUserIsInOrganization` first.
- **Use cases.** Plain async functions taking one named-args object: data first, a blank line, then dependencies. Errors come from `createXError()` factories, limits from the module's config (for example `maxTagsPerOrganization`), and logging is `logger.info({ ...context }, 'message')`.
- **Dependency injection.** Builders look like `buildX({ deps }) => async (args) => ...`, with narrow `Pick<Repo, 'method'>` types (enrichment) or whole repositories (tags, documents). Composition roots attach the real dependencies: the route files, `enrich-document.task.ts` and `extract-document-file-content.task.ts`. Tests pass fakes.
- **Jobs.** `tasks/tasks.definitions.ts` † registers tasks. Handlers rebuild repositories from `db` for each job and cast the job `data` (marked `TODO`). Jobs chain: extraction schedules enrichment, and only when both `AI_IS_ENABLED` and `AUTO_TAGGING_ENABLED` are on.
- **Events.** Payload types live in `documents.events.types.ts` †; handlers are registered in `app/events/events.handlers.ts` †. Batch tagging (`applyTagsToDocuments`) emits `document.tags.changed`, handled by the webhooks and activity-log handlers. The single-document add/remove routes call the webhook and activity-log helpers inline. Do not emit the event and also keep the inline calls, or every webhook and log entry fires twice.
- **Error handling differs by caller.** Tagging rules swallow failures (`safely`) so uploads never break. Enrichment lets exceptions reach the job runner. Auto-tagging drops failed tag creations without a log line.
- **Config.** Each setting declares `doc`, a Valibot `schema`, an `env` name and a `default`. Examples: `AI_IS_ENABLED`, `AUTO_TAGGING_ENABLED`, `AI_DEFAULT_MODEL` (format `<adapterId>://<model>`), `DOCUMENTS_CONTENT_EXTRACTION_ENABLED`, `DOCUMENTS_OCR_LANGUAGES`, `DOCUMENT_REPROCESSING_ENABLED`, `DOCUMENT_REPROCESSING_RATE_LIMIT`.
- **AI.** Every LLM call goes through `aiServices.generateStructuredData({ modelId, schema, systemPrompt, userPrompt, source, organizationId })`, with output validated by a Valibot schema. Credits are enforced only when `AI_CREDITS_IS_ENABLED` is on (default off). Tests fake this function and never call a real model.
- **Enrichment at this commit.** `buildEnrichDocument` loads the document, the organization's tags and its settings, skips if auto-tagging is off or there are no tags and none may be created, then calls the injected `promptForAutoTagging` and `applyAutoTaggingActions`. The schema lets the model choose existing tags only from an exact-name list; new tag names are free-form. `getTagsActions` caps each response at `maxTags`. Tags are only ever added. The full document text is sent, untruncated.
- **Client settings pattern.** The auto-tagging page sends a partial `updateOrganizationSettings({ organizationSettingsPartials: { ai: { autoTagging } } })`, invalidates the settings query, and reports errors with `safely` plus a toast. UI strings go through i18n keys in `en.dictionary.ts`. The client is Solid: signals and resources, not React hooks.
- **Tests.** Vitest, colocated `.test.ts` files, business-named cases; integration tests (`*.int.test.ts`) need Docker.
- **Style.** Functional code; single quotes, semicolons, two-space indent, trailing commas; `import type` for types.

## Annotated call stack: Ollama auto-tagging

One upload runs as three stages: the HTTP request, an extraction job and an enrichment job. Line annotations come from the server logs and the source files we read.

```
HTTP POST /api/organizations/:orgId/documents          (documents.routes.ts, create route)
  create-document use case                             (documents.usecases.ts, around lines 340-430)
    store the file, insert the row                     (on failure: delete the stored file, rethrow)
    if isContentExtractionEnabled: schedule job extract-document-file-content
                                   data { documentId, organizationId, ocrLanguages }
    log "Document created"                             (appears after "Consuming job": the queue is in-process)
    emit document.created -> trigger-webhooks, insert-activity-log,
                             track-document-created, index-document-in-search-service

HTTP POST .../documents/:documentId/reprocess          (documents.routes.ts, around lines 90-125)
  reject if DOCUMENT_REPROCESSING_ENABLED is off; load the document (trashed = not found)
  per-organization rate limit; 429 with Retry-After when exceeded
  schedule the same extraction job; respond 202       (does not check isContentExtractionEnabled)

JOB extract-document-file-content                      (documents/tasks/extract-document-file-content.task.ts)
  extractAndSaveDocumentFileContent                    (documents.usecases.ts:591)
    load the document (organization-scoped); open the stored file (decrypting if needed);
    read the whole file into memory
    extractDocumentText                                (content-extraction.usecases.ts)
      PDF with text layer -> extractorType pdf:pdf-text       (13 MB PDF: ~3.5 s; Type3 font warnings harmless)
      PDF without text    -> extractorType pdf:tesseract-js   (blank PDF: 978 ms, OCR fallback)
      csv / md / txt      -> extractorType text               (0 ms)
    updateDocument({ content }) -> emit document.updated      (saved even if the text is empty)
      -> trigger-webhooks, insert-activity-log, update-document-in-search-service, sync-document-storage-key
    applyTaggingRules                                  (log: taggingRulesCount 0)
  if AI_IS_ENABLED and AUTO_TAGGING_ENABLED: schedule job enrich-document { documentId, organizationId }
                                                       (gated by the global flags only, not the organization setting)

JOB enrich-document                                    (document-enrichment/tasks/enrich-document.task.ts)
  buildEnrichDocument(...)({ documentId, organizationId })   (document-enrichment.usecases.ts)
    Promise.all: getDocumentById | getOrganizationTags | resolveOrganizationSettings
    skip with log if: the organization has no tags and cannot create | auto-tagging is off for it
    throw if the document is missing
    promptForAutoTagging                               (auto-tagging.usecases.ts)
      build schema + system prompt + user prompt       (auto-tagging.models.ts; full text, no truncation)
      aiServices.generateStructuredData                (ai.services.ts)
        resolveTextAdapter("ollama://llama3.1:8b")     (OpenAI-compatible adapter, http://localhost:11434/v1)
        credits check                                  (skipped: AI_CREDITS_IS_ENABLED off)
        tanstackChat(adapter, outputSchema, stream: false)   (HTTP call to Ollama; Valibot validates the output)
      getTagsActions -> { tagIdsToAdd, tagsToCreate }  (cap: maxTags per response)
    log "Auto-tagging completed"   durationMs = promptForAutoTagging only
    applyAutoTaggingActions
      createTag x N                                    (concurrency 5, colour #CCCCCC; failures dropped silently)
      applyTagsToDocuments({ documentIds: [id], addTagIds, removeTagIds: [], userId: undefined })
        return early if nothing to add                 (blank PDF: no "Applied tag changes" line)
        getTagsByIds (organization-scoped), add/remove batches
        emit document.tags.changed -> trigger-webhooks (document:tag:added), insert-activity-log
        log "Applied tag changes to documents"         (taggedCount = newly inserted links only)
  job completed
```

Where the time goes (llama3.1:8b on Ollama):

| Document | Extraction | Auto-tagging | Tags added |
| --- | --- | --- | --- |
| 13 MB PDF, first run | 3.6 s (pdf-text) | 12.1 s | 1 |
| Same PDF, reprocessed | 3.4 s | 8.0 s | 4 |
| CSV, 216 B | 0 ms | 1.6 s | 1 |
| Markdown, 206 B | 0 ms | 1.1 s | 1 |
| Plain text, 195 B | 0 ms | 2.4 s | 3 |
| Blank PDF | 978 ms (OCR) | 7.2 s | 0 |

The blank PDF's 7.2 s probably includes loading the model into memory after idle time (not confirmed).

### Source files per step

Paths are under `apps/papra-server/src/modules/`.

| Step | File | Function or item |
| --- | --- | --- |
| Create and reprocess routes | `documents/documents.routes.ts` | Schedules `extract-document-file-content` (line 124); reprocess route flags, rate limit and 202 response |
| Create-document use case | `documents/documents.usecases.ts` | Schedules extraction (line 417); logs "Document created" |
| Extraction function | `documents/documents.usecases.ts` | `extractAndSaveDocumentFileContent` (line 591) |
| Events | `app/events/events.handlers.ts` †, `app/events/events.services.ts` †, `documents/documents.events.types.ts` † | Handler registry, `emitEvent`, payload types |
| Task registration | `tasks/tasks.definitions.ts` †, `tasks/tasks.services.ts` † | `registerExtractDocumentFileContentTask`, `registerEnrichDocumentTask`; `registerTask`, `scheduleJob` |
| Extraction job | `documents/tasks/extract-document-file-content.task.ts` | Runs the extraction function, then schedules `enrich-document` (line 62) if both AI flags are on |
| Text extraction | `documents/content-extraction/content-extraction.usecases.ts` † | Extractors `pdf:pdf-text`, `pdf:tesseract-js`, `text` |
| Documents settings | `documents/documents.config.ts` † | `DOCUMENTS_CONTENT_EXTRACTION_ENABLED`, `DOCUMENTS_OCR_LANGUAGES`, `DOCUMENT_REPROCESSING_ENABLED`, `DOCUMENT_REPROCESSING_RATE_LIMIT` |
| Tagging rules | `tagging-rules/tagging-rules.usecases.ts` | Rule matching, then `applyTagsToDocuments` (around line 155) |
| Enrichment job | `document-enrichment/tasks/enrich-document.task.ts` | `registerEnrichDocumentTask` |
| Orchestration | `document-enrichment/document-enrichment.usecases.ts` | `buildEnrichDocument` |
| Data loading | `documents/documents.repository.ts` †, `tags/tags.repository.ts` †, `organizations/organization-settings/organization-settings.usecases.ts` † | `getDocumentById`, `getOrganizationTags`, `createResolveOrganizationSettingsUsecase` |
| Prompt and post-processing | `auto-tagging/auto-tagging.usecases.ts`, `auto-tagging/auto-tagging.models.ts` | `buildPromptForAutoTagging`; `buildAutoTaggingSchema`, `buildAutoTaggingSystemPrompt`, `buildAutoTaggingUserPrompt`, `getTagsActions` |
| LLM call | `ai/ai.services.ts`, `ai/adapters/ai-adapters.usecases.ts` †, `ai/adapters/openai-compatible/` | `generateStructuredData`, `resolveTextAdapter`, the `ollama` provider entry; `chat` from `@tanstack/ai` |
| Config | `ai/ai.config.ts`, `auto-tagging/auto-tagging.config.ts` † | `AI_IS_ENABLED`, `AI_DEFAULT_MODEL`, `AUTO_TAGGING_ENABLED` |
| Apply | `auto-tagging/auto-tagging.usecases.ts`, `tags/tags.usecases.ts`, `tags/tags.repository.ts` † | `buildApplyAutoTaggingActions`, `createTag`, `applyTagsToDocuments`, batch add/remove methods |
| Tag-change handlers | `documents/events/webhooks.document-tags-changed.ts` †, `documents/events/activity-log.document-tags-changed.ts` † | Trigger webhooks, write activity-log entries |

### Known gaps and potential next steps

1. **Blank documents still reach the model.** Extraction saves empty text, and enrichment is scheduled regardless. Guard in `buildEnrichDocument` (testable with a fake prompt function); the alternative is checking the returned document in the extraction task.
2. **Near-duplicate tags.** New tag names aren't matched to existing ones, so "fakeInvoice" was created next to "Invoice". Fix in `getTagsActions` (a pure function): compare names ignoring case and spacing, map matches to existing IDs, and drop duplicates and empty names.
3. **Silent failures.** Failed tag creations in `buildApplyAutoTaggingActions` are dropped without a log line.
4. **Untruncated prompts.** `buildAutoTaggingUserPrompt` sends the whole extracted text.
5. **`maxTags` is per response.** Reprocessing can add more tags over time; nothing caps a document's total.
6. **Reprocess ignores the extraction switch.** Within the lines read, the reprocess route does not check `isContentExtractionEnabled`; upload does.
