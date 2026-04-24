# Repository Guidelines

## Project Structure & Module Organization
`app/` is the main package. Use `app/server/` for the Express API, WebSocket handling, agent execution, and route modules; use `app/client/` for the React control panel; keep desktop entry code in `app/electron/`; keep packaging helpers in `app/scripts/`. Server tests live in `app/server/__tests__/`. Runtime data lands in `memory/` and `workspace/`. Agent definitions, hooks, and skills live under `.claude/`, while `.mcp.json` tracks MCP server configuration. Treat `app/dist/` and `app/release/` as generated output unless you are intentionally shipping artifacts.

## Build, Test, and Development Commands
Run all app commands from `app/`:

- `npm install`: install dependencies.
- `npm run dev`: start the server on `127.0.0.1:3456`.
- `npm run dev:client`: run the Vite client only.
- `npm run dev:all`: watch server and client together.
- `npm run build`: create the production web bundle.
- `npm test`: run the Vitest suite once.
- `npm run test:coverage`: run tests with coverage output.
- `npm run electron:dev` or `npm run electron:build:mac|win|linux`: run or package the desktop app.

## Coding Style & Naming Conventions
Use TypeScript with strict mode and ES modules. Match the surrounding file style; current source uses 2-space indentation, small focused modules, and React function components. Prefer PascalCase for React components such as `SettingsPage.tsx`, and kebab-case for backend modules such as `scheduled-tasks.ts` and `vector-memory.ts`. Keep `app/server/index.ts` as assembly code; move new domain logic into routes, helpers, or executor modules instead of expanding the entrypoint.

## Testing Guidelines
Vitest is configured to discover `**/*.test.ts` and run in a single fork because tests share a temporary SQLite-backed HOME. Add new backend tests in `app/server/__tests__/` or beside the module when that keeps context clear. Name tests by behavior, for example `scheduler.test.ts`, and cover success paths, failure paths, and persistence side effects. Run `npm test` before opening a PR; use `npm run test:coverage` for larger refactors.

## Commit & Pull Request Guidelines
Recent history uses Conventional Commits such as `feat:` and `fix:`. Keep commit subjects imperative and scoped when useful, for example `feat: add goal execution route`. Pull requests should include a short summary, linked issue or task, the commands you ran to validate the change, and screenshots for UI updates. Call out edits to `.claude/`, `.mcp.json`, secrets handling, or migration scripts explicitly because they affect runtime behavior beyond the web UI.
