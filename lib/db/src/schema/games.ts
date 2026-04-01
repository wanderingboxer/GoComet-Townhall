import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { quizzesTable, questionsTable } from "./quizzes";

export const gamesTable = pgTable("games", {
  id: serial("id").primaryKey(),
  gameCode: text("game_code").notNull().unique(),
  quizId: integer("quiz_id").notNull().references(() => quizzesTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("waiting"),
  currentQuestionIndex: integer("current_question_index"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertGameSchema = createInsertSchema(gamesTable).omit({ id: true, createdAt: true });
export type InsertGame = z.infer<typeof insertGameSchema>;
export type Game = typeof gamesTable.$inferSelect;

export const playersTable = pgTable("players", {
  id: serial("id").primaryKey(),
  gameId: integer("game_id").notNull().references(() => gamesTable.id, { onDelete: "cascade" }),
  nickname: text("nickname").notNull(),
  score: integer("score").notNull().default(0),
  isConnected: integer("is_connected").notNull().default(1),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPlayerSchema = createInsertSchema(playersTable).omit({ id: true, joinedAt: true });
export type InsertPlayer = z.infer<typeof insertPlayerSchema>;
export type Player = typeof playersTable.$inferSelect;

export const answersTable = pgTable("answers", {
  id: serial("id").primaryKey(),
  gameId: integer("game_id").notNull().references(() => gamesTable.id, { onDelete: "cascade" }),
  playerId: integer("player_id").notNull().references(() => playersTable.id, { onDelete: "cascade" }),
  questionId: integer("question_id").notNull().references(() => questionsTable.id),
  selectedOption: integer("selected_option").notNull(),
  isCorrect: integer("is_correct").notNull().default(0),
  pointsEarned: integer("points_earned").notNull().default(0),
  timeToAnswer: integer("time_to_answer"),
  answeredAt: timestamp("answered_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAnswerSchema = createInsertSchema(answersTable).omit({ id: true, answeredAt: true });
export type InsertAnswer = z.infer<typeof insertAnswerSchema>;
export type Answer = typeof answersTable.$inferSelect;
