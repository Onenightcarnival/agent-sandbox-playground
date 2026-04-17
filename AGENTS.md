# Agent Sandbox Playground

## Overview
Browser-based playground for debugging custom OpenAI-format skills. Users write Python code + SKILL.md, test via chat with LLM.

## Tech Stack
- **Frontend**: Vite + React 18 (TypeScript) + GitHub Pages
- **Python Sandbox**: Pyodide (WASM) in Web Worker
- **LLM Client**: OpenAI JS SDK (browser-side, `dangerouslyAllowBrowser: true`)
- **Code Editor**: CodeMirror 6
- **Node**: v25.8.0 via Homebrew (`/opt/homebrew/bin/node`)

## Architecture
- React handles UI; agent loop lives in `src/agent/loop.ts` (framework-agnostic TS)
- Pyodide sandbox (`src/sandbox/`) executes user Python code in a Web Worker
- SKILL.md content injected into system prompt for LLM to understand available tools
- No prescribed Python code format — LLM interprets SKILL.md to decide how to call functions
- Common Python packages (requests, httpx) available via micropip

## Project Structure
- `index.html` — Vite entry
- `src/main.tsx` + `src/App.tsx` — React mount + app shell
- `src/components/` — React components (one `.tsx` + one `.css` per component)
- `src/agent/` — OpenAI client and agent loop
- `src/sandbox/` — Pyodide Web Worker and manager
- `src/hooks/` — React hooks (theme context)
- `src/styles/cosmic.css` — global theme tokens

## Commands
- `npm run dev` — Start Vite dev server
- `npm run build` — Build static site (output: `dist/`)
- `npm run preview` — Preview production build
- `npm run serve` — Serve built `dist/` + proxy `/api/*` to `API_TARGET`

## Deployment
- GitHub Actions on push to main → build → deploy to GitHub Pages
- Pages base path: `/agent-sandbox-playground/` (set in `vite.config.ts`)
