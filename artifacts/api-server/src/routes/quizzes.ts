import { Router, type IRouter } from "express";
import { eq, count, sql, and } from "drizzle-orm";
import { db, quizzesTable, questionsTable, gamesTable } from "@workspace/db";
import {
  CreateQuizBody,
  UpdateQuizBody,
  GetQuizParams,
  UpdateQuizParams,
  DeleteQuizParams,
  AddQuestionParams,
  AddQuestionBody,
  UpdateQuestionParams,
  UpdateQuestionBody,
} from "@workspace/api-zod";
import { requireHostAccess } from "../middlewares/hostAccess";

const router: IRouter = Router();

router.use(requireHostAccess);

router.get("/quizzes", async (req, res): Promise<void> => {
  const quizzes = await db
    .select({
      id: quizzesTable.id,
      title: quizzesTable.title,
      description: quizzesTable.description,
      createdAt: quizzesTable.createdAt,
      updatedAt: quizzesTable.updatedAt,
      questionCount: sql<number>`count(${questionsTable.id})::int`,
    })
    .from(quizzesTable)
    .leftJoin(questionsTable, eq(questionsTable.quizId, quizzesTable.id))
    .groupBy(quizzesTable.id)
    .orderBy(quizzesTable.createdAt);

  res.json(quizzes.map(q => ({ ...q, description: q.description ?? null })));
});

router.post("/quizzes", async (req, res): Promise<void> => {
  const parsed = CreateQuizBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [quiz] = await db.insert(quizzesTable).values({
    title: parsed.data.title,
    description: parsed.data.description ?? null,
  }).returning();

  res.status(201).json({ ...quiz, description: quiz.description ?? null, questionCount: 0 });
});

router.get("/quizzes/:id", async (req, res): Promise<void> => {
  const params = GetQuizParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [quiz] = await db
    .select({
      id: quizzesTable.id,
      title: quizzesTable.title,
      description: quizzesTable.description,
      createdAt: quizzesTable.createdAt,
      updatedAt: quizzesTable.updatedAt,
      questionCount: sql<number>`count(${questionsTable.id})::int`,
    })
    .from(quizzesTable)
    .leftJoin(questionsTable, eq(questionsTable.quizId, quizzesTable.id))
    .where(eq(quizzesTable.id, params.data.id))
    .groupBy(quizzesTable.id);

  if (!quiz) {
    res.status(404).json({ error: "Quiz not found" });
    return;
  }

  const questions = await db
    .select()
    .from(questionsTable)
    .where(eq(questionsTable.quizId, params.data.id))
    .orderBy(questionsTable.orderIndex);

  res.json({
    ...quiz,
    description: quiz.description ?? null,
    questions: questions.map(q => ({
      ...q,
      options: q.options as string[],
    })),
  });
});

router.patch("/quizzes/:id", async (req, res): Promise<void> => {
  const params = UpdateQuizParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateQuizBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [quiz] = await db
    .update(quizzesTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(quizzesTable.id, params.data.id))
    .returning();

  if (!quiz) {
    res.status(404).json({ error: "Quiz not found" });
    return;
  }

  const [row] = await db
    .select({ questionCount: sql<number>`count(${questionsTable.id})::int` })
    .from(questionsTable)
    .where(eq(questionsTable.quizId, quiz.id));

  res.json({ ...quiz, description: quiz.description ?? null, questionCount: row.questionCount });
});

router.delete("/quizzes/:id", async (req, res): Promise<void> => {
  const params = DeleteQuizParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [activeGame] = await db
    .select({ id: gamesTable.id })
    .from(gamesTable)
    .where(and(eq(gamesTable.quizId, params.data.id), eq(gamesTable.status, "active")));

  if (activeGame) {
    res.status(409).json({ error: "Cannot delete a quiz while a game is in progress" });
    return;
  }

  try {
    // Remove related games first so the FK constraint doesn't block quiz deletion
    await db.delete(gamesTable).where(eq(gamesTable.quizId, params.data.id));

    const [quiz] = await db
      .delete(quizzesTable)
      .where(eq(quizzesTable.id, params.data.id))
      .returning();

    if (!quiz) {
      res.status(404).json({ error: "Quiz not found" });
      return;
    }

    res.sendStatus(204);
  } catch (err) {
    res.status(500).json({ error: "Failed to delete quiz" });
  }
});

router.post("/quizzes/:id/questions", async (req, res): Promise<void> => {
  const params = AddQuestionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = AddQuestionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [quiz] = await db.select().from(quizzesTable).where(eq(quizzesTable.id, params.data.id));
  if (!quiz) {
    res.status(404).json({ error: "Quiz not found" });
    return;
  }

  const { options, correctOption } = parsed.data;
  if (correctOption < 0 || correctOption >= options.length) {
    res.status(400).json({ error: "correctOption must be a valid index within the options array" });
    return;
  }

  const [question] = await db.insert(questionsTable).values({
    quizId: params.data.id,
    text: parsed.data.text,
    options: parsed.data.options,
    correctOption: parsed.data.correctOption,
    timeLimit: parsed.data.timeLimit ?? 20,
    points: parsed.data.points ?? 1000,
    orderIndex: parsed.data.orderIndex ?? 0,
  }).returning();

  res.status(201).json({ ...question, options: question.options as string[] });
});

router.patch("/questions/:id", async (req, res): Promise<void> => {
  const params = UpdateQuestionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateQuestionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  if (parsed.data.options !== undefined && parsed.data.correctOption !== undefined) {
    if (parsed.data.correctOption < 0 || parsed.data.correctOption >= parsed.data.options.length) {
      res.status(400).json({ error: "correctOption must be a valid index within the options array" });
      return;
    }
  }

  const [question] = await db
    .update(questionsTable)
    .set(parsed.data)
    .where(eq(questionsTable.id, params.data.id))
    .returning();

  if (!question) {
    res.status(404).json({ error: "Question not found" });
    return;
  }

  res.json({ ...question, options: question.options as string[] });
});

router.delete("/questions/:id", async (req, res): Promise<void> => {
  const params = UpdateQuestionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [question] = await db
    .delete(questionsTable)
    .where(eq(questionsTable.id, params.data.id))
    .returning();

  if (!question) {
    res.status(404).json({ error: "Question not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
