import { useEffect, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { MessageCircle, Play, Presentation, Send, Loader2, X } from "lucide-react";
import { useGameWebSocket } from "@/hooks/use-websocket";

interface HomeQAItem {
  id: string;
  text: string;
  answer: string | null;
  answeredBy: string | null;
  askedAt: number;
  answeredAt: number | null;
  isPublic: boolean;
  mine: boolean;
}

export default function Home() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);

  const prefilledCode =
    params.get("code")?.replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase() || "";

  const [activeMode, setActiveMode] = useState<"qa" | "quiz">("quiz");
  const [gameCode, setGameCode] = useState(prefilledCode);
  const [nickname, setNickname] = useState("");

  const { connected, lastMessage, emit } = useGameWebSocket();

  const QA_CLIENT_ID_KEY = "quizblast_qa_client_id";
  const [qaClientId, setQaClientId] = useState("");
  const [qaInput, setQaInput] = useState("");
  const [qaItems, setQaItems] = useState<HomeQAItem[]>([]);
  const [showQaModal, setShowQaModal] = useState(false);

  // CLIENT ID INIT
  useEffect(() => {
    if (typeof window === "undefined") return;

    const existing = sessionStorage.getItem(QA_CLIENT_ID_KEY);
    if (existing) {
      setQaClientId(existing);
      return;
    }

    const generated = `anon-${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(QA_CLIENT_ID_KEY, generated);
    setQaClientId(generated);
  }, []);

  // JOIN QA SOCKET
  useEffect(() => {
    if (!connected || !qaClientId) return;
    emit("qa_client_join", { clientId: qaClientId });
  }, [connected, qaClientId, emit]);

  // SOCKET HANDLER
  useEffect(() => {
    if (!lastMessage) return;

    const { type, payload } = lastMessage;

    if (type === "global_live_questions_list") {
      const questions = payload?.questions || [];
      setQaItems(
        questions.map((q: any) => ({
          id: String(q.id),
          text: String(q.text),
          answer: q.answer ?? null,
          answeredBy: q.answeredBy ?? null,
          askedAt: Number(q.askedAt),
          answeredAt: q.answeredAt ?? null,
          isPublic: Boolean(q.isPublic),
          mine: Boolean(q.mine),
        }))
      );
    }

    if (type === "global_new_question") {
      const q = payload as any;
      if (!q?.id) return;
      setQaItems((prev) =>
        prev.find((item) => item.id === String(q.id))
          ? prev
          : [
              ...prev,
              {
                id: String(q.id),
                text: String(q.text),
                answer: null,
                answeredBy: null,
                askedAt: Number(q.askedAt),
                answeredAt: null,
                isPublic: false,
                mine: Boolean(q.mine),
              },
            ]
      );
    }

    if (type === "global_qa_answered_private") {
      const q = payload as any;
      if (!q?.id) return;
      setQaItems((prev) =>
        prev.map((item) =>
          item.id === String(q.id)
            ? {
                ...item,
                answer: String(q.answer),
                answeredBy: q.answeredBy ?? item.answeredBy,
                answeredAt: q.answeredAt ?? Date.now(),
                isPublic: false,
              }
            : item
        )
      );
    }

    if (type === "global_qa_published") {
      const q = payload as any;
      if (!q?.id) return;
      setQaItems((prev) =>
        prev.map((item) =>
          item.id === String(q.id)
            ? {
                ...item,
                answer: q.answer ?? item.answer,
                answeredBy: q.answeredBy ?? item.answeredBy,
                answeredAt: q.answeredAt ?? item.answeredAt,
                isPublic: true,
              }
            : item
        )
      );
    }
  }, [lastMessage]);

  // JOIN QUIZ
  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!gameCode || !nickname) return;

    sessionStorage.setItem("quizblast_nickname", nickname);
    setLocation(`/play/${gameCode}?tab=game`);
  };

  return (
    <div className="min-h-screen relative overflow-hidden px-4 py-8 sm:px-6 lg:px-8">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-24 left-[-8%] h-72 w-72 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute bottom-[-5rem] right-[-4%] h-80 w-80 rounded-full bg-accent/10 blur-3xl" />
      </div>

      <div className="relative z-10 mx-auto grid min-h-[calc(100vh-4rem)] max-w-6xl items-center gap-8 lg:grid-cols-[1.15fr_0.85fr]">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="order-2 lg:order-1"
        >
          <div className="inline-flex items-center rounded-2xl bg-white/80 px-4 py-3 shadow-sm border border-border">
            <img
              src={`${import.meta.env.BASE_URL}images/logo-dark.webp`}
              alt="GoComet logo"
              className="h-10 w-auto object-contain"
            />
          </div>

          <h1 className="mt-5 text-5xl font-display font-black leading-tight text-foreground sm:text-6xl lg:text-7xl">
            GoComet
            <span className="block text-transparent bg-clip-text bg-gradient-to-r from-[#0C214C] via-[#1A316C] to-[#0054FF]">
              Townhall
            </span>
          </h1>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 max-w-xl">
            <div className="rounded-2xl border border-border bg-white/80 px-4 py-3 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Live</p>
              <p className="mt-1 text-sm font-semibold text-foreground">Real-time sessions</p>
            </div>
            <div className="rounded-2xl border border-border bg-white/80 px-4 py-3 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Fast</p>
              <p className="mt-1 text-sm font-semibold text-foreground">Instant join & launch</p>
            </div>
          </div>

          <Link href="/dashboard" className="mt-8 inline-block w-full md:w-auto">
            <button className="w-full game-button brand-gradient text-white px-8 py-4 rounded-2xl text-lg font-black shadow-[0_8px_24px_rgba(0,84,255,0.25)] flex justify-center items-center gap-3">
              <Presentation size={22} /> Open Host Console
            </button>
          </Link>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.1 }}
          className="order-1 lg:order-2"
        >
          <div className="glass-panel rounded-[28px] p-6 sm:p-8 relative overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-1.5 brand-gradient" />
            
            {/* Toggle Buttons */}
            <div className="mb-8">
              <div className="flex gap-4 p-1 bg-white/80 backdrop-blur-sm rounded-2xl border border-border">
                <button
                  onClick={() => setActiveMode("qa")}
                  className={`flex-1 px-6 py-4 rounded-2xl font-bold transition-all flex items-center justify-center gap-3 ${
                    activeMode === "qa" 
                      ? "bg-primary text-white shadow-lg shadow-primary/30" 
                      : "bg-white text-foreground border-2 border-border hover:bg-muted"
                  }`}
                >
                  <MessageCircle size={24} />
                  <div className="text-left">
                    <h3 className="text-lg font-display font-bold">Live Q&A</h3>
                    <p className="text-sm opacity-80">Ask questions anonymously during presentations</p>
                  </div>
                </button>
                
                <button
                  onClick={() => setActiveMode("quiz")}
                  className={`flex-1 px-6 py-4 rounded-2xl font-bold transition-all flex items-center justify-center gap-3 ${
                    activeMode === "quiz" 
                      ? "bg-primary text-white shadow-lg shadow-primary/30" 
                      : "bg-white text-foreground border-2 border-border hover:bg-muted"
                  }`}
                >
                  <Play size={24} />
                  <div className="text-left">
                    <h3 className="text-lg font-display font-bold">Join Quiz</h3>
                    <p className="text-sm opacity-80">Enter PIN and name to join a live quiz session</p>
                  </div>
                </button>
              </div>
            </div>

            {/* Conditional Content */}
            {activeMode === "qa" && (
              <div className="mb-5 rounded-2xl border border-primary/15 bg-primary/5 px-4 py-3">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">Live Q&A</p>
                <p className="mt-1 text-sm font-semibold text-foreground">Ask questions anonymously during the presentation.</p>
              </div>
            )}

            {activeMode === "qa" && (
              <div className="mb-5">
                <button
                  onClick={() => setShowQaModal(true)}
                  className="w-full bg-primary text-white px-6 py-3 rounded-2xl font-bold shadow-[0_4px_12px_rgba(0,84,255,0.25)] hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
                >
                  <MessageCircle size={18} />
                  Open Live Q&A
                </button>
              </div>
            )}

            {activeMode === "quiz" && (
              <form onSubmit={handleJoin} className="space-y-4">
                <input
                  type="text"
                  placeholder="Game PIN"
                  value={gameCode}
                  onChange={(e) => setGameCode(e.target.value.replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase())}
                  className="w-full rounded-2xl border border-border bg-white px-5 py-4 text-center text-3xl font-display font-black tracking-[0.35em] uppercase text-foreground shadow-sm focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/15 placeholder:text-muted-foreground/60"
                />
                <input
                  type="text"
                  placeholder="Your name"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value.slice(0, 15))}
                  className="w-full rounded-2xl border border-border bg-white px-5 py-4 text-lg font-semibold text-foreground shadow-sm focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/15 placeholder:text-muted-foreground/60"
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    type="submit"
                    disabled={!gameCode || !nickname}
                    className="w-full game-button brand-gradient py-4 rounded-2xl text-lg font-black text-white shadow-[0_8px_24px_rgba(0,84,255,0.24)] disabled:opacity-50 mt-2 flex justify-center items-center gap-2"
                  >
                    <Play fill="currentColor" size={18} /> Join Session
                  </button>
                </div>
              </form>
            )}
          </div>
        </motion.div>
      </div>

      {/* Q&A Modal */}
      <AnimatePresence>
        {showQaModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-40"
              onClick={() => setShowQaModal(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: "spring", damping: 25, stiffness: 400 }}
              className="fixed inset-4 md:inset-auto md:top-1/2 md:left-1/2 md:transform md:-translate-x-1/2 md:-translate-y-1/2 md:w-full md:max-w-lg md:max-h-[80vh] bg-white rounded-3xl shadow-2xl z-50 flex flex-col overflow-hidden"
            >
              {/* Modal Header */}
              <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-white">
                <div className="flex items-center gap-3">
                  <MessageCircle size={20} className="text-primary" />
                  <div>
                    <h2 className="text-lg font-display font-black text-foreground">Live Q&A</h2>
                    <p className="text-xs text-muted-foreground">Ask questions anonymously</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowQaModal(false)}
                  className="text-muted-foreground hover:text-foreground p-2 rounded-lg hover:bg-muted transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Q&A Content */}
              <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-4 min-h-0">
                {qaItems.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-center py-12">
                    <MessageCircle size={48} className="text-muted-foreground/20 mb-3" />
                    <p className="font-bold text-muted-foreground">No questions yet</p>
                    <p className="text-sm text-muted-foreground/70 mt-1">Be the first to ask a question!</p>
                  </div>
                ) : (
                  [...qaItems].reverse().map((q) => (
                    <div key={q.id} className={`rounded-2xl border p-4 ${q.isPublic ? "bg-green-50 border-green-200" : q.mine && q.answer ? "bg-blue-50 border-blue-200" : "bg-white border-border"}`}>
                      <p className="text-sm font-semibold text-foreground mb-3">{q.text}</p>
                      {q.answer ? (
                        <div className={`border-t pt-3 ${q.isPublic ? "border-green-200" : "border-blue-200"}`}>
                          <p className="text-xs font-bold uppercase tracking-wider mb-2">
                            {q.isPublic ? "Public reply" : "Your private reply"}
                          </p>
                          <p className="text-sm text-foreground">{q.answer}</p>
                          <p className="text-xs text-muted-foreground mt-1">by {q.answeredBy || "Host"}</p>
                        </div>
                      ) : q.mine ? (
                        <div className="border-t pt-3 border-border">
                          <p className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-2">
                            <Loader2 size={14} className="animate-spin" /> Waiting for host reply
                          </p>
                        </div>
                      ) : null}
                    </div>
                  ))
                )}
              </div>

              {/* Input Section */}
              <div className="p-6 border-t border-border bg-gray-50">
                <p className="text-xs text-muted-foreground text-center mb-3">Your question is sent anonymously to the host(s).</p>
                <div className="flex items-center gap-3 bg-white rounded-2xl px-4 py-3 border border-border focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 transition-all">
                  <input
                    type="text"
                    placeholder="Ask a question..."
                    value={qaInput}
                    onChange={(e) => setQaInput(e.target.value.slice(0, 200))}
                    onKeyDown={(e) => e.key === "Enter" && (() => {
                      if (!qaInput.trim() || !connected) return;
                      emit("ask_global_question", { text: qaInput });
                      setQaInput("");
                    })()}
                    className="flex-1 bg-transparent text-sm font-medium text-foreground placeholder:text-muted-foreground focus:outline-none"
                  />
                  <button
                    onClick={() => {
                      if (!qaInput.trim() || !connected) return;
                      emit("ask_global_question", { text: qaInput });
                      setQaInput("");
                    }}
                    disabled={!qaInput.trim() || !connected}
                    className="w-10 h-10 bg-primary text-white rounded-xl flex items-center justify-center disabled:opacity-40 transition-opacity shrink-0"
                    title="Send"
                  >
                    <Send size={16} />
                  </button>
                </div>
                <p className="text-xs text-muted-foreground text-right mt-2">{qaInput.length}/200</p>
                {!connected && (
                  <p className="text-xs text-orange-600 text-center mt-2 flex items-center justify-center gap-2">
                    <Loader2 size={14} className="animate-spin" /> Connecting to server...
                  </p>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}