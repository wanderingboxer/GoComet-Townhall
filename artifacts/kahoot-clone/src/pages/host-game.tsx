import { useEffect, useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useGetGame } from "@workspace/api-client-react";
import { useGameWebSocket } from "@/hooks/use-websocket";
import { motion, AnimatePresence } from "framer-motion";
import { Users, SkipForward, Trophy, Home, MessageCircle, Send, X, CheckCircle2, Link2, Copy, Check } from "lucide-react";
import { CountdownBar, LoadingSpinner, AnswerGrid } from "@/components/game-ui";
import confetti from "canvas-confetti";
import { QRCodeSVG } from "qrcode.react";

type GameState = "lobby" | "question" | "leaderboard" | "podium";

interface LiveQuestion {
  id: string;
  playerId: number;
  nickname: string;
  text: string;
  answer: string | null;
  answeredAt: number | null;
  askedAt: number;
}

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
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [correctOption, setCorrectOption] = useState<number | null>(null);
  const [timer, setTimer] = useState<number>(0);

  const [liveQuestions, setLiveQuestions] = useState<LiveQuestion[]>([]);
  const [showQaPanel, setShowQaPanel] = useState(false);
  const [answerInputs, setAnswerInputs] = useState<Record<string, string>>({});
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
    if (connected && gameCode) {
      emit("host_join", { gameCode });
    }
  }, [connected, gameCode, emit]);

  useEffect(() => {
    if (!lastMessage) return;
    const { type, payload } = lastMessage;

    switch (type) {
      case "player_joined":
        setPlayers(prev => {
          if (prev.find(p => p.playerId === payload.playerId)) return prev;
          return [...prev, { nickname: payload.nickname, playerId: payload.playerId }];
        });
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
        setLeaderboard(payload.leaderboard);
        setTimer(0);
        setTimeout(() => setGameState("leaderboard"), 3000);
        break;

      case "game_ended":
        setGameState("podium");
        break;

      case "new_live_question": {
        const lq = payload as unknown as LiveQuestion;
        setLiveQuestions(prev => [...prev, lq]);
        if (!showQaPanel) {
          setUnreadQa(n => n + 1);
        }
        break;
      }

      case "live_question_answered": {
        const lq = payload as unknown as LiveQuestion;
        setLiveQuestions(prev => prev.map(q => q.id === lq.id ? lq : q));
        break;
      }
    }
  }, [lastMessage, showQaPanel]);

  useEffect(() => {
    if (gameState === "question" && timer > 0) {
      const int = setInterval(() => setTimer(t => Math.max(0, t - 1)), 1000);
      return () => clearInterval(int);
    }
  }, [gameState, timer]);

  useEffect(() => {
    if (gameState === "podium") {
      const duration = 5 * 1000;
      const end = Date.now() + duration;
      const frame = () => {
        confetti({ particleCount: 5, angle: 60, spread: 55, origin: { x: 0 }, colors: ["#E21B3C", "#1368CE", "#D89E00", "#26890C", "#8A2BE2"] });
        confetti({ particleCount: 5, angle: 120, spread: 55, origin: { x: 1 }, colors: ["#E21B3C", "#1368CE", "#D89E00", "#26890C", "#8A2BE2"] });
        if (Date.now() < end) requestAnimationFrame(frame);
      };
      frame();
    }
  }, [gameState]);

  if (isLoading) return <LoadingSpinner message="Loading Game..." />;
  if (!gameInfo) return <div>Game not found</div>;

  const handleStart = () => emit("start_game", { gameCode });
  const handleSkip = () => emit("end_question", { gameCode });
  const handleNext = () => emit("next_question", { gameCode });

  const handleSendAnswer = (questionId: string) => {
    const answer = (answerInputs[questionId] || "").trim();
    if (!answer) return;
    emit("answer_live_question", { gameCode, questionId, answer });
    setAnswerInputs(prev => ({ ...prev, [questionId]: "" }));
  };

  const unansweredCount = liveQuestions.filter(q => !q.answer).length;
  const qaButtonCount = showQaPanel ? 0 : unreadQa;

  return (
    <div className="min-h-screen bg-background flex flex-col font-sans overflow-hidden relative">

      {/* Dynamic Backgrounds */}
      <AnimatePresence>
        {gameState === "lobby" && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-primary z-0 pointer-events-none" />}
        {gameState === "question" && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-muted/30 z-0 pointer-events-none" />}
        {gameState === "leaderboard" && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-secondary z-0 pointer-events-none" />}
      </AnimatePresence>

      {/* Q&A Floating Button (visible during game, not lobby) */}
      {gameState !== "lobby" && gameState !== "podium" && (
        <button
          onClick={() => { setShowQaPanel(true); setUnreadQa(0); }}
          className="fixed bottom-6 right-6 z-30 flex items-center gap-2 bg-primary text-white px-4 py-3 rounded-2xl font-bold shadow-lg shadow-primary/40 hover:bg-primary/90 transition-all"
        >
          <MessageCircle size={20} />
          Q&A
          {qaButtonCount > 0 && (
            <span className="bg-red-500 text-white text-xs font-black w-6 h-6 rounded-full flex items-center justify-center -mr-1">
              {qaButtonCount}
            </span>
          )}
          {unansweredCount > 0 && qaButtonCount === 0 && (
            <span className="bg-yellow-400 text-black text-xs font-black w-6 h-6 rounded-full flex items-center justify-center -mr-1">
              {unansweredCount}
            </span>
          )}
        </button>
      )}

      {/* LOBBY STATE */}
      {gameState === "lobby" && (
        <div className="relative z-10 flex flex-col h-screen p-6 gap-6">
          {/* Top bar: PIN + QR + Start */}
          <div className="bg-white/10 backdrop-blur-md rounded-3xl p-6 flex flex-col md:flex-row gap-6 items-center justify-between shadow-2xl border border-white/20">
            {/* PIN */}
            <div className="flex flex-col items-center md:items-start">
              <p className="text-primary-foreground/80 font-bold text-lg uppercase tracking-widest mb-1">Join with PIN:</p>
              <h1 className="text-7xl md:text-8xl font-display font-black text-white tracking-widest drop-shadow-lg">{gameCode}</h1>
              <div className="flex items-center gap-2 mt-3">
                <Link2 size={14} className="text-white/60" />
                <span className="text-white/60 text-xs font-mono truncate max-w-xs">{joinUrl}</span>
                <button
                  onClick={handleCopyLink}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 text-white text-xs font-bold transition-colors ml-1 shrink-0"
                >
                  {copied ? <><Check size={13} /> Copied!</> : <><Copy size={13} /> Copy Link</>}
                </button>
              </div>
            </div>

            {/* QR Code */}
            <div className="flex flex-col items-center gap-2 shrink-0">
              <div className="bg-white p-3 rounded-2xl shadow-lg">
                <QRCodeSVG value={joinUrl} size={130} bgColor="#ffffff" fgColor="#1e1b4b" level="M" />
              </div>
              <p className="text-white/70 text-xs font-bold uppercase tracking-widest">Scan to Join</p>
            </div>

            {/* Start button */}
            <button
              onClick={handleStart}
              disabled={players.length === 0}
              className="game-button bg-white text-primary px-10 py-6 rounded-2xl text-3xl font-black shadow-[0_8px_0_0_rgba(0,0,0,0.2)] disabled:opacity-50 shrink-0"
            >
              Start
            </button>
          </div>

          {/* Players area */}
          <div className="flex-1 bg-white/5 backdrop-blur-sm rounded-3xl p-8 border border-white/10 overflow-y-auto">
            <div className="flex items-center gap-3 text-white mb-6">
              <Users size={32} />
              <span className="text-3xl font-display font-bold">{players.length} Players</span>
            </div>
            <div className="flex flex-wrap gap-4">
              <AnimatePresence>
                {players.map(p => (
                  <motion.div key={p.playerId} initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white text-primary px-6 py-3 rounded-full text-xl font-bold shadow-lg">
                    {p.nickname}
                  </motion.div>
                ))}
              </AnimatePresence>
              {players.length === 0 && <div className="w-full text-center text-white/50 text-2xl font-bold mt-20 animate-pulse">Waiting for players to join...</div>}
            </div>
          </div>
        </div>
      )}

      {/* QUESTION STATE */}
      {gameState === "question" && currentQuestion && (
        <div className="relative z-10 flex flex-col h-screen">
          <header className="bg-white p-4 flex justify-between items-center shadow-sm z-20 shrink-0">
            <div className="font-bold text-muted-foreground bg-muted px-4 py-2 rounded-full">{questionIndex + 1} of {totalQuestions}</div>
            <div className="font-display font-black text-4xl text-primary drop-shadow-sm">{timer}</div>
            <button onClick={handleSkip} className="game-button bg-primary text-white px-6 py-2 rounded-xl font-bold shadow-[0_4px_0_0_hsl(var(--primary-border))]">Skip</button>
          </header>
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center shrink-0">
            <h2 className="text-4xl md:text-6xl font-display font-black text-foreground max-w-5xl leading-tight">{currentQuestion.text}</h2>
          </div>
          <div className="w-full p-4 shrink-0">
            <div className="max-w-6xl mx-auto flex flex-col gap-6">
              <div className="flex justify-between items-end px-4">
                <div className="text-xl font-bold text-muted-foreground bg-white px-4 py-2 rounded-xl shadow-sm border border-border">
                  Answers: {answersCount} / {players.length || 1}
                </div>
              </div>
              <CountdownBar timeLimit={currentQuestion.timeLimit} timeLeft={timer} />
              <div className="h-[40vh]">
                <AnswerGrid options={currentQuestion.options} disabled={true} correctOption={correctOption ?? undefined} showResults={correctOption !== null} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* LEADERBOARD STATE */}
      {gameState === "leaderboard" && (
        <div className="relative z-10 flex flex-col h-screen items-center py-12 px-6">
          <div className="w-full max-w-4xl flex justify-between items-center mb-12">
            <h2 className="text-5xl font-display font-black text-foreground">Top 5</h2>
            <button onClick={handleNext} className="game-button bg-primary text-white px-8 py-4 rounded-2xl text-2xl font-black shadow-[0_6px_0_0_hsl(var(--primary-border))] flex items-center gap-2">
              Next <SkipForward />
            </button>
          </div>
          <div className="w-full max-w-3xl flex flex-col gap-4">
            <AnimatePresence>
              {leaderboard.slice(0, 5).map((player, idx) => (
                <motion.div key={player.nickname} initial={{ x: -50, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: idx * 0.1 }} className="bg-white p-6 rounded-2xl shadow-md border border-border flex justify-between items-center text-2xl font-bold">
                  <div className="flex items-center gap-4">
                    <span className="w-10 text-muted-foreground">{idx + 1}.</span>
                    <span className="text-foreground">{player.nickname}</span>
                  </div>
                  <span className="text-primary">{player.score}</span>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* PODIUM STATE */}
      {gameState === "podium" && (
        <div className="relative z-10 flex flex-col h-screen items-center justify-center bg-primary text-white p-6 overflow-hidden">
          <h1 className="text-6xl font-display font-black mb-20 drop-shadow-lg">Podium</h1>
          <div className="flex items-end justify-center gap-4 w-full max-w-4xl h-96">
            {leaderboard[1] && (
              <motion.div initial={{ y: 200 }} animate={{ y: 0 }} transition={{ delay: 0.5 }} className="w-1/3 flex flex-col items-center">
                <div className="text-2xl font-bold mb-4">{leaderboard[1].nickname}</div>
                <div className="text-xl mb-2">{leaderboard[1].score}</div>
                <div className="w-full h-48 bg-quiz-blue rounded-t-xl border-t-8 border-white/20 flex justify-center pt-4 shadow-2xl"><span className="text-5xl font-black opacity-50">2</span></div>
              </motion.div>
            )}
            {leaderboard[0] && (
              <motion.div initial={{ y: 300 }} animate={{ y: 0 }} transition={{ delay: 1 }} className="w-1/3 flex flex-col items-center z-10">
                <Trophy size={48} className="text-quiz-yellow mb-4 drop-shadow-lg" />
                <div className="text-3xl font-bold mb-4">{leaderboard[0].nickname}</div>
                <div className="text-xl mb-2">{leaderboard[0].score}</div>
                <div className="w-full h-64 bg-quiz-yellow rounded-t-xl border-t-8 border-white/20 flex justify-center pt-4 shadow-2xl"><span className="text-6xl font-black opacity-50">1</span></div>
              </motion.div>
            )}
            {leaderboard[2] && (
              <motion.div initial={{ y: 150 }} animate={{ y: 0 }} transition={{ delay: 0.2 }} className="w-1/3 flex flex-col items-center">
                <div className="text-2xl font-bold mb-4">{leaderboard[2].nickname}</div>
                <div className="text-xl mb-2">{leaderboard[2].score}</div>
                <div className="w-full h-40 bg-quiz-green rounded-t-xl border-t-8 border-white/20 flex justify-center pt-4 shadow-2xl"><span className="text-5xl font-black opacity-50">3</span></div>
              </motion.div>
            )}
          </div>
          <button onClick={() => setLocation("/dashboard")} className="mt-16 game-button bg-white text-primary px-8 py-4 rounded-2xl text-2xl font-black shadow-[0_6px_0_0_rgba(0,0,0,0.2)] flex items-center gap-2">
            <Home /> Dashboard
          </button>
        </div>
      )}

      {/* Q&A PANEL */}
      <AnimatePresence>
        {showQaPanel && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-40"
              onClick={() => setShowQaPanel(false)}
            />
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 280 }}
              className="fixed top-0 right-0 bottom-0 w-full max-w-md z-50 bg-white shadow-2xl flex flex-col"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
                <div className="flex items-center gap-2">
                  <MessageCircle size={22} className="text-primary" />
                  <div>
                    <h2 className="text-xl font-display font-black text-foreground leading-none">Live Q&A</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">{liveQuestions.length} question{liveQuestions.length !== 1 ? "s" : ""} from players</p>
                  </div>
                </div>
                <button onClick={() => setShowQaPanel(false)} className="text-muted-foreground hover:text-foreground p-1.5 rounded-lg hover:bg-muted transition-colors">
                  <X size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 min-h-0">
                {liveQuestions.length === 0 && (
                  <div className="flex-1 flex flex-col items-center justify-center text-center py-16">
                    <MessageCircle size={56} className="text-muted-foreground/20 mb-4" />
                    <p className="font-bold text-muted-foreground text-lg">No questions yet</p>
                    <p className="text-sm text-muted-foreground/70 mt-1">Players can ask questions during the game</p>
                  </div>
                )}
                {liveQuestions.map((q, idx) => (
                  <motion.div
                    key={q.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    className={`rounded-2xl border p-4 flex flex-col gap-3 ${q.answer ? "bg-green-50 border-green-200" : "bg-white border-border shadow-sm"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5">
                          <div className="w-7 h-7 bg-primary/10 rounded-full flex items-center justify-center shrink-0">
                            <span className="text-xs font-black text-primary">{q.nickname[0].toUpperCase()}</span>
                          </div>
                          <span className="text-sm font-bold text-primary truncate">{q.nickname}</span>
                          <span className="text-xs text-muted-foreground shrink-0">{new Date(q.askedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                        </div>
                        <p className="text-foreground font-medium text-sm leading-relaxed">{q.text}</p>
                      </div>
                      {q.answer && <CheckCircle2 size={18} className="text-green-600 shrink-0 mt-0.5" />}
                    </div>

                    {q.answer ? (
                      <div className="bg-white border border-green-200 rounded-xl px-3 py-2.5">
                        <p className="text-xs font-bold text-green-700 mb-0.5">Your reply:</p>
                        <p className="text-sm text-foreground">{q.answer}</p>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2 border border-border focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/30 transition-all">
                        <input
                          type="text"
                          placeholder="Type your reply..."
                          value={answerInputs[q.id] || ""}
                          onChange={e => setAnswerInputs(prev => ({ ...prev, [q.id]: e.target.value }))}
                          onKeyDown={e => e.key === "Enter" && handleSendAnswer(q.id)}
                          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none min-w-0"
                        />
                        <button
                          onClick={() => handleSendAnswer(q.id)}
                          disabled={!(answerInputs[q.id] || "").trim()}
                          className="w-7 h-7 bg-primary text-white rounded-lg flex items-center justify-center disabled:opacity-40 transition-opacity shrink-0"
                        >
                          <Send size={13} />
                        </button>
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
