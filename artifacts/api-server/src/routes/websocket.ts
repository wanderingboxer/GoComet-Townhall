import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { db, gamesTable, playersTable, answersTable, questionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import {
  getGameSession,
  createGameSession,
  setGameQuestions,
  addPlayerToSession,
  setHostWs,
  removeHostWs,
  broadcast,
  broadcastToPlayers,
  sendToHost,
  sendToPlayer,
  submitAnswer,
  getAnsweredCount,
  endQuestion,
  endGame,
  startQuestion,
  startGameSession,
  isAllAnswered,
  isLastQuestion,
  getLeaderboard,
  removePlayer,
  getSessionPlayerCount,
  addLiveQuestion,
  answerLiveQuestion,
  publishLiveQuestion,
  getLiveQuestions,
  addGlobalLiveQuestion,
  answerGlobalLiveQuestion,
  publishGlobalLiveQuestion,
  getGlobalLiveQuestions,
} from "../lib/gameManager";
import { hasHostAccessFromCookieHeader, verifyHostAccessCode } from "../middlewares/hostAccess";

// Global Q&A that is not tied to a game PIN.
// Hosts are subscribed once they successfully `host_join`.
const authorizedHostSockets = new Set<WebSocket>();

// Per-connection token bucket for rate limiting.
const RATE_LIMIT_MAX_TOKENS = 20;
const RATE_LIMIT_REFILL_PER_SEC = 5;
const rateLimitMap = new Map<WebSocket, { tokens: number; lastRefill: number }>();

// Anonymous Q&A clients from the main page.
// We keep a single active socket per clientId.
const qaClientSockets = new Map<string, WebSocket>();

interface WsMessage {
  type: string;
  payload: Record<string, unknown>;
}

export function setupWebSocket(server: Server): void {
  const wss = new WebSocketServer({ server, path: "/api/ws", maxPayload: 64 * 1024 });

  logger.info("WebSocket server initialized at /api/ws");

  wss.on("connection", (ws: WebSocket, request) => {
    const hasAuthorizedHostAccess = hasHostAccessFromCookieHeader(request.headers.cookie);
    let currentGameCode: string | null = null;
    let currentPlayerId: number | null = null;
    let isHost = false;
    let currentQaClientId: string | null = null;

    ws.on("message", async (raw) => {
      // Token-bucket rate limiting per connection.
      const now = Date.now();
      let bucket = rateLimitMap.get(ws);
      if (!bucket) {
        bucket = { tokens: RATE_LIMIT_MAX_TOKENS, lastRefill: now };
        rateLimitMap.set(ws, bucket);
      }
      const elapsed = (now - bucket.lastRefill) / 1000;
      bucket.tokens = Math.min(RATE_LIMIT_MAX_TOKENS, bucket.tokens + elapsed * RATE_LIMIT_REFILL_PER_SEC);
      bucket.lastRefill = now;
      if (bucket.tokens < 1) {
        logger.warn("WebSocket rate limit exceeded, dropping message");
        return;
      }
      bucket.tokens -= 1;

      let msg: WsMessage;
      try {
        msg = JSON.parse(raw.toString()) as WsMessage;
      } catch {
        ws.send(JSON.stringify({ type: "error", payload: { message: "Invalid JSON" } }));
        return;
      }

      try {
        switch (msg.type) {
          case "host_join": {
            const accessKey = String(msg.payload.accessKey ?? "");
            const isAuthorizedHost = hasAuthorizedHostAccess || verifyHostAccessCode(accessKey);

            if (!isAuthorizedHost) {
              ws.send(JSON.stringify({ type: "error", payload: { message: "Host access required" } }));
              return;
            }

            const gameCode = String(msg.payload.gameCode).toUpperCase();
            let session = getGameSession(gameCode);
            if (!session) {
              // In-memory session missing — backend may have restarted. Try to re-hydrate from DB.
              const [game] = await db
                .select()
                .from(gamesTable)
                .where(eq(gamesTable.gameCode, gameCode));

              if (!game || game.status === "finished") {
                ws.send(JSON.stringify({ type: "error", payload: { message: "Game not found" } }));
                return;
              }

              const questions = await db
                .select()
                .from(questionsTable)
                .where(eq(questionsTable.quizId, game.quizId))
                .orderBy(questionsTable.orderIndex);

              createGameSession(gameCode, game.quizId);
              setGameQuestions(gameCode, questions.map((q) => ({
                id: q.id,
                text: q.text,
                options: q.options as string[],
                correctOption: q.correctOption,
                timeLimit: q.timeLimit,
                points: q.points,
              })));
              session = getGameSession(gameCode)!;
              logger.info({ gameCode }, "Re-hydrated game session from DB after restart");
            }
            currentGameCode = gameCode;
            isHost = true;
            authorizedHostSockets.add(ws);
            setHostWs(gameCode, ws);
            ws.send(JSON.stringify({
              type: "host_joined",
              payload: { gameCode, playerCount: getSessionPlayerCount(gameCode) },
            }));
            ws.send(JSON.stringify({
              type: "live_questions_list",
              payload: {
                questions: getLiveQuestions(gameCode).map((q) => ({
                  id: q.id,
                  text: q.text,
                  answer: q.answer,
                  answeredBy: q.answeredBy,
                  isPublic: q.isPublic,
                  askedAt: q.askedAt,
                })),
              },
            }));

            // Send global Q&A questions to hosts too.
            ws.send(JSON.stringify({
              type: "global_live_questions_list",
              payload: {
                questions: getGlobalLiveQuestions().map((q) => ({
                  id: q.id,
                  text: q.text,
                  answer: q.answer,
                  answeredBy: q.answeredBy,
                  askedAt: q.askedAt,
                  answeredAt: q.answeredAt,
                  isPublic: q.isPublic,
                  clientId: q.clientId,
                })),
              },
            }));
            // Send full game state so the host can recover from a page refresh or reconnect.
            const playerList = Array.from(session.players.values()).map((p) => ({
              playerId: p.playerId,
              nickname: p.nickname,
            }));
            const activeQuestion =
              session.status === "active" && session.currentQuestionIndex >= 0
                ? session.questions[session.currentQuestionIndex]
                : null;
            ws.send(JSON.stringify({
              type: "host_state_sync",
              payload: {
                status: session.status,
                playerList,
                currentQuestionIndex: session.currentQuestionIndex,
                totalQuestions: session.questions.length,
                currentQuestion: activeQuestion
                  ? {
                      text: activeQuestion.text,
                      options: activeQuestion.options,
                      timeLimit: activeQuestion.timeLimit,
                      points: activeQuestion.points,
                    }
                  : null,
              },
            }));
            logger.info({ gameCode }, "Host connected to game");
            break;
          }

          case "qa_host_join": {
            const accessKey = String(msg.payload.accessKey ?? "");
            const isAuthorizedHost = hasAuthorizedHostAccess || verifyHostAccessCode(accessKey);

            if (!isAuthorizedHost) {
              ws.send(JSON.stringify({ type: "error", payload: { message: "Host access required" } }));
              return;
            }

            isHost = true;
            authorizedHostSockets.add(ws);

            ws.send(JSON.stringify({ type: "qa_host_joined", payload: {} }));

            ws.send(JSON.stringify({
              type: "global_live_questions_list",
              payload: {
                questions: getGlobalLiveQuestions().map((q) => ({
                  id: q.id,
                  text: q.text,
                  answer: q.answer,
                  answeredBy: q.answeredBy,
                  askedAt: q.askedAt,
                  answeredAt: q.answeredAt,
                  isPublic: q.isPublic,
                  clientId: q.clientId,
                })),
              },
            }));

            logger.info("QA-only host connected");
            break;
          }

          case "qa_client_join": {
            const clientId = String(msg.payload.clientId ?? "").trim();
            if (!clientId) {
              ws.send(JSON.stringify({ type: "error", payload: { message: "Missing clientId" } }));
              return;
            }

            currentQaClientId = clientId;
            qaClientSockets.set(clientId, ws);

            const visible = getGlobalLiveQuestions().filter((q) => q.isPublic || q.clientId === clientId);
            ws.send(
              JSON.stringify({
                type: "global_live_questions_list",
                payload: {
                  questions: visible.map((q) => ({
                    id: q.id,
                    text: q.text,
                    answer: q.answer,
                    answeredBy: q.answeredBy,
                    askedAt: q.askedAt,
                    answeredAt: q.answeredAt,
                    isPublic: q.isPublic,
                    mine: q.clientId === clientId,
                  })),
                },
              }),
            );
            break;
          }

          case "ask_global_question": {
            if (!currentQaClientId) return;
            const clientId = currentQaClientId;
            const text = String(msg.payload.text || "").trim();
            if (!text) return;

            const q = addGlobalLiveQuestion(clientId, text);
            if (!q) return;

            // Notify all authorized hosts.
            for (const hostWs of authorizedHostSockets.values()) {
              if (hostWs.readyState !== WebSocket.OPEN) continue;
              hostWs.send(
                JSON.stringify({
                  type: "global_new_question",
                  payload: {
                    id: q.id,
                    text: q.text,
                    answer: null,
                    answeredBy: null,
                    askedAt: q.askedAt,
                    answeredAt: null,
                    isPublic: false,
                    clientId: q.clientId,
                  },
                }),
              );
            }

            // Confirm to the asker (mine).
            ws.send(
              JSON.stringify({
                type: "global_new_question",
                payload: {
                  id: q.id,
                  text: q.text,
                  answer: null,
                  answeredBy: null,
                  askedAt: q.askedAt,
                  answeredAt: null,
                  isPublic: false,
                  mine: true,
                },
              }),
            );
            break;
          }

          case "answer_global_question": {
            if (!isHost) return;

            const questionId = String(msg.payload.questionId || "");
            const answerText = String(msg.payload.answer || "").trim();
            const hostName = String(msg.payload.hostName || "").trim().slice(0, 40) || "Host";
            if (!questionId || !answerText) return;

            const answered = answerGlobalLiveQuestion(questionId, answerText, hostName);
            if (!answered) return;

            ws.send(
              JSON.stringify({
                type: "global_qa_answered",
                payload: {
                  id: answered.id,
                  text: answered.text,
                  answer: answered.answer,
                  answeredBy: answered.answeredBy,
                  askedAt: answered.askedAt,
                  answeredAt: answered.answeredAt,
                  isPublic: false,
                  clientId: answered.clientId,
                },
              }),
            );

            const askerWs = qaClientSockets.get(answered.clientId);
            if (askerWs?.readyState === WebSocket.OPEN) {
              askerWs.send(
                JSON.stringify({
                  type: "global_qa_answered_private",
                  payload: {
                    id: answered.id,
                    text: answered.text,
                    answer: answered.answer,
                    answeredBy: answered.answeredBy,
                    askedAt: answered.askedAt,
                    answeredAt: answered.answeredAt,
                    isPublic: false,
                    mine: true,
                  },
                }),
              );
            }

            break;
          }

          case "publish_global_question": {
            if (!isHost) return;

            const questionId = String(msg.payload.questionId || "");
            if (!questionId) return;

            const published = publishGlobalLiveQuestion(questionId);
            if (!published) return;

            ws.send(
              JSON.stringify({
                type: "global_qa_published",
                payload: {
                  id: published.id,
                  text: published.text,
                  answer: published.answer,
                  answeredBy: published.answeredBy,
                  askedAt: published.askedAt,
                  answeredAt: published.answeredAt,
                  isPublic: true,
                  clientId: published.clientId,
                },
              }),
            );

            for (const [clientId, clientWs] of qaClientSockets.entries()) {
              if (clientWs.readyState !== WebSocket.OPEN) continue;
              clientWs.send(
                JSON.stringify({
                  type: "global_qa_published",
                  payload: {
                    id: published.id,
                    text: published.text,
                    answer: published.answer,
                    answeredBy: published.answeredBy,
                    askedAt: published.askedAt,
                    answeredAt: published.answeredAt,
                    isPublic: true,
                    mine: clientId === published.clientId,
                  },
                }),
              );
            }

            break;
          }

          case "player_join": {
            // Prevent duplicate joins on the same socket.
            if (currentPlayerId || currentGameCode) return;

            const gameCode = String(msg.payload.gameCode).toUpperCase();
            const nickname = String(msg.payload.nickname).trim().slice(0, 20);

            if (!nickname) {
              ws.send(JSON.stringify({ type: "error", payload: { message: "Nickname cannot be empty" } }));
              return;
            }

            const session = getGameSession(gameCode);
            if (session) {
              for (const p of session.players.values()) {
                if (p.nickname.toLowerCase() === nickname.toLowerCase()) {
                  ws.send(JSON.stringify({ type: "error", payload: { message: "Nickname already taken in this game" } }));
                  return;
                }
              }
            }
            if (!session) {
              ws.send(JSON.stringify({ type: "error", payload: { message: "Game not found" } }));
              return;
            }

            if (session.status === "finished") {
              ws.send(JSON.stringify({ type: "error", payload: { message: "Game already finished" } }));
              return;
            }

            const [game] = await db
              .select()
              .from(gamesTable)
              .where(eq(gamesTable.gameCode, gameCode));

            if (!game) {
              ws.send(JSON.stringify({ type: "error", payload: { message: "Game not found in DB" } }));
              return;
            }

            const [player] = await db.insert(playersTable).values({
              gameId: game.id,
              nickname,
              score: 0,
              isConnected: 1,
            }).returning();

            const added = addPlayerToSession(gameCode, player.id, nickname, ws);
            if (!added) {
              ws.send(JSON.stringify({ type: "error", payload: { message: "Could not join game" } }));
              return;
            }

            currentGameCode = gameCode;
            currentPlayerId = player.id;

            // Send existing Q&A items so Q&A stays usable even if opened mid-presentation.
            for (const q of session.liveQuestions) {
              if (q.isPublic) {
                sendToPlayer(gameCode, player.id, {
                  type: "qa_published",
                  payload: {
                    id: q.id,
                    text: q.text,
                    answer: q.answer,
                    answeredBy: q.answeredBy,
                    askedAt: q.askedAt,
                    answeredAt: q.answeredAt,
                    isPublic: true,
                  },
                });
                continue;
              }

              // Private items: only the owner should see them.
              if (q.playerId !== player.id) continue;

              if (q.answer) {
                sendToPlayer(gameCode, player.id, {
                  type: "qa_answered",
                  payload: {
                    id: q.id,
                    text: q.text,
                    answer: q.answer,
                    answeredBy: q.answeredBy,
                    askedAt: q.askedAt,
                    answeredAt: q.answeredAt,
                    isPublic: false,
                  },
                });
              } else {
                sendToPlayer(gameCode, player.id, {
                  type: "live_question_sent",
                  payload: {
                    id: q.id,
                    text: q.text,
                    askedAt: q.askedAt,
                    answer: null,
                    answeredAt: null,
                    isPublic: false,
                  },
                });
              }
            }

            ws.send(JSON.stringify({
              type: "joined",
              payload: { playerId: player.id, nickname, gameCode },
            }));

            // If the game is already in progress, send the current question only if
            // at least 3 seconds remain — joining with < 3s left is more confusing than helpful.
            if (session.status === "active" && session.currentQuestionIndex >= 0) {
              const currentQ = session.questions[session.currentQuestionIndex];
              const elapsed = Date.now() - session.questionStartTime;
              const remainingTime = Math.max(1, currentQ.timeLimit - Math.floor(elapsed / 1000));
              if (remainingTime >= 3) {
                sendToPlayer(gameCode, player.id, {
                  type: "question_started",
                  payload: {
                    questionIndex: session.currentQuestionIndex,
                    question: {
                      text: currentQ.text,
                      options: currentQ.options,
                      timeLimit: remainingTime,
                      points: currentQ.points,
                    },
                    totalQuestions: session.questions.length,
                  },
                });
              }
            }

            const playerCount = getSessionPlayerCount(gameCode);
            broadcast(gameCode, {
              type: "player_joined",
              payload: { playerId: player.id, nickname, playerCount },
            });

            logger.info({ gameCode, playerId: player.id, nickname }, "Player joined game");
            break;
          }

          case "start_game": {
            if (!isHost || !currentGameCode) return;
            const gameCode = currentGameCode;

            const session = getGameSession(gameCode);
            if (!session || session.players.size === 0) {
              ws.send(JSON.stringify({ type: "error", payload: { message: "No players in game" } }));
              return;
            }

            const started = startGameSession(gameCode);
            if (!started) {
              ws.send(JSON.stringify({ type: "error", payload: { message: "Cannot start game" } }));
              return;
            }

            await db.update(gamesTable).set({ status: "active" }).where(eq(gamesTable.gameCode, gameCode));

            broadcast(gameCode, {
              type: "game_started",
              payload: { gameCode },
            });

            logger.info({ gameCode }, "Game started");

            setTimeout(() => {
              startQuestion(gameCode, handleQuestionTimeout);
            }, 1500);
            break;
          }

          case "next_question": {
            if (!isHost || !currentGameCode) return;
            const gameCode = currentGameCode;

            const nqSession = getGameSession(gameCode);
            if (!nqSession || nqSession.status !== "active") return;

            if (isLastQuestion(gameCode)) {
              await finalizeGame(gameCode);
            } else {
              startQuestion(gameCode, handleQuestionTimeout);
            }
            break;
          }

          case "end_question": {
            if (!isHost || !currentGameCode) return;
            const eqSession = getGameSession(currentGameCode);
            if (!eqSession || eqSession.currentQuestionIndex < 0) return;
            endQuestion(currentGameCode);
            break;
          }

          case "submit_answer": {
            if (!currentGameCode || !currentPlayerId) return;

            const gameCode = currentGameCode;
            const playerId = currentPlayerId;
            const questionIndex = Number(msg.payload.questionIndex);
            const selectedOption = Number(msg.payload.selectedOption);
            const timeToAnswer = Number(msg.payload.timeToAnswer);

            const result = submitAnswer(gameCode, playerId, questionIndex, selectedOption, timeToAnswer);
            if (!result) return;

            const session = getGameSession(gameCode);
            if (!session) return;

            // Bounds-check both indices before using them.
            if (questionIndex < 0 || questionIndex >= session.questions.length) return;
            const question = session.questions[questionIndex];
            if (selectedOption < 0 || selectedOption >= question.options.length) return;

            // Capture score synchronously before any async DB work — the player may disconnect
            // during the await below, which would remove them from session and return undefined.
            const finalScore = session.players.get(playerId)?.score ?? 0;

            const [game] = await db.select().from(gamesTable).where(eq(gamesTable.gameCode, gameCode));
            if (game) {
              await db.transaction(async (tx) => {
                await tx.insert(answersTable).values({
                  gameId: game.id,
                  playerId,
                  questionId: question.id,
                  selectedOption,
                  isCorrect: result.isCorrect ? 1 : 0,
                  pointsEarned: result.pointsEarned,
                  timeToAnswer,
                });
                await tx.update(playersTable)
                  .set({ score: finalScore })
                  .where(eq(playersTable.id, playerId));
              });
            }

            const leaderboard = getLeaderboard(gameCode);
            const playerRank = leaderboard.find(p => {
              const player = session.players.get(playerId);
              return player && p.nickname === player.nickname;
            });

            sendToPlayer(gameCode, playerId, {
              type: "score_update",
              payload: {
                score: session.players.get(playerId)?.score ?? 0,
                rank: playerRank?.rank ?? 0,
                isCorrect: result.isCorrect,
                pointsEarned: result.pointsEarned,
              },
            });

            const { answeredCount, totalPlayers } = getAnsweredCount(gameCode);
            broadcast(gameCode, {
              type: "answer_submitted",
              payload: { answeredCount, totalPlayers },
            });

            if (isAllAnswered(gameCode)) {
              endQuestion(gameCode);
            }
            break;
          }

          case "ask_question": {
            if (!currentGameCode || !currentPlayerId) return;

            const text = String(msg.payload.text || "").trim();
            if (!text) return;

            const lq = addLiveQuestion(currentGameCode, currentPlayerId, text);
            if (!lq) return;

            // Send to host WITHOUT playerId (anonymous)
            sendToHost(currentGameCode, {
              type: "new_live_question",
              payload: { id: lq.id, text: lq.text, askedAt: lq.askedAt, answer: null, isPublic: false },
            });

            // Confirm to sender so they can see their own pending question
            sendToPlayer(currentGameCode, currentPlayerId, {
              type: "live_question_sent",
              payload: {
                id: lq.id,
                text: lq.text,
                answer: null,
                askedAt: lq.askedAt,
                answeredAt: null,
                isPublic: false,
              },
            });
            break;
          }

          case "answer_live_question": {
            if (!isHost || !currentGameCode) return;

            const questionId = String(msg.payload.questionId || "");
            const answerText = String(msg.payload.answer || "").trim();
            const hostName = String(msg.payload.hostName || "").trim().slice(0, 40) || "Host";
            if (!questionId || !answerText) return;

            const answered = answerLiveQuestion(currentGameCode, questionId, answerText, hostName);
            if (!answered) return;

            // Tell the host and the original player privately — don't broadcast to everyone yet
            sendToHost(currentGameCode, {
              type: "qa_answered",
              payload: {
                id: answered.id,
                text: answered.text,
                answer: answered.answer,
                answeredBy: answered.answeredBy,
                askedAt: answered.askedAt,
                answeredAt: answered.answeredAt,
                isPublic: false,
              },
            });

            sendToPlayer(currentGameCode, answered.playerId, {
              type: "qa_answered",
              payload: {
                id: answered.id,
                text: answered.text,
                answer: answered.answer,
                answeredBy: answered.answeredBy,
                askedAt: answered.askedAt,
                answeredAt: answered.answeredAt,
                isPublic: false,
              },
            });
            break;
          }

          case "publish_qa": {
            if (!isHost || !currentGameCode) return;

            const qId = String(msg.payload.questionId || "");
            const published = publishLiveQuestion(currentGameCode, qId);
            if (!published) return;

            // Broadcast public Q&A to all players (no playerId — anonymous)
            broadcastToPlayers(currentGameCode, {
              type: "qa_published",
              payload: {
                id: published.id,
                text: published.text,
                answer: published.answer,
                answeredBy: published.answeredBy,
                askedAt: published.askedAt,
                answeredAt: published.answeredAt,
                isPublic: true,
              },
            });

            // Confirm to host
            sendToHost(currentGameCode, {
              type: "qa_answered",
              payload: {
                id: published.id,
                text: published.text,
                answer: published.answer,
                answeredBy: published.answeredBy,
                askedAt: published.askedAt,
                answeredAt: published.answeredAt,
                isPublic: true,
              },
            });
            break;
          }

          case "get_live_questions": {
            if (!isHost || !currentGameCode) return;
            const questions = getLiveQuestions(currentGameCode);
            ws.send(JSON.stringify({
              type: "live_questions_list",
              payload: {
                questions: questions.map((q) => ({
                  id: q.id,
                  text: q.text,
                  answer: q.answer,
                  answeredBy: q.answeredBy,
                  isPublic: q.isPublic,
                  askedAt: q.askedAt,
                })),
              },
            }));
            break;
          }

          default:
            ws.send(JSON.stringify({ type: "error", payload: { message: "Unknown message type" } }));
        }
      } catch (err) {
        logger.error({ err, msgType: msg.type }, "WebSocket message handler error");
        ws.send(JSON.stringify({ type: "error", payload: { message: "Server error" } }));
      }
    });

    ws.on("close", () => {
      rateLimitMap.delete(ws);
      if (isHost) {
        authorizedHostSockets.delete(ws);
      }
      if (currentQaClientId) {
        qaClientSockets.delete(currentQaClientId);
      }

      if (currentGameCode && isHost) {
        removeHostWs(currentGameCode, ws);
      }

      if (currentGameCode && currentPlayerId && !isHost) {
        removePlayer(currentGameCode, currentPlayerId);
        const playerCount = getSessionPlayerCount(currentGameCode);
        sendToHost(currentGameCode, {
          type: "player_left",
          payload: { playerId: currentPlayerId, playerCount },
        });
      }
    });

    ws.on("error", (err) => {
      logger.error({ err }, "WebSocket error");
    });
  });
}

async function handleQuestionTimeout(gameCode: string): Promise<void> {
  endQuestion(gameCode);
}

async function finalizeGame(gameCode: string): Promise<void> {
  try {
    await db.update(gamesTable).set({ status: "finished" }).where(eq(gamesTable.gameCode, gameCode));
  } catch (err) {
    logger.error({ err, gameCode }, "Failed to persist game finished status to DB");
  }
  // Always broadcast game_ended and clean up in-memory state, even if the DB write failed.
  endGame(gameCode);
}
