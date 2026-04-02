import { useEffect, useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useGameWebSocket } from "@/hooks/use-websocket";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users, SkipForward, Trophy, Home,
  Copy, Check, Clock, Link2, Smartphone, WifiOff
} from "lucide-react";
import { CountdownBar, AnswerGrid } from "@/components/game-ui";
import confetti from "canvas-confetti";
import { QRCodeSVG } from "qrcode.react";

type GameState = "lobby" | "question" | "leaderboard" | "podium";

interface LeaderboardEntry {
  nickname: string;
  score: number;
  rank: number;
}

type HostQA = {
  id: string;
  text: string;
  answer: string | null;
  answeredBy: string | null;
  isPublic: boolean;
  askedAt: number;
};

const HOST_ACCESS_STORAGE_KEY = "quizblast_host_access_code";
const HOST_DISPLAY_NAME_STORAGE_KEY = "quizblast_host_display_name";

export default function HostGame() {
  const [, params] = useRoute("/host/:gameCode");
  const [, setLocation] = useLocation();
  const gameCode = params?.gameCode || "";

  const { connected, lastMessage, emit } = useGameWebSocket();

  const [gameState, setGameState] = useState<GameState>("lobby");
  const [players, setPlayers] = useState<Array<{ nickname: string; playerId: number }>>([]);
  const [currentQuestion, setCurrentQuestion] = useState<any>(null);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [totalQuestions, setTotalQuestions] = useState(0);
  const [answersCount, setAnswersCount] = useState(0);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [correctOption, setCorrectOption] = useState<number | null>(null);
  const [timer, setTimer] = useState(0);

  const [isTransitioning, setIsTransitioning] = useState(false);

  // FIXED: Missing Q&A state
  const [qaItems, setQaItems] = useState<HostQA[]>([]);
  const [showQaPanel, setShowQaPanel] = useState(false);
  const [unreadQa, setUnreadQa] = useState(0);

  const hostDisplayName =
    typeof window === "undefined"
      ? "Host"
      : window.sessionStorage.getItem(HOST_DISPLAY_NAME_STORAGE_KEY)?.trim() || "Host";

  const [copied, setCopied] = useState(false);

  // FIXED: Safe window usage
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const quizJoinUrl = `${origin}${import.meta.env.BASE_URL}?code=${gameCode}`.replace(/([^:])\/\//g, "$1/");
  const homeUrl = `${origin}${import.meta.env.BASE_URL}`.replace(/([^:])\/\//g, "$1/");

  // Generate join link
  const joinLink = quizJoinUrl;

  const handleCopyLink = (url: string) => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // JOIN SOCKET
  useEffect(() => {
    if (!connected || !gameCode) return;

    const accessKey =
      typeof window === "undefined"
        ? null
        : window.sessionStorage.getItem(HOST_ACCESS_STORAGE_KEY)?.trim() || null;

    emit("host_join", { gameCode, accessKey, hostName: hostDisplayName });
  }, [connected, gameCode, emit, hostDisplayName]);

  // SOCKET EVENTS
  useEffect(() => {
    if (!lastMessage) return;

    const { type, payload } = lastMessage;

    switch (type) {
      case "player_joined":
        setPlayers((prev) =>
          prev.find((p) => p.playerId === payload.playerId)
            ? prev
            : [...prev, { nickname: payload.nickname, playerId: payload.playerId }]
        );
        break;

      case "host_state_sync": {
        // Restore state after a page refresh or reconnect.
        const syncedPlayers = (payload.playerList as Array<{ playerId: number; nickname: string }>) ?? [];
        setPlayers(syncedPlayers);
        if (payload.status === "active" && payload.currentQuestion) {
          const q = payload.currentQuestion as any;
          setCurrentQuestion(q);
          setQuestionIndex(payload.currentQuestionIndex as number);
          setTotalQuestions(payload.totalQuestions as number);
          setTimer(q.timeLimit);
          setCorrectOption(null);
          setAnswersCount(0);
          setGameState("question");
        }
        break;
      }

      case "question_started":
        setIsTransitioning(false);
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
        setLeaderboard(payload.leaderboard || []);
        setTimer(0);
        setTimeout(() => setGameState("leaderboard"), 2500);
        break;

      case "game_ended":
        setGameState("podium");
        if (!showQaPanel) setUnreadQa((n) => n + 1);
        break;
    }
  }, [lastMessage, showQaPanel]);

  // TIMER
  useEffect(() => {
    if (gameState !== "question" || timer <= 0) return;

    const id = setInterval(() => setTimer((t) => Math.max(0, t - 1)), 1000);
    return () => clearInterval(id);
  }, [gameState, timer]);

  // CONFETTI
  useEffect(() => {
    if (gameState !== "podium") return;

    const end = Date.now() + 5000;

    const frame = () => {
      confetti({ particleCount: 5, angle: 60, spread: 55, origin: { x: 0 } });
      confetti({ particleCount: 5, angle: 120, spread: 55, origin: { x: 1 } });
      if (Date.now() < end) requestAnimationFrame(frame);
    };

    frame();
  }, [gameState]);

  if (!gameCode) return <div>Game not found</div>;

  // ACTIONS
  const handleStart = () => emit("start_game", { gameCode });
  const handleSkip = () => {
    if (isTransitioning) return;
    setIsTransitioning(true);
    emit("end_question", { gameCode });
  };
  const handleNext = () => {
    if (isTransitioning) return;
    setIsTransitioning(true);
    emit("next_question", { gameCode });
  };
  const handleDashboard = () => {
    if (gameState !== "lobby" && gameState !== "podium") {
      if (!window.confirm("Leave this game? All players will be disconnected.")) return;
    }
    setLocation("/dashboard");
  };

  // ---------------- UI ----------------
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0C214C] via-[#1A316C] to-[#0054FF] flex flex-col">
      {/* Connection loss banner */}
      {!connected && (
        <div className="bg-red-500 text-white text-center text-xs py-1.5 px-4 flex items-center justify-center gap-2">
          <WifiOff size={13} />
          Connection lost — reconnecting...
        </div>
      )}

      {/* Header */}
      <header className="bg-white/10 backdrop-blur-md border-b border-white/20 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
              <Trophy className="text-yellow-300" size={20} />
            </div>
            <div>
              <h1 className="text-2xl font-display font-black text-white">Game Host</h1>
              <p className="text-white/70 text-sm">Game Code: <span className="font-mono font-bold">{gameCode}</span></p>
            </div>
          </div>
          <button
            onClick={handleDashboard}
            className="px-4 py-2 rounded-xl bg-white/20 text-white hover:bg-white/30 transition-colors flex items-center gap-2"
          >
            <Home size={16} />
            Dashboard
          </button>
        </div>
      </header>

      {/* LOBBY */}
      {gameState === "lobby" && (
        <div className="flex-1 flex items-center justify-center p-8">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white/10 backdrop-blur-md rounded-3xl border border-white/20 p-8 max-w-4xl w-full"
          >
            <div className="text-center mb-8">
              <div className="w-20 h-20 rounded-2xl bg-white/20 flex items-center justify-center mx-auto mb-4">
                <Users className="text-white" size={40} />
              </div>
              <h2 className="text-3xl font-display font-black text-white mb-2">Game Lobby</h2>
              <p className="text-white/70">Waiting for players to join...</p>
            </div>

            <div className="grid md:grid-cols-2 gap-8 mb-6">
              {/* Left Column - Join Info */}
              <div className="space-y-4">
                <div className="bg-white/10 rounded-2xl p-6">
                  <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                    <Smartphone size={20} />
                    Join Options
                  </h3>
                  
                  {/* Game Code */}
                  <div className="mb-4">
                    <label className="text-white/70 text-sm block mb-2">Game Code</label>
                    <div className="flex gap-2">
                      <div className="flex-1 bg-white/20 rounded-xl px-4 py-3 text-center font-mono text-2xl font-bold text-white">
                        {gameCode}
                      </div>
                      <button
                        onClick={() => handleCopyLink(gameCode)}
                        className="px-4 py-3 rounded-xl bg-white/20 text-white hover:bg-white/30 transition-colors"
                      >
                        {copied ? <Check size={16} /> : <Copy size={16} />}
                      </button>
                    </div>
                  </div>

                  {/* Join Link */}
                  <div>
                    <label className="text-white/70 text-sm block mb-2">Join Link</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={joinLink}
                        readOnly
                        className="flex-1 bg-white/20 rounded-xl px-4 py-3 text-white font-mono text-sm"
                      />
                      <button
                        onClick={() => handleCopyLink(joinLink)}
                        className="px-4 py-3 rounded-xl bg-white/20 text-white hover:bg-white/30 transition-colors"
                      >
                        {copied ? <Check size={16} /> : <Copy size={16} />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column - QR Code */}
              <div className="bg-white/10 rounded-2xl p-6">
                <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                  <Link2 size={20} />
                  Scan to Join
                </h3>
                <div className="bg-white rounded-2xl p-4 flex justify-center">
                  <QRCodeSVG
                    value={joinLink}
                    size={200}
                    level="H"
                    includeMargin={true}
                  />
                </div>
                <p className="text-white/70 text-sm text-center mt-4">
                  Scan this QR code with your mobile device to join the quiz
                </p>
              </div>
            </div>

            <div className="bg-white/10 rounded-2xl p-6 mb-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-white">Players Joined</h3>
                <span className="bg-white/20 text-white px-3 py-1 rounded-full font-bold">
                  {players.length}
                </span>
              </div>
              
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {players.length === 0 ? (
                  <p className="text-white/50 text-center py-4">No players yet. Share the join options above!</p>
                ) : (
                  players.map((p) => (
                    <motion.div
                      key={p.playerId}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="bg-white/10 rounded-xl px-4 py-3 flex items-center gap-3"
                    >
                      <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                        <Users size={16} className="text-white" />
                      </div>
                      <span className="text-white font-medium">{p.nickname}</span>
                    </motion.div>
                  ))
                )}
              </div>
            </div>

            <button
              onClick={handleStart}
              disabled={!players.length}
              className="w-full px-6 py-4 rounded-xl bg-gradient-to-r from-green-400 to-green-600 text-white font-bold hover:from-green-500 hover:to-green-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-lg"
            >
              <Trophy size={20} />
              Start Game
            </button>
          </motion.div>
        </div>
      )}

      {/* QUESTION */}
      {gameState === "question" && currentQuestion && (
        <div className="flex-1 flex items-center justify-center p-8">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white/10 backdrop-blur-md rounded-3xl border border-white/20 p-8 max-w-4xl w-full"
          >
            <div className="text-center mb-6">
              <div className="flex items-center justify-between mb-4">
                <span className="text-white/70">
                  Question {questionIndex + 1} of {totalQuestions}
                  {questionIndex + 1 === totalQuestions && (
                    <span className="ml-2 text-yellow-300 font-bold text-xs uppercase tracking-wider">⭐ Final Question</span>
                  )}
                </span>
                <div className="flex items-center gap-2 text-white">
                  <Clock size={16} />
                  <span className="font-mono font-bold">{timer}s</span>
                </div>
              </div>
              <CountdownBar timeLimit={currentQuestion?.timeLimit ?? 30} timeLeft={timer} />
            </div>

            <div className="bg-white/10 rounded-2xl p-6 mb-6">
              <h2 className="text-2xl font-display font-bold text-white mb-2">{currentQuestion.text}</h2>
              <p className="text-white/70 text-sm">
                {answersCount} of {players.length} players answered
              </p>
            </div>

            <AnswerGrid
              options={currentQuestion.options}
              disabled
              correctOption={correctOption ?? undefined}
              showResults={correctOption !== null}
            />

            <div className="flex gap-4 mt-6">
              <button
                onClick={handleSkip}
                disabled={isTransitioning}
                className="px-6 py-3 rounded-xl bg-white/20 text-white hover:bg-white/30 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <SkipForward size={16} />
                Skip Question
              </button>
              {correctOption !== null && (
                <button
                  onClick={handleNext}
                  disabled={isTransitioning}
                  className="flex-1 px-6 py-3 rounded-xl bg-gradient-to-r from-blue-400 to-blue-600 text-white font-bold hover:from-blue-500 hover:to-blue-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {questionIndex + 1 === totalQuestions ? "View Final Results" : "Next Question"}
                </button>
              )}
            </div>
          </motion.div>
        </div>
      )}

      {/* LEADERBOARD */}
      {gameState === "leaderboard" && (
        <div className="flex-1 flex items-center justify-center p-8">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white/10 backdrop-blur-md rounded-3xl border border-white/20 p-8 max-w-2xl w-full"
          >
            <div className="text-center mb-8">
              <div className="w-20 h-20 rounded-2xl bg-white/20 flex items-center justify-center mx-auto mb-4">
                <Trophy className="text-yellow-300" size={40} />
              </div>
              <h2 className="text-3xl font-display font-black text-white mb-2">Leaderboard</h2>
              <p className="text-white/70">Question {questionIndex + 1} Results</p>
            </div>

            <div className="space-y-3 mb-6">
              {leaderboard.slice(0, 5).map((p, i) => (
                <motion.div
                  key={p.nickname}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.1 }}
                  className={`rounded-xl p-4 flex items-center gap-4 ${
                    i === 0 ? "bg-gradient-to-r from-yellow-400/30 to-yellow-600/30 border border-yellow-400/50" :
                    i === 1 ? "bg-gradient-to-r from-gray-400/30 to-gray-600/30 border border-gray-400/50" :
                    i === 2 ? "bg-gradient-to-r from-orange-400/30 to-orange-600/30 border border-orange-400/50" :
                    "bg-white/10"
                  }`}
                >
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-white ${
                    i === 0 ? "bg-yellow-500" :
                    i === 1 ? "bg-gray-500" :
                    i === 2 ? "bg-orange-500" :
                    "bg-white/20"
                  }`}>
                    {i + 1}
                  </div>
                  <div className="flex-1">
                    <p className="text-white font-bold">{p.nickname}</p>
                    <p className="text-white/70 text-sm">{p.score} points</p>
                  </div>
                  {i === 0 && <Trophy className="text-yellow-300" size={20} />}
                </motion.div>
              ))}
            </div>

            <button
              onClick={handleNext}
              disabled={isTransitioning}
              className="w-full px-6 py-3 rounded-xl bg-gradient-to-r from-blue-400 to-blue-600 text-white font-bold hover:from-blue-500 hover:to-blue-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {questionIndex + 1 === totalQuestions ? "View Final Results" : "Next Question"}
            </button>
          </motion.div>
        </div>
      )}

      {/* PODIUM */}
      {gameState === "podium" && (
        <div className="flex-1 flex items-center justify-center p-8">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white/10 backdrop-blur-md rounded-3xl border border-white/20 p-8 max-w-2xl w-full text-center"
          >
            <div className="mb-8">
              <div className="w-24 h-24 rounded-2xl bg-gradient-to-r from-yellow-400 to-yellow-600 flex items-center justify-center mx-auto mb-4">
                <Trophy className="text-white" size={48} />
              </div>
              <h1 className="text-4xl font-display font-black text-white mb-2">Game Complete!</h1>
              <p className="text-white/70">Final Results</p>
            </div>

            <div className="space-y-4 mb-8">
              {leaderboard.slice(0, 3).map((p, i) => (
                <motion.div
                  key={p.nickname}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.2 }}
                  className={`rounded-2xl p-6 ${
                    i === 0 ? "bg-gradient-to-r from-yellow-400/30 to-yellow-600/30 border-2 border-yellow-400" :
                    i === 1 ? "bg-gradient-to-r from-gray-400/30 to-gray-600/30 border-2 border-gray-400" :
                    "bg-gradient-to-r from-orange-400/30 to-orange-600/30 border-2 border-orange-400"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-white text-lg ${
                        i === 0 ? "bg-yellow-500" :
                        i === 1 ? "bg-gray-500" :
                        "bg-orange-500"
                      }`}>
                        {i + 1}
                      </div>
                      <div className="text-left">
                        <p className="text-white font-bold text-lg">{p.nickname}</p>
                        <p className="text-white/70">{p.score} points</p>
                      </div>
                    </div>
                    {i === 0 && <Trophy className="text-yellow-300" size={24} />}
                  </div>
                </motion.div>
              ))}
            </div>

            <button
              onClick={() => setLocation("/dashboard")}
              className="w-full px-6 py-3 rounded-xl bg-gradient-to-r from-green-400 to-green-600 text-white font-bold hover:from-green-500 hover:to-green-700 transition-all flex items-center justify-center gap-2"
            >
              <Home size={16} />
              Back to Dashboard
            </button>
          </motion.div>
        </div>
      )}
    </div>
  );
}