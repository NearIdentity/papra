# Papra: agent notes

Verified against upstream commit 93a569f (fork `aa-live-coding` adds docs and agent files, and may add other code updates at a later time). Items marked (unverified) were inferred; confirm in the code before relying on them. Update this file when you correct the agent twice about the same thing.

## Stack and layout
- pnpm monorepo. Server: `apps/papra-server` (Hono, Drizzle + libSQL/SQLite, Better Auth, Valibot, CadenceMQ jobs; port 1221). Client: `apps/papra-client` (SolidJS, UnoCSS, Shadcn Solid; port 3000). Shared packages: `packages/{std,search-parser,lecture,webhooks}`. Docs: `apps/docs` (Astro Starlight).
- Pinned toolchain: Node 26.12.1, pnpm 12.4.2, TypeScript 7. Node 26 is required: the server uses the global `Temporal`, and Node 24 fails with "Temporal is not defined".

## Run
1. `pnpm install && pnpm build:packages` (once, and after switching commits).
2. Server: `cd apps/papra-server && pnpm migrate:up && pnpm dev`.
3. Client: `cd apps/papra-client && pnpm dev`, then open http://localhost:3000.
- Port 3000 must be free. If the client lands on 3001, login fails with "Invalid callbackURL".
- After switching commits or branches: `pnpm dev:reset` in `apps/papra-server` (wipes local data).
- Local AI (put in `apps/papra-server/.env`, then restart the server): `AI_IS_ENABLED=true`, `AUTO_TAGGING_ENABLED=true`, `AI_DEFAULT_MODEL=<adapterId>://<model>` (for example `ollama://llama3.1:8b`; `AUTO_TAGGING_MODEL` also works). Ollama needs no other variables (defaults: `OLLAMA_BASE_URL=http://localhost:11434/v1`, key `ollama`; other OpenAI-compatible adapters use `<PREFIX>_BASE_URL` and `<PREFIX>_API_KEY`). Auto-tagging also needs the organization setting `ai.autoTagging.isEnabled` switched on in the client. The job is registered only if both server flags are true.
- Test data: the "Devtools" button in the client (`apps/papra-client/src/modules/devtools`) generates fake documents.

## Verify before declaring done
- Server (in `apps/papra-server`): `pnpm test:unit` and `pnpm typecheck`.
- Root: `pnpm check` (oxlint + oxfmt; not ESLint, whatever CONTRIBUTING.md says). `pnpm check:fix` to fix.
- Skip `*.int.test.ts` (needs Docker/Testcontainers) unless asked.
- Migrations: `pnpm migrate:create <name>`, then `pnpm migrate:up`. Never edit applied migrations.

## Module layout (reference module: `src/modules/tags`)
`<name>.table.ts`, `.repository.ts`, `.usecases.ts`, `.api.contracts.ts`, `.api.routes.ts`, `.schemas.ts`, `.errors.ts`, `.config.ts`, each with a colocated `.test.ts`. Read the neighboring module before writing a new one, and copy its test style.

## Conventions
- Routes: `setupXRoute(deps)` returns `defineApiRoute({ contract, resolveContext: resolveAuthenticationContext({ apiKeyPermissions }), handler })`. Call `ensureUserIsInOrganization` first; load documents and tags scoped by `organizationId`; return `{ status, contentType, body }` with dates as ISO strings. New endpoints use the typed-contract style (see tags).
- Use cases: async functions with one named-args object (data first, blank line, then dependencies). Errors via `createXError()` factories in `<module>.errors.ts`. Limits live in `<module>.config.ts`. Logging: `logger.info({ ...context }, 'message')`.
- Dependencies are injected. Either whole repositories or narrow `Pick<Repo, 'method'>` types; match the file you are editing. Builders look like `buildX({ deps }) => async (args) => ...`.
- Config settings declare `doc`, a Valibot `schema`, an `env` name and a `default`.
- Style: functional; single quotes, semicolons, 2 spaces, trailing commas; `import type` for types; business-named tests (no `it('should return true')`).
- UI strings: `apps/papra-client/src/locales/en.dictionary.ts` (English is the fallback).
- Solid is not React: signals and resources; components run once; no hook patterns.

## Domain notes
- Tag changes. Batch path: `applyTagsToDocuments` emits `document.tags.changed`; handlers registered in `modules/app/events/events.handlers.ts` write the activity log and trigger webhooks. Single-document add/remove routes call `deferTriggerWebhooks` and `deferRegisterDocumentActivityLog` directly. Do not emit the event and keep the inline calls, or every webhook and log entry fires twice.
- Callers of `applyTagsToDocuments`: `tagDocumentsBatch` (targets resolved via `resolveBatchTargetDocumentIds` with `organizationId`; explicit-ID branch unverified), tagging rules, and auto-tagging.
- Organization scoping: always filter by `organizationId`, and verify that document and tag ids belong to it before mutating.
- AI: every LLM call goes through `aiServices.generateStructuredData({ modelId, schema (Valibot), systemPrompt, userPrompt, source, organizationId })`. Tests fake it; never call a real model. Credits are off unless `AI_CREDITS_IS_ENABLED`.
- Enrichment (this commit): `registerEnrichDocumentTask` in `document-enrichment/tasks/enrich-document.task.ts` registers the job only if `config.ai.isEnabled && config.autoTagging.isEnabled`. `buildEnrichDocument` (document-enrichment) skips when auto-tagging is disabled for the organization, then calls the injected `promptForAutoTagging` and `applyAutoTaggingActions` from `modules/auto-tagging`. Fake those two in tests. Empty-content handling is unverified.

## Working rules
1. Restate the task, then give a short plan before editing.
2. Read the reference module and the nearest tests first.
3. Make the smallest change that works, layer by layer (table and migration, repository, use case, contract, route, client), adding or updating tests at each layer touched.
4. Run the verify commands. Report failures instead of hiding them.
5. Do not touch unrelated files, bump dependencies, reformat code you did not change, or commit unless asked.
6. If the task is ambiguous or touches auth, organization scoping or migrations, stop and ask.
