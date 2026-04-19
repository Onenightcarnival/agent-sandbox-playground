# Agent Sandbox Playground

A browser-only playground for authoring and debugging custom LLM skills, structured around a deliberate **generic-MCP + business-layer-glue** split.

## Why this exists

Most skill-testing setups bake "skills" into the runtime: a single sandbox preloads the files and the system prompt narrates what's there. That works, but it hides the boundaries you'll actually have in production — where the sandbox service is a generic container that doesn't know what a "skill" is, and the business code is responsible for deploying files and prompting the model about them.

This project reproduces that split in a single browser tab so you can debug skills against the same boundaries a real deployment has, without running any infrastructure.

## Design

```
┌────────────────── Playground (React) ─ the "business container" ──┐
│                                                                   │
│  Editor state (skills) ───► System-prompt glue                    │
│         │                   (maps "skill" vocabulary              │
│         │                    onto the tools below)                │
│         ▼                                                         │
│       fs MCP          sandbox MCP             Agent loop          │
│   (read-only)         (Pyodide workspace)          │              │
│   list_files          shell / list_files           │              │
│   read_file           read_file / write_file       │              │
│         ▲                         ▲                │              │
│         └─────────────────────────┴────────────────┘              │
│                     InMemoryTransport                             │
└───────────────────────────────────────────────────────────────────┘
```

Three design decisions drive everything else:

1. **Two generic MCP servers, not one skill-aware one.**
   - `fs` is a read-only filesystem (backed by the editor). Analog: an S3 bucket / git repo / skill registry.
   - `sandbox` is an empty ephemeral Pyodide workspace with shell + FS tools. Analog: a Docker container.
   - Neither exposes the word "skill" in any tool description or server instruction — both could be swapped for remote, production implementations without changing the agent.

2. **No pre-loading; the agent stages files itself.** `/workspace` starts empty. The agent has to discover the skill via `fs.list_files`, read `SKILL.md`, copy source files into the sandbox via `sandbox.write_file`, and then run them. This is "Mode B" — discovery-based invocation. It stress-tests whether your SKILL.md is actually self-describing.

3. **Domain vocabulary lives in the business layer, not in the MCPs.** The Playground injects a short prompt fragment teaching the LLM to map user phrasing like *"using the X skill"* onto the generic tools. This is the piece that's specific to your product; the MCPs remain reusable.

The agent loop discovers tools across any number of named MCP clients (`fs__*`, `sandbox__*`), automatically folds each server's self-reported `instructions` into the system prompt, and renders prompt-mode docs dynamically from the live tool list — so adding a third MCP (e.g. a web-fetch MCP) is a single file drop-in with no loop changes.

## Running it

```bash
npm install
npm run dev
```

Open the app, click **Edit ▾** in the top bar, fill in Base URL / API Key / Model for any OpenAI-compatible endpoint. Values are cached in `localStorage`.

Upload a skill zip (start with `examples/unit-converter.zip`), then try two prompts to see the split in action:

- `Using the unit-converter skill, what is 100 Fahrenheit in Celsius?` — agent walks the MCPs and returns **37.95** (the calibrated value produced by actually running the code).
- `What is 100 Fahrenheit in Celsius?` — agent answers directly from its head: **37.78**.

The `unit-converter` example deliberately applies a `calibration.json` offset of 0.17 so textbook conversion (37.78) and executed conversion (37.95) don't match — a shortcut where the LLM reads source instead of running it would produce the wrong number and fail the test.

### Optional: pre-populate config from `.env.local`

```
# .env.local (gitignored)
VITE_OPENAI_BASE_URL=https://openrouter.ai/api/v1
VITE_OPENAI_API_KEY=sk-...
VITE_OPENAI_MODEL_ID=openai/gpt-5-nano
```

Only used when there's nothing in `localStorage` yet.

### Internal-network deployment

If your LLM gateway blocks browser CORS:

```bash
cp .env.example .env
# edit .env: API_TARGET=https://your-llm-gateway
npm run build
npm run serve
```

Set the UI Base URL to `/api/v1`; the node server serves the static bundle and proxies `/api/*` to `API_TARGET`.

## Skill zip format

```
my-skill/
├── SKILL.md             # Required; YAML frontmatter (name, description) + human instructions
├── main.py              # Python implementation
├── utils.py             # Extra modules, importable
├── calibration.json     # Arbitrary data files are allowed
└── requirements.txt     # Optional pip deps, installed via micropip
```

Any text-like file (`.py .json .yaml .toml .ini .md .txt .csv ...`) is loaded; binary files and `__pycache__/` are ignored.

## Tech stack

- Vite + React 18 (TypeScript), deployed static to GitHub Pages
- Pyodide in a Web Worker for in-browser Python
- `@modelcontextprotocol/sdk` with `InMemoryTransport` for the two MCP server/client pairs (browser-safe subpath imports, no stdio)
- OpenAI JS SDK in browser mode
- CodeMirror 6

## Deployment

- **GitHub Pages**: built and deployed on push to `main` via GitHub Actions.
- **Internal / self-hosted**: `npm run serve` for static bundle + `/api/*` proxy on one port.
