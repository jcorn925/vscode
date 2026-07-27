# Langfuse Observability

Babadaba can mirror sanitized Custom AI trace events to Langfuse while continuing to write local JSONL traces under `.agent/observability/custom-ai-chat.jsonl`.
The Langfuse export uses a trace + observation hierarchy so model rounds and tool calls are visible as first-class observations.

## Start Langfuse Locally

```bash
cd infra/langfuse
cp .env.example .env
docker compose up -d
```

Open `http://localhost:3000` and sign in with the local user configured in `infra/langfuse/.env`.

The checked-in `.env.example` seeds a local `Babadaba` project with deterministic development keys:

```bash
LANGFUSE_PUBLIC_KEY=pk-lf-babadaba-local
LANGFUSE_SECRET_KEY=sk-lf-babadaba-local
LANGFUSE_BASE_URL=http://localhost:3000
```

For any shared or production instance, replace every placeholder secret in `.env`.

If you already run Redis locally, the compose file defaults the host Redis port to `16379` while still using `6379` inside the Docker network. Other exposed host ports can be changed in `infra/langfuse/.env`.

## Enable Babadaba Export

Launch the workbench with Langfuse credentials in the process environment:

```bash
export LANGFUSE_PUBLIC_KEY=pk-lf-babadaba-local
export LANGFUSE_SECRET_KEY=sk-lf-babadaba-local
export LANGFUSE_BASE_URL=http://localhost:3000
```

Then enable this setting:

```json
{
	"custom.ai.observability.langfuse.enabled": true,
	"custom.ai.observability.langfuse.environment": "local"
}
```

`LANGFUSE_BASE_URL` may also be set through `custom.ai.observability.langfuse.baseUrl`. Public and secret keys are intentionally environment-only so secrets do not get saved to VS Code settings.

## What Gets Traced

The integration exports the same sanitized events as the local JSONL trace stream and maps them to Langfuse-native objects:

- `trace-create` for request lifecycle plus upserts for trace input/output summaries
- `generation-create` for each `chat.model.request.completed` round (name: `chat.model.request`)
- `span-create` / `span-update` pairs for tool call lifecycle (`chat.tool_call.*`)
- `event-create` for the original sanitized event stream (for raw timeline debugging)
- `editFile` start, direct writes, review proposals, and validation failures
- `verifySurfaceBlueprint` completion with pass/fail and gap count

Trace/session metadata is populated with best-practice defaults:

- trace name: `goal-workspace.custom-ai.chat`
- session id: prefers `sessionResource` (falls back to request id)
- tags: `goal-workspace`, `custom-ai`, and model tag when available (`model:<id>`)

Successful chat completions and surface-blueprint verification results are attached as Langfuse boolean scores.

## Dogfood Acceptance Check

Run a surface creation flow and confirm Langfuse shows one trace named `goal-workspace.custom-ai.chat` with:

- `edit_file.direct_write` events for generated files
- `verify_surface_blueprint.completed`
- a `surface-blueprint.verified` score
- no raw API keys or long prompt bodies unless `custom.ai.observability.includeContent` is explicitly enabled

Langfuse's self-hosting docs are at https://langfuse.com/self-hosting/deployment/docker-compose.
