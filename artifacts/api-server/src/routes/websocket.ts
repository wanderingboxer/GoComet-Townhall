import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { db, gamesTable, playersTable, answersTable, questionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import {
  getGameSession,
  addPlayerToSession,
  setHostWs,
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
} from "../lib/gameManager";

interface WsMessage {
  type: string;
  payload: Record<string, unknown>;
}

export function setupWebSocket(server: Server): void {
  const wss = new WebSocketServer({ server, path: "/api/ws" });

  logger.info("WebSocket server initialized at /api/ws");

  wss.on("connection", (ws: WebSocket) => {
    let currentGameCode: string | null = null;
    let currentPlayerId: number | null = null;
    let isHost = false;

    ws.on("message", async (raw) => {
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
            const gameCode = String(msg.payload.gameCode).toUpperCase();
            const session = getGameSession(gameCode);
            if (!session) {
              ws.send(JSON.stringify({ type: "error", payload: { message: "Game not found" } }));
              return;
            }
            currentGameCode = gameCode;
            isHost = true;
            setHostWs(gameCode, ws);
            ws.send(JSON.stringify({
              type: "host_joined",
              payload: { gameCode, playerCount: getSessionPlayerCount(gameCode) },
            }));
            logger.info({ gameCode }, "Host connected to game");
            break;
          }

          case "player_join": {
            const gameCode = String(msg.payload.gameCode).toUpperCase();
            const nickname = String(msg.payload.nickname).trim().slice(0, 20);

            const session = getGameSession(gameCode);
            if (!session) {
              ws.send(JSON.stringify({ type: "error", payload: { message: "Game not found" } }));
              return;
            }

            if (session.status !== "waiting") {
              ws.send(JSON.stringify({ type: "error", payload: { message: "Game already started" } }));
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

            ws.send(JSON.stringify({
              type: "joined",
              payload: { playerId: player.id, nickname, gameCode },
            }));

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

            if (isLastQuestion(gameCode)) {
              await finalizeGame(gameCode);
            } else {
              startQuestion(gameCode, handleQuestionTimeout);
            }
            break;
          }

          case "end_question": {
            if (!isHost || !currentGameCode) return;
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
            const question = session.questions[questionIndex];

            const [game] = await db.select().from(gamesTable).where(eq(gamesTable.gameCode, gameCode));
            if (game) {
              await db.insert(answersTable).values({
                gameId: game.id,
                playerId,
                questionId: question.id,
                selectedOption,
                isCorrect: result.isCorrect ? 1 : 0,
                pointsEarned: result.pointsEarned,
                timeToAnswer,
              });

              await db.update(playersTable)
                .set({ score: session.players.get(playerId)?.score ?? 0 })
                .where(eq(playersTable.id, playerId));
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
            if (!questionId || !answerText) return;

            const answered = answerLiveQuestion(currentGameCode, questionId, answerText);
            if (!answered) return;

            // Tell the host and the original player privately — don't broadcast to everyone yet
            sendToHost(currentGameCode, {
              type: "qa_answered",
              payload: {
                id: answered.id,
                text: answered.text,
                answer: answered.answer,
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
              payload: { questions: questions.map(q => ({ id: q.id, text: q.text, answer: q.answer, isPublic: q.isPublic, askedAt: q.askedAt })) },
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
  await db.update(gamesTable).set({ status: "finished" }).where(eq(gamesTable.gameCode, gameCode));
  endGame(gameCode);
}
