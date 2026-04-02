import { Router, type IRouter } from "express";
import { eq, sql, desc } from "drizzle-orm";
import { db, quizzesTable, questionsTable, gamesTable, playersTable, answersTable } from "@workspace/db";
import { CreateGameBody, GetGameParams, GetGameResultsParams } from "@workspace/api-zod";
import {
  createGameSession,
  setGameQuestions,
  getSessionPlayerCount,
} from "../lib/gameManager";
import { requireHostAccess } from "../middlewares/hostAccess";

const router: IRouter = Router();

router.use(requireHostAccess);

function generateGameCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

router.post("/games", async (req, res): Promise<void> => {
  const parsed = CreateGameBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [quiz] = await db
    .select({
      id: quizzesTable.id,
      title: quizzesTable.title,
    })
    .from(quizzesTable)
    .where(eq(quizzesTable.id, parsed.data.quizId));

  if (!quiz) {
    res.status(404).json({ error: "Quiz not found" });
    return;
  }

  const questions = await db
    .select()
    .from(questionsTable)
    .where(eq(questionsTable.quizId, parsed.data.quizId))
    .orderBy(questionsTable.orderIndex);

  if (questions.length === 0) {
    res.status(400).json({ error: "Quiz has no questions" });
    return;
  }

  let gameCode = generateGameCode();
  let attempts = 0;
  while (attempts < 10) {
    const existing = await db.select().from(gamesTable).where(eq(gamesTable.gameCode, gameCode));
    if (existing.length === 0) break;
    gameCode = generateGameCode();
    attempts++;
  }

  if (attempts >= 10) {
    res.status(503).json({ error: "Could not generate a unique game code. Please try again." });
    return;
  }

  const [game] = await db.insert(gamesTable).values({
    gameCode,
    quizId: parsed.data.quizId,
    status: "waiting",
  }).returning();

  const session = createGameSession(gameCode, parsed.data.quizId);
  setGameQuestions(gameCode, questions.map(q => ({
    id: q.id,
    text: q.text,
    options: q.options as string[],
    correctOption: q.correctOption,
    timeLimit: q.timeLimit,
    points: q.points,
  })));

  res.status(201).json({
    id: game.id,
    gameCode: game.gameCode,
    quizId: game.quizId,
    quizTitle: quiz.title,
    status: game.status as "waiting" | "active" | "finished",
    currentQuestionIndex: game.currentQuestionIndex,
    playerCount: 0,
    createdAt: game.createdAt,
  });
});

router.get("/games/:gameCode", async (req, res): Promise<void> => {
  const params = GetGameParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const rawCode = Array.isArray(req.params.gameCode) ? req.params.gameCode[0] : req.params.gameCode;
  const code = rawCode.toUpperCase();

  const [game] = await db
    .select({
      id: gamesTable.id,
      gameCode: gamesTable.gameCode,
      quizId: gamesTable.quizId,
      quizTitle: quizzesTable.title,
      status: gamesTable.status,
      currentQuestionIndex: gamesTable.currentQuestionIndex,
      createdAt: gamesTable.createdAt,
    })
    .from(gamesTable)
    .innerJoin(quizzesTable, eq(gamesTable.quizId, quizzesTable.id))
    .where(eq(gamesTable.gameCode, code));

  if (!game) {
    res.status(404).json({ error: "Game not found" });
    return;
  }

  const playerCount = getSessionPlayerCount(code);

  res.json({
    ...game,
    status: game.status as "waiting" | "active" | "finished",
    playerCount,
  });
});

router.get("/games/:gameCode/results", async (req, res): Promise<void> => {
  const params = GetGameResultsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const rawCode = Array.isArray(req.params.gameCode) ? req.params.gameCode[0] : req.params.gameCode;
  const code = rawCode.toUpperCase();

  const [game] = await db
    .select({
      id: gamesTable.id,
      gameCode: gamesTable.gameCode,
      quizTitle: quizzesTable.title,
    })
    .from(gamesTable)
    .innerJoin(quizzesTable, eq(gamesTable.quizId, quizzesTable.id))
    .where(eq(gamesTable.gameCode, code));

  if (!game) {
    res.status(404).json({ error: "Game not found" });
    return;
  }

  const players = await db
    .select({
      playerId: playersTable.id,
      nickname: playersTable.nickname,
      score: playersTable.score,
      totalAnswers: sql<number>`count(${answersTable.id})::int`,
      correctAnswers: sql<number>`sum(case when ${answersTable.isCorrect} = 1 then 1 else 0 end)::int`,
    })
    .from(playersTable)
    .leftJoin(answersTable, eq(answersTable.playerId, playersTable.id))
    .where(eq(playersTable.gameId, game.id))
    .groupBy(playersTable.id)
    .orderBy(desc(playersTable.score));

  const ranked = players.map((p, i) => ({
    playerId: p.playerId,
    nickname: p.nickname,
    score: p.score,
    rank: i + 1,
    correctAnswers: p.correctAnswers ?? 0,
    totalAnswers: p.totalAnswers ?? 0,
  }));

  res.json({
    gameCode: game.gameCode,
    quizTitle: game.quizTitle,
    players: ranked,
  });
});

export default router;
