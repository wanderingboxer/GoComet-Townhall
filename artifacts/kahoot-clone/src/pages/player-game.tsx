import { useEffect, useState, useRef } from "react";
import { useRoute, useLocation } from "wouter";
import { useGameWebSocket } from "@/hooks/use-websocket";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, XCircle, Home, Loader2, MessageCircle, Send, Trophy, Medal } from "lucide-react";
import { AnswerGrid } from "@/components/game-ui";
import confetti from "canvas-confetti";

type PlayerState = "lobby" | "answering" | "waiting" | "result" | "between_questions" | "podium";
type Tab = "game" | "qa";

interface PublicQA {
  id: string;
  text: string;
  answer: string;
  answeredAt: number;
}

interface LeaderboardEntry {
  nickname: string;
  score: number;
  rank: number;
}

export default function PlayerGame() {
  const [, params] = useRoute("/play/:gameCode");
  const [, setLocation] = useLocation();
  const gameCode = params?.gameCode || "";

  const nickname = sessionStorage.getItem("quizblast_nickname");
  const [playerId, setPlayerId] = useState<number | null>(null);

  const { connected, lastMessage, emit } = useGameWebSocket();
  const [gameState, setGameState] = useState<PlayerState>("lobby");
  const [activeTab, setActiveTab] = useState<Tab>("game");

  const [currentOptions, setCurrentOptions] = useState<string[]>([]);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [questionStartTime, setQuestionStartTime] = useState(0);
  const [lastResult, setLastResult] = useState<{ isCorrect: boolean; points: number; score: number; rank: number } | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const hasJoined = useRef(false);
  const resultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Q&A state
  const [qaInput, setQaInput] = useState("");
  const [mySentCount, setMySentCount] = useState(0);
  const [publicQAs, setPublicQAs] = useState<PublicQA[]>([]);
  const [newQACount, setNewQACount] = useState(0);
  const qaListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!nickname) setLocation("/");
  }, [nickname, setLocation]);

  useEffect(() => {
    if (connected && gameCode && nickname && !hasJoined.current) {
      hasJoined.current = true;
      emit("player_join", { gameCode, nickname });
    }
  }, [connected, gameCode, nickname, emit]);

  useEffect(() => {
    if (!lastMessage) return;
    const { type, payload } = lastMessage;

    switch (type) {
      case "joined":
        setPlayerId(payload.playerId);
        break;

      case "question_started":
        if (resultTimerRef.current) clearTimeout(resultTimerRef.current);
        setCurrentOptions(payload.question.options);
        setQuestionIndex(payload.questionIndex);
        setQuestionStartTime(Date.now());
        setSelectedOption(null);
        setLastResult(null);
        setGameState("answering");
        setActiveTab("game");
        break;

      case "score_update":
        setLastResult({ isCorrect: payload.isCorrect, points: payload.pointsEarned, score: payload.score, rank: payload.rank });
        setGameState("result");
        break;

      case "question_ended": {
        const lb = (payload.leaderboard as LeaderboardEntry[]) || [];
        setLeaderboard(lb);
        if (gameState === "answering") {
          setLastResult(prev => prev ?? { isCorrect: false, points: 0, score: prev?.score ?? 0, rank: lb.find(e => e.nickname === nickname)?.rank ?? 0 });
          setGameState("result");
        }
        // Auto-advance to leaderboard after 3s
        if (resultTimerRef.current) clearTimeout(resultTimerRef.current);
        resultTimerRef.current = setTimeout(() => setGameState("between_questions"), 3000);
        break;
      }

      case "game_ended":
        if (resultTimerRef.current) clearTimeout(resultTimerRef.current);
        setGameState("podium");
        break;

      case "qa_published": {
        const qa: PublicQA = { id: String(payload.id), text: String(payload.text), answer: String(payload.answer), answeredAt: Number(payload.answeredAt) };
        setPublicQAs(prev => [...prev, qa]);
        if (activeTab !== "qa") setNewQACount(n => n + 1);
        setTimeout(() => qaListRef.current?.scrollTo({ top: qaListRef.current.scrollHeight, behavior: "smooth" }), 100);
        break;
      }
    }
  }, [lastMessage]);

  useEffect(() => {
    if (activeTab === "qa") setNewQACount(0);
  }, [activeTab]);

  const handleSelectOption = (index: number) => {
    if (selectedOption !== null || !playerId) return;
    setSelectedOption(index);
    setGameState("waiting");
    emit("submit_answer", { gameCode, playerId, questionIndex, selectedOption: index, timeToAnswer: Date.now() - questionStartTime });
  };

  useEffect(() => {
    if (gameState === "result" && lastResult?.isCorrect) {
      confetti({ particleCount: 80, spread: 60, origin: { y: 0.6 } });
    }
  }, [gameState, lastResult]);

  const handleSendQuestion = () => {
    const text = qaInput.trim();
    if (!text || !playerId) return;
    emit("ask_question", { gameCode, text });
    setMySentCount(n => n + 1);
    setQaInput("");
  };

  if (!nickname) return null;

  const myRank = leaderboard.find(e => e.nickname === nickname);
  const showTabs = gameState !== "answering" && gameState !== "podium";

  return (
    <div className="fixed inset-0 flex flex-col font-sans overflow-hidden bg-background">

      {/* Header */}
      <header className="shrink-0 h-14 bg-white border-b border-border flex items-center justify-between px-4 z-20 shadow-sm">
        <div className="font-bold text-sm text-muted-foreground tracking-widest uppercase">PIN: {gameCode}</div>
        <div className="font-bold text-sm text-foreground bg-muted px-3 py-1 rounded-full truncate max-w-[140px]">{nickname}</div>
      </header>

      {/* Tab Bar (shown except during answering/podium) */}
      {showTabs && (
        <div className="shrink-0 flex bg-white border-b border-border z-10">
          <button
            onClick={() => setActiveTab("game")}
            className={`flex-1 py-2.5 text-sm font-bold flex items-center justify-center gap-1.5 transition-colors ${activeTab === "game" ? "text-primary border-b-2 border-primary" : "text-muted-foreground"}`}
          >
            <Trophy size={15} /> Game
          </button>
          <button
            onClick={() => setActiveTab("qa")}
            className={`flex-1 py-2.5 text-sm font-bold flex items-center justify-center gap-1.5 transition-colors relative ${activeTab === "qa" ? "text-primary border-b-2 border-primary" : "text-muted-foreground"}`}
          >
            <MessageCircle size={15} /> Q&A
            {newQACount > 0 && (
              <span className="absolute top-1.5 right-[calc(50%-22px)] bg-red-500 text-white text-xs font-black w-4 h-4 rounded-full flex items-center justify-center">
                {newQACount}
              </span>
            )}
          </button>
        </div>
      )}

      {/* ─── GAME TAB ─── */}
      <AnimatePresence mode="wait">
        {(activeTab === "game" || gameState === "answering" || gameState === "podium") && (
          <motion.div key="game-tab" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 flex flex-col min-h-0 overflow-hidden">

            {/* LOBBY */}
            {gameState === "lobby" && (
              <div className="flex-1 flex flex-col items-center justify-center p-6 bg-primary text-white">
                <motion.div initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-center">
                  <div className="text-6xl mb-4">🎮</div>
                  <h1 className="text-4xl font-display font-black mb-3">You're in!</h1>
                  <p className="text-xl font-semibold opacity-80">Waiting for the host to start...</p>
                  <Loader2 className="animate-spin mx-auto mt-10" size={36} />
                </motion.div>
              </div>
            )}

            {/* ANSWERING */}
            {gameState === "answering" && (
              <div className="flex-1 p-2">
                <AnswerGrid options={currentOptions} onSelect={handleSelectOption} />
              </div>
            )}

            {/* WAITING */}
            {gameState === "waiting" && (
              <div className="flex-1 flex flex-col items-center justify-center p-6 bg-muted">
                <Loader2 className="animate-spin text-muted-foreground mb-5" size={52} />
                <h2 className="text-2xl font-display font-bold text-foreground text-center">Answer locked in!</h2>
                <p className="text-muted-foreground mt-2">Waiting for others...</p>
              </div>
            )}

            {/* RESULT */}
            {gameState === "result" && lastResult && (
              <motion.div
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                className={`flex-1 flex flex-col items-center justify-center p-6 text-white ${lastResult.isCorrect ? "bg-quiz-green" : "bg-quiz-red"}`}
              >
                {lastResult.isCorrect ? (
                  <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring" }} className="flex flex-col items-center">
                    <CheckCircle2 size={90} className="mb-5 drop-shadow-md" />
                    <h1 className="text-5xl font-display font-black mb-2">Correct!</h1>
                    <div className="text-2xl font-bold bg-black/20 px-6 py-2 rounded-full mt-3">+{lastResult.points} pts</div>
                  </motion.div>
                ) : (
                  <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring" }} className="flex flex-col items-center">
                    <XCircle size={90} className="mb-5 drop-shadow-md" />
                    <h1 className="text-5xl font-display font-black mb-2">Incorrect</h1>
                    <p className="text-lg font-semibold mt-3 opacity-80">Better luck next time!</p>
                  </motion.div>
                )}
                <div className="absolute bottom-0 left-0 right-0 px-6 py-4 bg-black/25 backdrop-blur-sm flex justify-between items-center font-bold text-lg">
                  <div>Score: <span className="text-xl">{lastResult.score}</span></div>
                  <div>Rank: <span className="text-xl">#{lastResult.rank}</span></div>
                </div>
              </motion.div>
            )}

            {/* BETWEEN QUESTIONS LEADERBOARD */}
            {gameState === "between_questions" && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex-1 flex flex-col bg-background overflow-hidden"
              >
                <div className="bg-primary px-6 py-5 text-white text-center shrink-0">
                  <h2 className="text-2xl font-display font-black">Leaderboard</h2>
                  {myRank && (
                    <p className="text-sm font-semibold opacity-80 mt-1">You're #{myRank.rank} with {myRank.score} pts</p>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
                  {leaderboard.slice(0, 10).map((entry, idx) => {
                    const isMe = entry.nickname === nickname;
                    const medals = ["🥇", "🥈", "🥉"];
                    return (
                      <motion.div
                        key={entry.nickname}
                        initial={{ x: -30, opacity: 0 }}
                        animate={{ x: 0, opacity: 1 }}
                        transition={{ delay: idx * 0.06 }}
                        className={`flex items-center gap-3 px-4 py-3 rounded-xl font-bold border ${isMe ? "bg-primary text-white border-primary shadow-lg shadow-primary/30 scale-[1.02]" : "bg-white border-border text-foreground"}`}
                      >
                        <span className="text-xl w-8 shrink-0 text-center">{medals[idx] ?? `${idx + 1}.`}</span>
                        <span className="flex-1 truncate text-sm">{entry.nickname}</span>
                        <span className={`text-sm font-black ${isMe ? "text-white" : "text-primary"}`}>{entry.score}</span>
                      </motion.div>
                    );
                  })}
                  {leaderboard.length === 0 && (
                    <div className="text-center text-muted-foreground py-10">No scores yet</div>
                  )}
                </div>
                <div className="p-4 shrink-0">
                  <div className="text-center text-sm text-muted-foreground animate-pulse">Next question coming up...</div>
                </div>
              </motion.div>
            )}

            {/* PODIUM */}
            {gameState === "podium" && (
              <div className="flex-1 flex flex-col items-center justify-center p-6 bg-primary text-white">
                <div className="text-7xl mb-4">🏆</div>
                <h1 className="text-5xl font-display font-black mb-3">Game Over!</h1>
                <p className="text-xl font-semibold mb-3 opacity-80">Check the big screen!</p>
                {myRank && (
                  <div className="bg-white/20 rounded-2xl px-6 py-3 mb-8 text-center">
                    <div className="text-3xl font-black">#{myRank.rank}</div>
                    <div className="text-sm opacity-80">{myRank.score} points</div>
                  </div>
                )}
                <button onClick={() => setLocation("/")} className="game-button bg-white text-primary px-8 py-4 rounded-2xl text-xl font-black shadow-[0_6px_0_0_rgba(0,0,0,0.2)] flex items-center gap-2">
                  <Home size={20} /> Home
                </button>
              </div>
            )}

          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Q&A TAB ─── */}
      <AnimatePresence mode="wait">
        {activeTab === "qa" && gameState !== "answering" && gameState !== "podium" && (
          <motion.div key="qa-tab" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="flex-1 flex flex-col min-h-0 overflow-hidden bg-background">

            {/* Published Q&As */}
            <div ref={qaListRef} className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 min-h-0">
              {publicQAs.length === 0 && mySentCount === 0 && (
                <div className="flex-1 flex flex-col items-center justify-center text-center py-12">
                  <MessageCircle size={52} className="text-muted-foreground/20 mb-4" />
                  <p className="font-bold text-muted-foreground">Ask a question anonymously</p>
                  <p className="text-sm text-muted-foreground/70 mt-1">The host will see it and may publish their reply here</p>
                </div>
              )}

              {mySentCount > 0 && publicQAs.length === 0 && (
                <div className="bg-primary/5 border border-primary/20 rounded-2xl p-4 text-center">
                  <Loader2 size={18} className="animate-spin text-primary mx-auto mb-2" />
                  <p className="text-sm font-semibold text-primary">Question sent! Waiting for the host to respond...</p>
                </div>
              )}

              {publicQAs.map((qa, idx) => (
                <motion.div
                  key={qa.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  className="bg-white border border-border rounded-2xl overflow-hidden shadow-sm"
                >
                  <div className="px-4 pt-4 pb-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Question</span>
                    </div>
                    <p className="font-semibold text-foreground text-sm">{qa.text}</p>
                  </div>
                  <div className="bg-primary/5 border-t border-primary/10 px-4 pt-3 pb-4">
                    <div className="flex items-center gap-2 mb-1">
                      <CheckCircle2 size={13} className="text-primary" />
                      <span className="text-xs font-bold text-primary uppercase tracking-wider">Host replied</span>
                    </div>
                    <p className="text-sm text-foreground">{qa.answer}</p>
                  </div>
                </motion.div>
              ))}
            </div>

            {/* Ask box */}
            <div className="shrink-0 p-4 border-t border-border bg-white">
              <p className="text-xs text-muted-foreground text-center mb-2 font-medium">Your question is anonymous — only the host sees it</p>
              <div className="flex items-center gap-2 bg-muted rounded-2xl px-4 py-3 border border-border focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 transition-all">
                <input
                  type="text"
                  placeholder="Ask the host something..."
                  value={qaInput}
                  onChange={e => setQaInput(e.target.value.slice(0, 200))}
                  onKeyDown={e => e.key === "Enter" && handleSendQuestion()}
                  className="flex-1 bg-transparent text-sm font-medium text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
                <button
                  onClick={handleSendQuestion}
                  disabled={!qaInput.trim()}
                  className="w-9 h-9 bg-primary text-white rounded-xl flex items-center justify-center disabled:opacity-40 transition-opacity shrink-0"
                >
                  <Send size={15} />
                </button>
              </div>
              <p className="text-xs text-muted-foreground text-right mt-1">{qaInput.length}/200</p>
            </div>

          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
