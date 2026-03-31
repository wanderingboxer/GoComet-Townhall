# QuizBlast - Kahoot Clone

A full-featured real-time multiplayer quiz game (Kahoot clone) built with React, Express, WebSockets, and PostgreSQL.

## Architecture

This is a **pnpm monorepo** with the following packages:

### Artifacts
- **`artifacts/kahoot-clone`** — React + Vite frontend, served on port 22993 in dev, previewed at `/`
- **`artifacts/api-server`** — Express 5 API server with WebSocket support, runs on port 3000 in dev
- **`artifacts/mockup-sandbox`** — UI prototyping sandbox

### Shared Libraries
- **`lib/api-spec`** — OpenAPI specification (`openapi.yaml`) + Orval codegen config
- **`lib/api-client-react`** — Generated React Query hooks from OpenAPI spec
- **`lib/api-zod`** — Generated Zod schemas from OpenAPI spec
- **`lib/db`** — Drizzle ORM schema + PostgreSQL connection

## Tech Stack

- **Frontend**: React 19, Vite 7, Tailwind CSS 4, shadcn/ui (Radix UI), Framer Motion, Wouter (routing)
- **Backend**: Express 5, `ws` WebSockets, Pino logger
- **Database**: PostgreSQL with Drizzle ORM
- **API**: OpenAPI spec → Orval codegen → React Query hooks + Zod schemas

## Key Features

- Quiz creation and management dashboard
- Real-time multiplayer game hosting via WebSockets
- Player join flow using 6-character game codes
- Live scoreboard and answer tracking
- Q&A system during games

## Running the Project

The "Start application" workflow runs both services in parallel:
```
pnpm --filter @workspace/api-server run dev & PORT=22993 pnpm --filter @workspace/kahoot-clone run dev
```

Vite proxies all `/api` requests to the Express server at `http://localhost:3000`.

## Environment Variables

Secrets (managed by Replit):
- `DATABASE_URL` — PostgreSQL connection string (auto-provisioned)
- `SESSION_SECRET` — Session signing secret

Env vars (shared):
- `LOG_LEVEL` — Logging level (default: `info`)
- `NODE_ENV` — Environment (default: `development`)
- `HOST_ACCESS_CODE` — Access code required to host games

## Database

Uses Replit's built-in PostgreSQL. Schema is managed by Drizzle ORM.

To push schema changes:
```
pnpm --filter @workspace/db run push
```

## API Codegen

After modifying `lib/api-spec/openapi.yaml`, regenerate clients:
```
pnpm --filter @workspace/api-spec run codegen
```
