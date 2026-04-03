import { useEffect, useState, useRef } from "react";
import { useRoute, useLocation, useSearch } from "wouter";
import { useGameWebSocket } from "@/hooks/use-websocket";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, XCircle, Home, Loader2, Trophy, WifiOff } from "lucide-react";
import { AnswerGrid } from "@/components/game-ui";
import confetti from "canvas-confetti";

type PlayerState = "lobby" | "answering" | "waiting" | "result" | "between_questions" | "podium";

const PLAYER_ID_STORAGE_KEY = "quizblast_player_id";
const PLAYER_GAME_CODE_KEY = "quizblast_player_game_code";

interface LeaderboardEntry {
  nickname: string;
  score: number;
  rank: number;
}

export default function PlayerGame() {
  const [, params] = useRoute("/play/:gameCode");
  const [, setLocation] = useLocation();
  const search = useSearch();
  const gameCode = params?.gameCode || "";

  const [nickname, setNickname] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return sessionStorage.getItem("quizblast_nickname") || "";
  });
  const [playerId, setPlayerId] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const storedId = sessionStorage.getItem(PLAYER_ID_STORAGE_KEY);
    const storedCode = sessionStorage.getItem(PLAYER_GAME_CODE_KEY);
    return storedId && storedCode === gameCode ? Number(storedId) : null;
  });

  const { connected, lastMessage, emit } = useGameWebSocket();
  const [gameState, setGameState] = useState<PlayerState>("lobby");

  const [currentOptions, setCurrentOptions] = useState<string[]>([]);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [questionStartTime, setQuestionStartTime] = useState(0);
  const [lastResult, setLastResult] = useState<{ isCorrect: boolean; points: number; score: number; rank: number } | null>(null);
  const [correctOptionIndex, setCorrectOptionIndex] = useState<number | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const hasJoined = useRef(false);
  const resultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Quiz answers require a nickname
    if (!nickname) setLocation("/");
  }, [nickname, setLocation]);

  // Reset join flag and playerId on disconnect so the player auto-rejoins on reconnect
  useEffect(() => {
    if (!connected) {
      hasJoined.current = false;
      setPlayerId(null);
    }
  }, [connected]);

  useEffect(() => {
    if (connected && gameCode && nickname && !hasJoined.current) {
      hasJoined.current = true;
      emit("player_join", { gameCode, nickname, ...(playerId ? { playerId } : {}) });
    }
  }, [connected, gameCode, nickname, emit, playerId]);

  useEffect(() => {
    if (!lastMessage) return;
    const { type, payload } = lastMessage;

    switch (type) {
      case "joined":
        setPlayerId(payload.playerId);
        sessionStorage.setItem(PLAYER_ID_STORAGE_KEY, String(payload.playerId));
        sessionStorage.setItem(PLAYER_GAME_CODE_KEY, gameCode);
        break;

      case "question_started":
        if (resultTimerRef.current) clearTimeout(resultTimerRef.current);
        setCurrentOptions(payload.question.options);
        setQuestionIndex(payload.questionIndex);
        setQuestionStartTime(Date.now());
        setSelectedOption(null);
        setLastResult(null);
        setCorrectOptionIndex(null);
        setGameState("answering");
        break;

      case "score_update":
        setLastResult({ isCorrect: payload.isCorrect, points: payload.pointsEarned, score: payload.score, rank: payload.rank });
        setGameState(prev => prev === "waiting" || prev === "answering" ? "result" : prev);
        break;

      case "error":
        setErrorMessage(payload?.message ?? "An error occurred");
        break;

      case "question_ended": {
        const lb = (payload.leaderboard as LeaderboardEntry[]) || [];
        const correctOpt = payload.correctOption as number;
        setCorrectOptionIndex(correctOpt);
        setLeaderboard(lb);
        if (gameState === "answering" || gameState === "waiting") {
          setLastResult((prev) => {
            if (prev) return prev; // score_update already arrived, keep it
            // score_update hasn't arrived yet — compute correctness from correctOption
            const isCorrect = selectedOption !== null && selectedOption === correctOpt;
            const myEntry = lb.find((e) => e.nickname === nickname);
            return { isCorrect, points: 0, score: myEntry?.score ?? 0, rank: myEntry?.rank ?? 0 };
          });
          setGameState("result");
        }
        // Auto-advance to leaderboard after 3s
        if (resultTimerRef.current) clearTimeout(resultTimerRef.current);
        resultTimerRef.current = setTimeout(() => setGameState("between_questions"), 3000);
        break;
      }

      case "game_ended":
        if (resultTimerRef.current) clearTimeout(resultTimerRef.current);
        sessionStorage.removeItem(PLAYER_ID_STORAGE_KEY);
        sessionStorage.removeItem(PLAYER_GAME_CODE_KEY);
        setGameState("podium");
        break;
    }
  }, [lastMessage]);

  const handleSelectOption = (index: number) => {
    if (selectedOption !== null || !playerId || !connected) return;
    setSelectedOption(index);
    setGameState("waiting");
    emit("submit_answer", { gameCode, playerId, questionIndex, selectedOption: index, timeToAnswer: Date.now() - questionStartTime });
  };

  useEffect(() => {
    if (gameState === "result" && lastResult?.isCorrect) {
      confetti({ particleCount: 80, spread: 60, origin: { y: 0.6 } });
    }
  }, [gameState, lastResult]);

  const myRank = leaderboard.find((e) => e.nickname === nickname);

  return (
    <div className="fixed inset-0 flex flex-col font-sans overflow-hidden bg-background">

      {/* Connection loss banner */}
      {!connected && (
        <div className="shrink-0 bg-red-500 text-white text-center text-xs py-1.5 px-4 flex items-center justify-center gap-2 z-30">
          <WifiOff size={13} />
          Connection lost — reconnecting...
        </div>
      )}

      {/* Error banner */}
      {errorMessage && (
        <div className="shrink-0 bg-orange-500 text-white text-center text-xs py-1.5 px-4 flex items-center justify-center gap-2 z-30">
          <span>{errorMessage}</span>
          <button onClick={() => setErrorMessage(null)} className="ml-2 font-bold opacity-80 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Header */}
      <header className="shrink-0 h-14 bg-white border-b border-border flex items-center justify-between px-4 z-20 shadow-sm">
        <div className="font-bold text-sm text-muted-foreground tracking-widest uppercase">PIN: {gameCode}</div>
        <div className="font-bold text-sm text-foreground bg-muted px-3 py-1 rounded-full truncate max-w-[140px]">{nickname || "Anonymous"}</div>
      </header>

      {/* ─── GAME CONTENT ─── */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <AnimatePresence mode="wait">
        <motion.div key={gameState} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 flex flex-col min-h-0 overflow-hidden">

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
                  <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring" }} className="flex flex-col items-center text-center">
                    <XCircle size={90} className="mb-5 drop-shadow-md" />
                    <h1 className="text-5xl font-display font-black mb-2">Incorrect</h1>
                    {correctOptionIndex !== null && currentOptions[correctOptionIndex] ? (
                      <div className="mt-3 bg-black/20 px-5 py-3 rounded-2xl">
                        <p className="text-sm font-semibold opacity-70 mb-1">Correct answer</p>
                        <p className="text-xl font-bold">{currentOptions[correctOptionIndex]}</p>
                      </div>
                    ) : (
                      <p className="text-lg font-semibold mt-3 opacity-80">Better luck next time!</p>
                    )}
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
      </AnimatePresence>

      </div>
    </div>
  );
}
