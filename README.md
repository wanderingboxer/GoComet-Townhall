# GoComet Townhall

A real-time multiplayer quiz platform (Kahoot-style) built with React, Express, WebSockets, and PostgreSQL. Hosts create quizzes and run live game sessions; players join on their phones using a 6-character game code or QR scan, answer questions in real time, and compete on a live leaderboard.

It also includes a standalone **Live Q&A** feature — an anonymous audience Q&A system that works independently of any quiz game.

---

## Features

### Quiz & Game
- **Quiz editor** — create and edit quizzes with multiple-choice questions; configure per-question time limits and point values
- **Host console** — start a game, display a QR code lobby, advance questions, and see live answers come in
- **Player experience** — join by game code, see the question on your own device, pick an answer, and get instant score feedback
- **Live leaderboard** — ranked scoreboard shown after every question; podium celebration at the end
- **Reconnect support** — players who drop mid-game rejoin seamlessly using their stored player ID

### Live Q&A
- Audience members ask anonymous questions without needing a game code
- Host answers questions privately first, then chooses to publish to all viewers
- Rate-limited per client (5 unanswered questions max) to prevent spam
- Auto-purges questions older than 24 hours; stores up to 500 live

### Developer Tooling
- **Load test script** — simulates 200 concurrent players through a full game, measuring broadcast latency, score-update delivery rate, and score accuracy
- **OpenAPI spec** with auto-generated React Query hooks and Zod validators
- **Drizzle ORM** schema push for zero-friction local development

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite 7, Tailwind CSS 4, shadcn/ui, Framer Motion |
| Routing | Wouter |
| Data fetching | TanStack Query v5 (React Query) |
| Forms & validation | React Hook Form + Zod |
| Backend | Express 5, Node.js |
| Real-time | WebSockets (`ws` library) |
| Database | PostgreSQL + Drizzle ORM |
| Logging | Pino |
| Language | TypeScript |
| Build (backend) | esbuild |
| Monorepo | pnpm workspaces |

---

## Project Structure

```
GoComet-Townhall/
├── artifacts/
│   ├── api-server/           # Express + WebSocket server (port 3000)
│   └── kahoot-clone/         # React frontend (port 5173)
│       └── scripts/
│           └── stress-test.mjs   # 200-player load test
├── lib/
│   ├── db/                   # Drizzle ORM schema + migrations
│   ├── api-spec/             # OpenAPI 3.0 spec + codegen
│   ├── api-client-react/     # Generated React Query hooks
│   └── api-zod/              # Generated Zod validators
├── .env.example
├── render.yaml               # Render.com deployment config
└── pnpm-workspace.yaml
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm (`npm install -g pnpm`)
- PostgreSQL database

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in the required values:

```env
# Required
DATABASE_URL=postgresql://user:password@localhost:5432/quizmaster
SESSION_SECRET=any-random-string-here

# Optional — defaults shown
HOST_ACCESS_CODE=change-me        # Password to access host features
PORT=3000                         # Backend port
LOG_LEVEL=info                    # trace | debug | info | warn | error
NODE_ENV=development
```

### 3. Push the database schema

```bash
pnpm --filter @workspace/db run push
```

### 4. Start the development servers

```bash
# Terminal 1 — backend (port 3000)
pnpm --filter @workspace/api-server run dev

# Terminal 2 — frontend (port 5173)
pnpm --filter @workspace/kahoot-clone run dev
```

Open [http://localhost:5173](http://localhost:5173).

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `SESSION_SECRET` | Yes | — | Signs session cookies |
| `HOST_ACCESS_CODE` | No | *(any)* | Password for host features |
| `PORT` | No | `3000` | Backend server port |
| `NODE_ENV` | No | `development` | `development` or `production` |
| `LOG_LEVEL` | No | `info` | Pino log level |
| `ALLOWED_ORIGIN` | No | `http://localhost:5173` | CORS allowed origin |
| `VITE_API_ORIGIN` | No | *(same host)* | Frontend → backend URL override |

---

## Usage

### Hosting a game

1. Navigate to the app and enter your `HOST_ACCESS_CODE`
2. Go to **Dashboard** → create a new quiz and add questions
3. Click **Start Game** → share the 6-character code or QR code with players
4. Advance through questions and watch the live scoreboard

### Joining as a player

1. Open the app on any device (no account needed)
2. Enter your nickname and the game code
3. Answer questions as they appear — your score updates in real time

### Live Q&A (no game required)

- Audience: navigate to `/live-qa`, type a question, submit
- Host: log in with `HOST_ACCESS_CODE`, answer privately, then publish to all viewers

---

## Running the Load Test

The stress test script spins up `PLAYER_COUNT` WebSocket clients (default 200), runs them through a complete quiz game, and prints a detailed report.

**Requirements:** server must be running before you start the test.

```bash
HOST_ACCESS_CODE=<your-code> node artifacts/kahoot-clone/scripts/stress-test.mjs
```

Optional environment variables:

| Variable | Default | Description |
|---|---|---|
| `SERVER_URL` | `http://localhost:3000` | Backend URL |
| `HOST_ACCESS_CODE` | `test123` | Host password |
| `PLAYER_COUNT` | `200` | Number of simulated players |
| `BATCH_SIZE` | `20` | Connections opened per batch |
| `BATCH_DELAY_MS` | `50` | Milliseconds between batches |

Example output:

```
├─ CONNECTIONS
│  Attempted : 200  |  OK : 200  |  Failed : 0
├─ JOIN
│  OK : 200  |  Latency (ms): min=2 p50=16 p95=37 p99=43 max=45
├─ QUESTION 1
│  question_started received : 200/200
│  score_update MISSING      : 0
│  Submit→score latency (ms) : min=1 p50=2 p95=5 p99=6 max=8
└─ VERDICT
   ✓ No errors detected — server handled all players cleanly.
```

---

## Deployment

The project includes a `render.yaml` for one-click deployment to [Render](https://render.com).

### Services deployed

| Service | Type | Notes |
|---|---|---|
| `quiz-hub-backend` | Node.js web service | Express + WebSocket server |
| `quiz-hub-frontend` | Static site | React SPA |

### Steps

1. Push the repo to GitHub
2. In Render, create a new **Blueprint** and connect the repo
3. Render will detect `render.yaml` and provision both services automatically
4. Set the following secret environment variables in Render's dashboard:
   - `DATABASE_URL` — your PostgreSQL connection string
   - `HOST_ACCESS_CODE` — password for host access
5. After the first deploy, run the schema migration once (or add it to the build command)

> **Note:** If you rename the backend service, update `VITE_API_ORIGIN` in `render.yaml` to match the new URL.

---

## API Reference

The backend exposes a REST API (all routes prefixed `/api`) and a WebSocket endpoint at `/api/ws`.

### REST

| Method | Path | Description |
|---|---|---|
| `GET` | `/healthz` | Health check |
| `GET` | `/api/quizzes` | List all quizzes |
| `POST` | `/api/quizzes` | Create a quiz |
| `GET` | `/api/quizzes/:id` | Get quiz with questions |
| `PATCH` | `/api/quizzes/:id` | Update quiz |
| `DELETE` | `/api/quizzes/:id` | Delete quiz |
| `POST` | `/api/quizzes/:id/questions` | Add a question |
| `PATCH` | `/api/questions/:id` | Update a question |
| `DELETE` | `/api/questions/:id` | Delete a question |
| `POST` | `/api/games` | Create a game |
| `GET` | `/api/games/:gameCode` | Get game status |
| `GET` | `/api/games/:gameCode/results` | Final results |

Host endpoints require either an `X-Host-Access-Code` header or a valid session cookie.

### WebSocket messages (key events)

| Direction | Type | Description |
|---|---|---|
| Client → Server | `player_join` | Join a game with nickname + game code |
| Client → Server | `submit_answer` | Submit answer for current question |
| Client → Server | `host_join` | Host connects to a game |
| Client → Server | `start_game` | Host starts the game |
| Client → Server | `next_question` | Host advances to next question |
| Client → Server | `end_question` | Host ends the current question early |
| Server → Client | `question_started` | New question broadcast to all players |
| Server → Client | `score_update` | Individual score + rank after answering |
| Server → Client | `question_ended` | Correct answer + leaderboard |
| Server → Client | `game_ended` | Game is over |

Full OpenAPI spec is at [`lib/api-spec/openapi.yaml`](lib/api-spec/openapi.yaml).

---

## Regenerating API Client Code

If you change the OpenAPI spec, regenerate the client hooks and validators:

```bash
pnpm --filter @workspace/api-spec run codegen
```

This updates `lib/api-client-react/` and `lib/api-zod/` automatically.

---

## License

MIT
