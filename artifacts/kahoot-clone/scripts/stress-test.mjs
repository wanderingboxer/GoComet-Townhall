/**
 * Stress test: simulate N players taking a quiz simultaneously.
 *
 * Usage:
 *   node artifacts/kahoot-clone/scripts/stress-test.mjs
 *
 * Env vars (all optional):
 *   SERVER_URL        default: http://localhost:3001
 *   HOST_ACCESS_CODE  default: test123
 *   PLAYER_COUNT      default: 200
 *   BATCH_SIZE        default: 20   (players connected per batch)
 *   BATCH_DELAY_MS    default: 50   (ms between batches)
 */

// Uses Node 22's built-in WebSocket (no import needed — it's a global).
// Falls back to the ws package from the api-server node_modules if needed.

// ─── Config ────────────────────────────────────────────────────────────────

const SERVER_URL      = (process.env.SERVER_URL      || "http://localhost:3001").replace(/\/$/, "");
const HOST_ACCESS_CODE = process.env.HOST_ACCESS_CODE || "test123";
const PLAYER_COUNT    = parseInt(process.env.PLAYER_COUNT    || "200", 10);
const BATCH_SIZE      = parseInt(process.env.BATCH_SIZE      || "20",  10);
const BATCH_DELAY_MS  = parseInt(process.env.BATCH_DELAY_MS  || "50",  10);

const WS_URL = SERVER_URL.replace(/^http/, "ws") + "/api/ws";

// ─── Utilities ──────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function stats(arr) {
  if (!arr.length) return { min: 0, p50: 0, p95: 0, p99: 0, max: 0, mean: 0 };
  const s = [...arr].sort((a, b) => a - b);
  const mean = Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
  return {
    min:  s[0],
    p50:  percentile(s, 50),
    p95:  percentile(s, 95),
    p99:  percentile(s, 99),
    max:  s[s.length - 1],
    mean,
  };
}

async function httpGet(path, headers = {}) {
  const r = await fetch(`${SERVER_URL}${path}`, {
    headers: { "X-Host-Access-Code": HOST_ACCESS_CODE, "Accept": "application/json", ...headers },
  });
  if (!r.ok) throw new Error(`GET ${path} → ${r.status} ${await r.text()}`);
  return r.json();
}

async function httpPost(path, body, headers = {}) {
  const r = await fetch(`${SERVER_URL}${path}`, {
    method:  "POST",
    headers: {
      "Content-Type":    "application/json",
      "Accept":          "application/json",
      "X-Host-Access-Code": HOST_ACCESS_CODE,
      ...headers,
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`POST ${path} → ${r.status} ${await r.text()}`);
  return r.json();
}

// ─── WebSocket helper ───────────────────────────────────────────────────────

class WsClient {
  constructor(label) {
    this.label    = label;
    this.ws       = null;
    this.handlers = {};   // type → [ resolver ]
    this.errors   = [];
    this.closeCode = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      // Node 22 built-in WebSocket uses the browser-compatible API.
      const ws = new globalThis.WebSocket(WS_URL);
      this.ws = ws;

      ws.addEventListener("open", () => resolve());

      ws.addEventListener("error", (evt) => {
        const msg = evt.message ?? "WebSocket error";
        this.errors.push(msg);
        // Only reject if we haven't resolved yet (i.e., haven't opened)
        if (ws.readyState !== 1 /* OPEN */) reject(new Error(msg));
      });

      ws.addEventListener("close", (evt) => {
        this.closeCode = evt.code;
        for (const list of Object.values(this.handlers)) {
          for (const { reject: rej } of list) {
            rej(new Error(`WS closed (${evt.code}) while waiting for '${this.label}'`));
          }
        }
        this.handlers = {};
      });

      ws.addEventListener("message", (evt) => {
        let msg;
        try { msg = JSON.parse(evt.data); }
        catch { return; }
        const list = this.handlers[msg.type];
        if (list && list.length) {
          const { resolve: res } = list.shift();
          if (!list.length) delete this.handlers[msg.type];
          res(msg.payload);
        }
        if (msg.type === "error") {
          this.errors.push(msg.payload?.message ?? JSON.stringify(msg.payload));
        }
      });
    });
  }

  send(type, payload = {}) {
    if (this.ws?.readyState === 1 /* OPEN */) {
      this.ws.send(JSON.stringify({ type, payload }));
    }
  }

  /** Wait for the next message of the given type, with optional timeout. */
  waitFor(type, timeoutMs = 15_000) {
    return new Promise((resolve, reject) => {
      if (!this.handlers[type]) this.handlers[type] = [];
      const timer = setTimeout(() => {
        const list = this.handlers[type];
        if (list) {
          const idx = list.findIndex((e) => e.reject === reject);
          if (idx >= 0) list.splice(idx, 1);
        }
        reject(new Error(`Timeout (${timeoutMs}ms) waiting for '${type}' on ${this.label}`));
      }, timeoutMs);

      this.handlers[type].push({
        resolve: (payload) => { clearTimeout(timer); resolve(payload); },
        reject:  (err)     => { clearTimeout(timer); reject(err); },
      });
    });
  }

  close() {
    if (this.ws?.readyState === 1 /* OPEN */) this.ws.close();
  }
}

// ─── Metrics ────────────────────────────────────────────────────────────────

const m = {
  connOk:    0,
  connFail:  0,
  connErrors: [],

  joinOk:    0,
  joinFail:  0,
  joinErrors: [],
  joinLatencies: [],

  // Per question: { received, latencies, submitOk, noScoreUpdate, submitLatencies, scoreErrors }
  questions: [],

  wsErrors:    {},   // message → count
  closeCodes:  {},   // code → count

  duplicateNicknames: 0,

  scoreMismatches: [],
  finalResultsFetched: false,
};

function recordWsError(msg) {
  m.wsErrors[msg] = (m.wsErrors[msg] || 0) + 1;
}
function recordClose(code) {
  if (code !== 1000 && code !== undefined) {
    m.closeCodes[code] = (m.closeCodes[code] || 0) + 1;
  }
}

// ─── Phase 1: Setup ─────────────────────────────────────────────────────────

async function setupQuizAndGame() {
  console.log("\n══════════════════════════════════════════════");
  console.log("  STRESS TEST  —  " + PLAYER_COUNT + " concurrent players");
  console.log("══════════════════════════════════════════════\n");

  console.log("[ PRE-FLIGHT ] Checking server health …");
  await httpGet("/healthz").catch(() => { /* healthz returns HTML in some configs */ });

  console.log("[ SETUP ] Creating quiz …");
  const quiz = await httpPost("/api/quizzes", {
    title: `Stress Test Quiz ${Date.now()}`,
    description: "Auto-generated for load testing",
  });

  const questions = [
    { text: "What is 2 + 2?",           options: ["3", "4", "5", "6"],         correctOption: 1, timeLimit: 20, points: 1000, orderIndex: 0 },
    { text: "Capital of France?",        options: ["London", "Berlin", "Paris", "Rome"], correctOption: 2, timeLimit: 20, points: 1000, orderIndex: 1 },
    { text: "Which planet is largest?",  options: ["Earth", "Mars", "Saturn", "Jupiter"], correctOption: 3, timeLimit: 20, points: 1000, orderIndex: 2 },
  ];

  for (const q of questions) {
    await httpPost(`/api/quizzes/${quiz.id}/questions`, q);
  }
  console.log(`[ SETUP ] Quiz #${quiz.id} created with ${questions.length} questions.`);

  const game = await httpPost("/api/games", { quizId: quiz.id });
  console.log(`[ SETUP ] Game created — code: ${game.gameCode}\n`);

  return { quiz, game, questionCount: questions.length, questions };
}

// ─── Phase 2: Host connects ──────────────────────────────────────────────────

async function connectHost(gameCode) {
  const host = new WsClient("host");
  await host.connect();
  host.send("host_join", { gameCode, accessKey: HOST_ACCESS_CODE });
  await host.waitFor("host_joined", 8_000);
  console.log("[ HOST ] Connected and joined.\n");
  return host;
}

// ─── Phase 3: Players connect ────────────────────────────────────────────────

async function connectPlayers(gameCode) {
  console.log(`[ PLAYERS ] Connecting ${PLAYER_COUNT} players in batches of ${BATCH_SIZE} …`);
  const players = [];

  for (let i = 0; i < PLAYER_COUNT; i++) {
    const p = new WsClient(`player-${i}`);
    p.nickname   = `P${i}_${Math.random().toString(36).slice(2, 5)}`;
    p.playerId   = null;
    p.score      = 0;   // tracked locally
    p.joinedAt   = null;
    players.push(p);
  }

  const joinPromises = players.map(async (p, i) => {
    // Stagger: wait based on batch index
    const batchIndex = Math.floor(i / BATCH_SIZE);
    await sleep(batchIndex * BATCH_DELAY_MS);

    const connStart = Date.now();
    m.connOk + m.connFail; // touch to satisfy lint

    try {
      await p.connect();
      m.connOk++;
    } catch (err) {
      m.connFail++;
      m.connErrors.push(`player-${i}: ${err.message}`);
      recordWsError(err.message);
      return;
    }

    // Listen for errors in background
    p.ws.addEventListener("error", (evt) => {
      const msg = evt.message ?? "WebSocket error";
      p.errors.push(msg);
      recordWsError(msg);
    });
    p.ws.addEventListener("close", (evt) => recordClose(evt.code));

    const t0 = Date.now();
    p.send("player_join", { gameCode, nickname: p.nickname });

    try {
      const payload = await p.waitFor("joined", 12_000);
      p.playerId = payload.playerId;
      p.joined   = true;
      m.joinOk++;
      m.joinLatencies.push(Date.now() - t0);
    } catch (err) {
      m.joinFail++;
      const errMsg = p.errors.length ? p.errors[p.errors.length - 1] : err.message;
      m.joinErrors.push(`player-${i} (${p.nickname}): ${errMsg}`);
      if (errMsg && errMsg.toLowerCase().includes("nickname")) m.duplicateNicknames++;
    }
  });

  await Promise.all(joinPromises);

  const ok = players.filter((p) => p.joined).length;
  console.log(`[ PLAYERS ] ${ok}/${PLAYER_COUNT} joined successfully.\n`);
  return players;
}

// ─── Phase 4–6: Run game ─────────────────────────────────────────────────────

async function runGame(host, players, gameCode, questionCount, questionsData) {
  const joinedPlayers = players.filter((p) => p.joined);

  console.log("[ GAME ] Starting game …");
  host.send("start_game", {});
  await host.waitFor("game_started", 5_000);
  console.log("[ GAME ] game_started received by host.\n");

  for (let qIdx = 0; qIdx < questionCount; qIdx++) {
    const correctOption = questionsData[qIdx].correctOption;
    const qMetrics = {
      questionIndex:      qIdx,
      received:           0,
      broadcastLatencies: [],
      submitOk:           0,
      noScoreUpdate:      0,
      submitLatencies:    [],
      scoreErrors:        [],
    };
    m.questions.push(qMetrics);

    console.log(`[ Q${qIdx + 1}/${questionCount} ] Waiting for question_started broadcast …`);
    const t0 = Date.now();

    // IMPORTANT: register player waiters BEFORE triggering the question so we
    // don't miss the broadcast due to a race between send and handler setup.
    const qsPromises = joinedPlayers.map(async (p) => {
      try {
        await p.waitFor("question_started", 20_000);
        qMetrics.received++;
        qMetrics.broadcastLatencies.push(Date.now() - t0);
      } catch {
        // Player missed the broadcast
      }
    });

    // Also register host waiter before sending next_question
    const hostQsPromise = host.waitFor("question_started", 10_000).catch(() => {});

    if (qIdx === 0) {
      // Q1: server sends question_started 1.5s after start_game automatically.
    } else {
      // Q2+: send next_question now that all handlers are registered.
      host.send("next_question", {});
    }

    await hostQsPromise;
    await sleep(2_000);   // allow stragglers to receive broadcast
    await Promise.race([Promise.all(qsPromises), sleep(4_000)]);

    console.log(`         ${qMetrics.received}/${joinedPlayers.length} players received question_started.`);
    console.log(`         Broadcast latency — ${JSON.stringify(stats(qMetrics.broadcastLatencies))} ms`);

    // All players answer with random delay 200–2500ms and a random option choice
    console.log(`         Players answering …`);
    const answerPromises = joinedPlayers.map(async (p) => {
      if (!p.playerId) return;
      await sleep(200 + Math.random() * 2300);
      const selectedOption = Math.floor(Math.random() * 4);
      const timeToAnswer   = 500 + Math.floor(Math.random() * 4000);

      const tSubmit = Date.now();
      p.send("submit_answer", { questionIndex: qIdx, selectedOption, timeToAnswer });

      try {
        const scorePayload = await p.waitFor("score_update", 12_000);
        qMetrics.submitOk++;
        qMetrics.submitLatencies.push(Date.now() - tSubmit);
        p.score = scorePayload.score;
        if (selectedOption === correctOption && scorePayload.pointsEarned === 0) {
          qMetrics.scoreErrors.push(`player ${p.playerId}: correct answer but 0 pts`);
        }
      } catch (err) {
        qMetrics.noScoreUpdate++;
        qMetrics.scoreErrors.push(`player ${p.playerId}: ${err.message}`);
      }
    });

    await Promise.race([Promise.all(answerPromises), sleep(15_000)]);

    console.log(`         score_update: ${qMetrics.submitOk} received, ${qMetrics.noScoreUpdate} missing.`);
    if (qMetrics.submitLatencies.length) {
      console.log(`         Submit latency — ${JSON.stringify(stats(qMetrics.submitLatencies))} ms`);
    }
    if (qMetrics.scoreErrors.length) {
      console.log(`         Score errors (first 5): ${qMetrics.scoreErrors.slice(0, 5).join(" | ")}`);
    }

    // Host ends the question
    console.log(`         Host ending question …`);
    host.send("end_question", {});
    await host.waitFor("question_ended", 8_000).catch(() => {});
    await sleep(300);
    console.log();
  }

  // After the last question, send next_question to trigger game finalization.
  // The server calls finalizeGame() when isLastQuestion() is true.
  console.log("[ GAME ] Finalizing (sending next_question to trigger game_ended) …");
  host.send("next_question", {});
  await host.waitFor("game_ended", 10_000).catch((err) => {
    console.log(`[ WARN ] game_ended not received: ${err.message}`);
  });
  console.log("[ GAME ] Game complete.\n");
}

// ─── Phase 7: Verify final scores ────────────────────────────────────────────

async function verifyScores(gameCode, players) {
  console.log("[ RESULTS ] Fetching final results from API …");
  try {
    const results = await httpGet(`/api/games/${gameCode}/results`);
    m.finalResultsFetched = true;

    const byId = new Map(results.players.map((p) => [p.playerId, p.score]));
    for (const p of players.filter((pl) => pl.joined && pl.playerId)) {
      const apiScore = byId.get(p.playerId);
      if (apiScore === undefined) {
        m.scoreMismatches.push(`player ${p.playerId} (${p.nickname}): not in results`);
      } else if (apiScore !== p.score) {
        m.scoreMismatches.push(
          `player ${p.playerId} (${p.nickname}): expected ${p.score} but API says ${apiScore}`
        );
      }
    }
    console.log(`[ RESULTS ] ${results.players.length} players in final results.\n`);
  } catch (err) {
    console.log(`[ WARN ] Could not fetch results: ${err.message}\n`);
  }
}

// ─── Phase 8: Report ─────────────────────────────────────────────────────────

function printReport(players) {
  const bar = "═".repeat(54);
  console.log(`\n${bar}`);
  console.log("  STRESS TEST REPORT");
  console.log(bar);

  // Connections
  console.log("\n┌─ CONNECTIONS");
  console.log(`│  Attempted : ${PLAYER_COUNT}`);
  console.log(`│  OK        : ${m.connOk}`);
  console.log(`│  Failed    : ${m.connFail}`);
  if (m.connErrors.length) {
    console.log(`│  Errors (first 5):`);
    m.connErrors.slice(0, 5).forEach((e) => console.log(`│    • ${e}`));
  }

  // Joins
  console.log("\n├─ JOIN");
  console.log(`│  OK       : ${m.joinOk}`);
  console.log(`│  Failed   : ${m.joinFail}`);
  console.log(`│  Duplicate nickname errors : ${m.duplicateNicknames}`);
  if (m.joinErrors.length) {
    console.log(`│  Errors (first 5):`);
    m.joinErrors.slice(0, 5).forEach((e) => console.log(`│    • ${e}`));
  }
  if (m.joinLatencies.length) {
    const js = stats(m.joinLatencies);
    console.log(`│  Latency (ms): min=${js.min} p50=${js.p50} p95=${js.p95} p99=${js.p99} max=${js.max} mean=${js.mean}`);
  }

  // Per-question
  for (const q of m.questions) {
    const bcast = stats(q.broadcastLatencies);
    const sub   = stats(q.submitLatencies);
    console.log(`\n├─ QUESTION ${q.questionIndex + 1}`);
    console.log(`│  question_started received : ${q.received}/${m.joinOk}`);
    console.log(`│  Broadcast latency (ms)    : min=${bcast.min} p50=${bcast.p50} p95=${bcast.p95} p99=${bcast.p99} max=${bcast.max}`);
    console.log(`│  score_update received     : ${q.submitOk}/${m.joinOk}`);
    console.log(`│  score_update MISSING      : ${q.noScoreUpdate}  ← ${q.noScoreUpdate > 0 ? "POTENTIAL DB POOL EXHAUSTION" : "none"}`);
    if (q.submitLatencies.length) {
      console.log(`│  Submit→score latency (ms) : min=${sub.min} p50=${sub.p50} p95=${sub.p95} p99=${sub.p99} max=${sub.max}`);
    }
    if (q.scoreErrors.length) {
      console.log(`│  Score errors (${q.scoreErrors.length} total, first 5):`);
      q.scoreErrors.slice(0, 5).forEach((e) => console.log(`│    • ${e}`));
    }
  }

  // WebSocket errors / closes
  const wsErrCount = Object.values(m.wsErrors).reduce((a, b) => a + b, 0);
  const closeCount = Object.values(m.closeCodes).reduce((a, b) => a + b, 0);
  console.log("\n├─ WEBSOCKET ERRORS");
  console.log(`│  Total WS error events       : ${wsErrCount}`);
  if (wsErrCount) {
    for (const [msg, cnt] of Object.entries(m.wsErrors)) {
      console.log(`│    [${cnt}x] ${msg}`);
    }
  }
  console.log(`│  Unexpected close codes      : ${closeCount}`);
  if (closeCount) {
    for (const [code, cnt] of Object.entries(m.closeCodes)) {
      console.log(`│    code ${code}: ${cnt}x`);
    }
  }

  // Final score verification
  console.log("\n├─ FINAL SCORE VERIFICATION");
  console.log(`│  Results fetched from API    : ${m.finalResultsFetched}`);
  console.log(`│  Score mismatches            : ${m.scoreMismatches.length}`);
  if (m.scoreMismatches.length) {
    m.scoreMismatches.slice(0, 10).forEach((e) => console.log(`│    • ${e}`));
  }

  // Summary verdict
  const totalMissing = m.questions.reduce((a, q) => a + q.noScoreUpdate, 0);
  const totalErrors  = m.connFail + m.joinFail + wsErrCount + totalMissing + m.scoreMismatches.length;
  console.log("\n└─ VERDICT");
  if (totalErrors === 0) {
    console.log("   ✓ No errors detected — server handled all players cleanly.");
  } else {
    console.log(`   ✗ ${totalErrors} total issues found:`);
    if (m.connFail)               console.log(`     • ${m.connFail} connection failures`);
    if (m.joinFail)               console.log(`     • ${m.joinFail} join failures (${m.duplicateNicknames} nickname collisions)`);
    if (totalMissing)             console.log(`     • ${totalMissing} score_update responses never received (likely DB pool exhaustion)`);
    if (wsErrCount)               console.log(`     • ${wsErrCount} WebSocket errors`);
    if (m.scoreMismatches.length) console.log(`     • ${m.scoreMismatches.length} score mismatches between in-game and final API`);
  }

  console.log("\n" + bar + "\n");
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  let players = [];
  let host;

  try {
    const { game, questionCount, questions } = await setupQuizAndGame();
    host    = await connectHost(game.gameCode);
    players = await connectPlayers(game.gameCode);
    await runGame(host, players, game.gameCode, questionCount, questions);
    await verifyScores(game.gameCode, players);
  } catch (err) {
    console.error("\n[ FATAL ]", err.message);
  } finally {
    // Close all sockets cleanly
    host?.close();
    for (const p of players) p.close();
    await sleep(500);
    printReport(players);
    process.exit(0);
  }
}

main();
