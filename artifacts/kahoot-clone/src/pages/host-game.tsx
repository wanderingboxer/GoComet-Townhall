import { useEffect, useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useGetGame } from "@workspace/api-client-react";
import { useGameWebSocket } from "@/hooks/use-websocket";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users, SkipForward, Trophy, Home, MessageCircle, Send, X,
  CheckCircle2, Link2, Copy, Check, Eye, EyeOff, Clock
} from "lucide-react";
import { CountdownBar, LoadingSpinner, AnswerGrid } from "@/components/game-ui";
import confetti from "canvas-confetti";
import { QRCodeSVG } from "qrcode.react";

type GameState = "lobby" | "question" | "leaderboard" | "podium";

interface HostQA {
  id: string;
  text: string;
  answer: string | null;
  isPublic: boolean;
  askedAt: number;
}

interface LeaderboardEntry { nickname: string; score: number; rank: number; }

export default function HostGame() {
  const [, params] = useRoute("/host/:gameCode");
  const [, setLocation] = useLocation();
  const gameCode = params?.gameCode || "";

  const { connected, lastMessage, emit } = useGameWebSocket();
  const { data: gameInfo, isLoading } = useGetGame(gameCode);

  const [gameState, setGameState] = useState<GameState>("lobby");
  const [players, setPlayers] = useState<Array<{ nickname: string; playerId: number }>>([]);
  const [currentQuestion, setCurrentQuestion] = useState<any>(null);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [totalQuestions, setTotalQuestions] = useState(0);
  const [answersCount, setAnswersCount] = useState(0);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [correctOption, setCorrectOption] = useState<number | null>(null);
  const [timer, setTimer] = useState(0);

  const [qaItems, setQaItems] = useState<HostQA[]>([]);
  const [qaAnswers, setQaAnswers] = useState<Record<string, string>>({});
  const [showQaPanel, setShowQaPanel] = useState(false);
  const [unreadQa, setUnreadQa] = useState(0);
  const [copied, setCopied] = useState(false);

  const joinUrl = `${window.location.origin}${import.meta.env.BASE_URL}?code=${gameCode}`.replace(/([^:])\/\//, "$1/");

  const handleCopyLink = () => {
    navigator.clipboard.writeText(joinUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  useEffect(() => {
    if (connected && gameCode) emit("host_join", { gameCode });
  }, [connected, gameCode, emit]);

  useEffect(() => {
    if (!lastMessage) return;
    const { type, payload } = lastMessage;

    switch (type) {
      case "player_joined":
        setPlayers(prev => prev.find(p => p.playerId === payload.playerId) ? prev : [...prev, { nickname: payload.nickname, playerId: payload.playerId }]);
        break;
      case "question_started":
        setCurrentQuestion(payload.question);
        setQuestionIndex(payload.questionIndex);
        setTotalQuestions(payload.totalQuestions);
        setAnswersCount(0);
        setCorrectOption(null);
        setTimer(payload.question.timeLimit);
        setGameState("question");
        break;
      case "answer_submitted":
        setAnswersCount(payload.answeredCount);
        break;
      case "question_ended":
        setCorrectOption(payload.correctOption);
        setLeaderboard((payload.leaderboard as LeaderboardEntry[]) || []);
        setTimer(0);
        setTimeout(() => setGameState("leaderboard"), 2500);
        break;
      case "game_ended":
        setGameState("podium");
        break;
      case "new_live_question": {
        const q: HostQA = { id: String(payload.id), text: String(payload.text), answer: null, isPublic: false, askedAt: Number(payload.askedAt) };
        setQaItems(prev => [...prev, q]);
        if (!showQaPanel) setUnreadQa(n => n + 1);
        break;
      }
      case "qa_answered": {
        const id = String(payload.id);
        setQaItems(prev => prev.map(q => q.id === id ? { ...q, answer: String(payload.answer), isPublic: Boolean(payload.isPublic) } : q));
        break;
      }
    }
  }, [lastMessage, showQaPanel]);

  useEffect(() => {
    if (showQaPanel) setUnreadQa(0);
  }, [showQaPanel]);

  // Countdown display timer (server handles real timing)
  useEffect(() => {
    if (gameState !== "question" || timer <= 0) {
      return undefined;
    }

    const id = setInterval(() => setTimer(t => Math.max(0, t - 1)), 1000);
    return () => clearInterval(id);
  }, [gameState, timer]);

  // Podium confetti
  useEffect(() => {
    if (gameState !== "podium") return;
    const end = Date.now() + 5000;
    const frame = () => {
      confetti({ particleCount: 5, angle: 60, spread: 55, origin: { x: 0 }, colors: ["#E21B3C", "#1368CE", "#D89E00", "#26890C", "#8A2BE2"] });
      confetti({ particleCount: 5, angle: 120, spread: 55, origin: { x: 1 }, colors: ["#E21B3C", "#1368CE", "#D89E00", "#26890C", "#8A2BE2"] });
      if (Date.now() < end) requestAnimationFrame(frame);
    };
    frame();
  }, [gameState]);

  if (isLoading) return <LoadingSpinner message="Loading Game..." />;
  if (!gameInfo) return <div>Game not found</div>;

  const handleStart = () => emit("start_game", { gameCode });
  const handleSkip = () => emit("end_question", { gameCode });
  const handleNext = () => emit("next_question", { gameCode });

  const handleSendAnswer = (qId: string) => {
    const answer = (qaAnswers[qId] || "").trim();
    if (!answer) return;
    emit("answer_live_question", { gameCode, questionId: qId, answer });
    setQaAnswers(prev => ({ ...prev, [qId]: "" }));
  };

  const handlePublish = (qId: string) => {
    emit("publish_qa", { gameCode, questionId: qId });
  };

  const unansweredQa = qaItems.filter(q => !q.answer).length;

  return (
    <div className="min-h-screen bg-background flex flex-col font-sans overflow-hidden relative">

      {/* Background layers */}
      <AnimatePresence>
        {gameState === "lobby" && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-primary z-0 pointer-events-none" />}
        {gameState === "question" && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-muted/20 z-0 pointer-events-none" />}
        {gameState === "leaderboard" && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-secondary z-0 pointer-events-none" />}
      </AnimatePresence>

      {/* Q&A Floating Button (during game) */}
      {(gameState === "question" || gameState === "leaderboard") && (
        <button
          onClick={() => setShowQaPanel(true)}
          className="fixed bottom-6 right-6 z-30 flex items-center gap-2 bg-white border border-border px-4 py-3 rounded-2xl font-bold text-foreground shadow-lg hover:bg-muted transition-all"
        >
          <MessageCircle size={18} className="text-primary" />
          <span className="text-sm">Q&A</span>
          {unreadQa > 0 && <span className="bg-red-500 text-white text-xs font-black w-5 h-5 rounded-full flex items-center justify-center">{unreadQa}</span>}
          {unreadQa === 0 && unansweredQa > 0 && <span className="bg-yellow-400 text-black text-xs font-black w-5 h-5 rounded-full flex items-center justify-center">{unansweredQa}</span>}
        </button>
      )}

      {/* ─── LOBBY ─── */}
      {gameState === "lobby" && (
        <div className="relative z-10 flex flex-col min-h-screen p-4 md:p-6 gap-5">
          <div className="bg-white/10 backdrop-blur-md rounded-3xl p-5 md:p-8 border border-white/20 shadow-2xl">
            <div className="flex flex-col lg:flex-row gap-6 items-center justify-between">
              {/* PIN + Link */}
              <div className="flex flex-col items-center lg:items-start">
                <p className="text-white/70 font-bold text-sm uppercase tracking-widest mb-1">Join with PIN:</p>
                <h1 className="text-7xl md:text-8xl font-display font-black text-white tracking-widest drop-shadow-lg">{gameCode}</h1>
                <div className="flex flex-wrap items-center gap-2 mt-3">
                  <Link2 size={13} className="text-white/50 shrink-0" />
                  <span className="text-white/50 text-xs font-mono truncate max-w-[200px] md:max-w-xs">{joinUrl}</span>
                  <button onClick={handleCopyLink} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 text-white text-xs font-bold transition-colors shrink-0">
                    {copied ? <><Check size={12} /> Copied!</> : <><Copy size={12} /> Copy</>}
                  </button>
                </div>
              </div>

              {/* QR */}
              <div className="flex flex-col items-center gap-2 shrink-0">
                <div className="bg-white p-3 rounded-2xl shadow-lg">
                  <QRCodeSVG value={joinUrl} size={120} bgColor="#ffffff" fgColor="#1e1b4b" level="M" />
                </div>
                <p className="text-white/60 text-xs font-bold uppercase tracking-widest">Scan to Join</p>
              </div>

              {/* Start */}
              <button onClick={handleStart} disabled={players.length === 0} className="game-button bg-white text-primary px-10 py-5 rounded-2xl text-2xl font-black shadow-[0_8px_0_0_rgba(0,0,0,0.2)] disabled:opacity-50 shrink-0 w-full lg:w-auto">
                Start Game
              </button>
            </div>
          </div>

          <div className="flex-1 bg-white/5 backdrop-blur-sm rounded-3xl p-5 md:p-8 border border-white/10 overflow-y-auto">
            <div className="flex items-center gap-3 text-white mb-5">
              <Users size={28} />
              <span className="text-2xl font-display font-bold">{players.length} {players.length === 1 ? "Player" : "Players"}</span>
            </div>
            <div className="flex flex-wrap gap-3">
              <AnimatePresence>
                {players.map(p => (
                  <motion.div key={p.playerId} initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white text-primary px-5 py-2.5 rounded-full text-base font-bold shadow-md">
                    {p.nickname}
                  </motion.div>
                ))}
              </AnimatePresence>
              {players.length === 0 && <div className="w-full text-center text-white/40 text-xl font-bold py-16 animate-pulse">Waiting for players to join...</div>}
            </div>
          </div>
        </div>
      )}

      {/* ─── QUESTION ─── */}
      {gameState === "question" && currentQuestion && (
        <div className="relative z-10 flex flex-col min-h-screen">
          <header className="bg-white px-4 py-3 flex items-center justify-between shadow-sm shrink-0 border-b border-border">
            <div className="bg-muted px-3 py-1.5 rounded-lg text-sm font-bold text-muted-foreground">{questionIndex + 1}/{totalQuestions}</div>
            <div className="font-display font-black text-5xl text-primary">{timer}</div>
            <button onClick={handleSkip} className="game-button bg-primary text-white px-4 py-2 rounded-xl font-bold text-sm shadow-[0_3px_0_0_hsl(var(--primary-border))]">Skip</button>
          </header>

          <div className="flex-1 flex flex-col items-center justify-center px-6 py-4 text-center">
            <h2 className="text-3xl md:text-5xl font-display font-black text-foreground max-w-4xl leading-tight">{currentQuestion.text}</h2>
          </div>

          <div className="px-4 pb-4 shrink-0">
            <div className="max-w-5xl mx-auto flex flex-col gap-4">
              <div className="flex justify-between items-center px-1">
                <div className="text-sm font-bold text-muted-foreground bg-white px-3 py-1.5 rounded-lg shadow-sm border border-border">
                  {answersCount}/{players.length || 1} answered
                </div>
                <div className="flex items-center gap-1.5 text-sm font-bold text-muted-foreground bg-white px-3 py-1.5 rounded-lg shadow-sm border border-border">
                  <Clock size={13} /> {currentQuestion.points} pts max
                </div>
              </div>
              <CountdownBar timeLimit={currentQuestion.timeLimit} timeLeft={timer} />
              <div className="h-[38vh]">
                <AnswerGrid options={currentQuestion.options} disabled correctOption={correctOption ?? undefined} showResults={correctOption !== null} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── LEADERBOARD ─── */}
      {gameState === "leaderboard" && (
        <div className="relative z-10 flex flex-col min-h-screen px-4 py-8 md:px-8">
          <div className="w-full max-w-3xl mx-auto flex justify-between items-center mb-8">
            <h2 className="text-4xl md:text-5xl font-display font-black text-foreground">Top 5</h2>
            <button onClick={handleNext} className="game-button bg-primary text-white px-6 py-3 rounded-2xl text-lg font-black shadow-[0_5px_0_0_hsl(var(--primary-border))] flex items-center gap-2">
              Next <SkipForward size={18} />
            </button>
          </div>
          <div className="w-full max-w-3xl mx-auto flex flex-col gap-3">
            <AnimatePresence>
              {leaderboard.slice(0, 5).map((player, idx) => {
                const medals = ["🥇", "🥈", "🥉"];
                return (
                  <motion.div key={player.nickname} initial={{ x: -40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: idx * 0.1 }}
                    className="bg-white p-4 md:p-5 rounded-2xl shadow-sm border border-border flex justify-between items-center">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl w-8 text-center">{medals[idx] ?? `${idx + 1}.`}</span>
                      <span className="font-bold text-foreground text-lg">{player.nickname}</span>
                    </div>
                    <span className="font-black text-primary text-xl">{player.score}</span>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* ─── PODIUM ─── */}
      {gameState === "podium" && (
        <div className="relative z-10 flex flex-col min-h-screen items-center justify-center bg-primary text-white px-6 py-12 overflow-hidden">
          <h1 className="text-6xl font-display font-black mb-16 drop-shadow-lg">Podium</h1>
          <div className="flex items-end justify-center gap-3 w-full max-w-3xl">
            {leaderboard[1] && (
              <motion.div initial={{ y: 180 }} animate={{ y: 0 }} transition={{ delay: 0.4 }} className="w-1/3 flex flex-col items-center">
                <div className="text-xl font-bold mb-3 text-center truncate w-full px-2">{leaderboard[1].nickname}</div>
                <div className="text-base mb-2 opacity-90">{leaderboard[1].score}</div>
                <div className="w-full h-40 md:h-48 bg-quiz-blue rounded-t-xl flex justify-center pt-3 shadow-2xl border-t-4 border-white/20"><span className="text-5xl font-black opacity-40">2</span></div>
              </motion.div>
            )}
            {leaderboard[0] && (
              <motion.div initial={{ y: 260 }} animate={{ y: 0 }} transition={{ delay: 0.9 }} className="w-1/3 flex flex-col items-center z-10">
                <Trophy size={44} className="text-quiz-yellow mb-3 drop-shadow-lg" />
                <div className="text-2xl font-bold mb-3 text-center truncate w-full px-2">{leaderboard[0].nickname}</div>
                <div className="text-base mb-2 opacity-90">{leaderboard[0].score}</div>
                <div className="w-full h-56 md:h-64 bg-quiz-yellow rounded-t-xl flex justify-center pt-3 shadow-2xl border-t-4 border-white/20"><span className="text-6xl font-black opacity-40">1</span></div>
              </motion.div>
            )}
            {leaderboard[2] && (
              <motion.div initial={{ y: 120 }} animate={{ y: 0 }} transition={{ delay: 0.2 }} className="w-1/3 flex flex-col items-center">
                <div className="text-xl font-bold mb-3 text-center truncate w-full px-2">{leaderboard[2].nickname}</div>
                <div className="text-base mb-2 opacity-90">{leaderboard[2].score}</div>
                <div className="w-full h-32 md:h-40 bg-quiz-green rounded-t-xl flex justify-center pt-3 shadow-2xl border-t-4 border-white/20"><span className="text-5xl font-black opacity-40">3</span></div>
              </motion.div>
            )}
          </div>
          <button onClick={() => setLocation("/dashboard")} className="mt-14 game-button bg-white text-primary px-8 py-4 rounded-2xl text-xl font-black shadow-[0_6px_0_0_rgba(0,0,0,0.2)] flex items-center gap-2">
            <Home size={20} /> Dashboard
          </button>
        </div>
      )}

      {/* ─── Q&A PANEL (right drawer) ─── */}
      <AnimatePresence>
        {showQaPanel && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/40 z-40" onClick={() => setShowQaPanel(false)} />
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 280 }}
              className="fixed top-0 right-0 bottom-0 w-full max-w-sm z-50 bg-white shadow-2xl flex flex-col"
            >
              {/* Panel header */}
              <div className="shrink-0 px-5 py-4 border-b border-border bg-white flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <MessageCircle size={20} className="text-primary" />
                    <h2 className="text-lg font-display font-black text-foreground">Anonymous Q&A</h2>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{qaItems.length} question{qaItems.length !== 1 ? "s" : ""} · {qaItems.filter(q => !q.answer).length} unanswered</p>
                </div>
                <button onClick={() => setShowQaPanel(false)} className="text-muted-foreground hover:text-foreground p-1.5 rounded-lg hover:bg-muted transition-colors">
                  <X size={18} />
                </button>
              </div>

              {/* Q list */}
              <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 min-h-0">
                {qaItems.length === 0 && (
                  <div className="flex-1 flex flex-col items-center justify-center text-center py-12">
                    <MessageCircle size={48} className="text-muted-foreground/20 mb-3" />
                    <p className="font-bold text-muted-foreground">No questions yet</p>
                    <p className="text-sm text-muted-foreground/60 mt-1">Players submit anonymously</p>
                  </div>
                )}
                {[...qaItems].reverse().map(q => (
                  <motion.div
                    key={q.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`rounded-xl border p-3.5 flex flex-col gap-2.5 ${q.isPublic ? "bg-green-50 border-green-200" : q.answer ? "bg-blue-50 border-blue-200" : "bg-white border-border shadow-sm"}`}
                  >
                    {/* Question text + status */}
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold text-foreground flex-1 leading-relaxed">{q.text}</p>
                      <div className={`shrink-0 text-xs font-bold px-2 py-1 rounded-full ${q.isPublic ? "bg-green-200 text-green-800" : q.answer ? "bg-blue-200 text-blue-800" : "bg-muted text-muted-foreground"}`}>
                        {q.isPublic ? "Public" : q.answer ? "Answered" : "Pending"}
                      </div>
                    </div>

                    {/* If answered privately */}
                    {q.answer && !q.isPublic && (
                      <div className="bg-white border border-blue-200 rounded-lg px-3 py-2">
                        <p className="text-xs font-bold text-blue-600 mb-0.5">Your reply (private):</p>
                        <p className="text-sm text-foreground">{q.answer}</p>
                      </div>
                    )}
                    {/* If published */}
                    {q.isPublic && q.answer && (
                      <div className="bg-white border border-green-200 rounded-lg px-3 py-2">
                        <p className="text-xs font-bold text-green-700 mb-0.5 flex items-center gap-1"><Eye size={11} /> Public reply:</p>
                        <p className="text-sm text-foreground">{q.answer}</p>
                      </div>
                    )}

                    {/* Answer + publish actions (if not yet answered) */}
                    {!q.answer && (
                      <div className="flex items-center gap-2 bg-muted rounded-lg px-3 py-2 border border-border focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/20 transition-all">
                        <input
                          type="text"
                          placeholder="Type reply..."
                          value={qaAnswers[q.id] || ""}
                          onChange={e => setQaAnswers(prev => ({ ...prev, [q.id]: e.target.value }))}
                          onKeyDown={e => e.key === "Enter" && handleSendAnswer(q.id)}
                          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none min-w-0"
                        />
                        <button onClick={() => handleSendAnswer(q.id)} disabled={!(qaAnswers[q.id] || "").trim()} className="w-7 h-7 bg-primary text-white rounded-lg flex items-center justify-center disabled:opacity-40 transition-opacity shrink-0" title="Reply (private)">
                          <Send size={13} />
                        </button>
                      </div>
                    )}

                    {/* Publish button (only if answered but not yet public) */}
                    {q.answer && !q.isPublic && (
                      <button
                        onClick={() => handlePublish(q.id)}
                        className="flex items-center justify-center gap-1.5 text-xs font-bold text-green-700 bg-green-50 hover:bg-green-100 border border-green-200 py-2 rounded-lg transition-colors"
                      >
                        <Eye size={13} /> Publish to players
                      </button>
                    )}
                    {q.isPublic && (
                      <div className="flex items-center justify-center gap-1.5 text-xs font-bold text-green-600">
                        <CheckCircle2 size={13} /> Visible to all players
                      </div>
                    )}
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
