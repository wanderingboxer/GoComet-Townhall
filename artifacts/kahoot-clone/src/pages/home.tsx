import { useEffect, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { motion } from "framer-motion";
import { MessageCircle, Play, Presentation, Send, Loader2 } from "lucide-react";
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
  const prefilledCode = params.get("code")?.replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase() || "";
  const [gameCode, setGameCode] = useState(prefilledCode);
  const [nickname, setNickname] = useState("");

  const { connected, lastMessage, emit } = useGameWebSocket();

  const QA_CLIENT_ID_KEY = "quizblast_qa_client_id";
  const [qaClientId, setQaClientId] = useState<string>("");
  const [qaInput, setQaInput] = useState("");
  const [qaItems, setQaItems] = useState<HomeQAItem[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const existing = window.sessionStorage.getItem(QA_CLIENT_ID_KEY);
    if (existing) {
      setQaClientId(existing);
      return;
    }
    const generated = `anon-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36).slice(-4)}`;
    window.sessionStorage.setItem(QA_CLIENT_ID_KEY, generated);
    setQaClientId(generated);
  }, []);

  useEffect(() => {
    if (!connected || !qaClientId) return;
    emit("qa_client_join", { clientId: qaClientId });
  }, [connected, qaClientId, emit]);

  useEffect(() => {
    if (!lastMessage) return;
    const { type, payload } = lastMessage;

    switch (type) {
      case "global_live_questions_list": {
        const questions = Array.isArray(payload?.questions) ? payload.questions : [];
        setQaItems(
          questions
            .map((q: any) => ({
              id: String(q.id),
              text: String(q.text),
              answer: q.answer === null || q.answer === undefined ? null : String(q.answer),
              answeredBy: q.answeredBy === null || q.answeredBy === undefined ? null : String(q.answeredBy),
              askedAt: Number(q.askedAt),
              answeredAt: q.answeredAt === null || q.answeredAt === undefined ? null : Number(q.answeredAt),
              isPublic: Boolean(q.isPublic),
              mine: Boolean(q.mine),
            }))
            .sort((a: HomeQAItem, b: HomeQAItem) => a.askedAt - b.askedAt),
        );
        break;
      }
      case "global_new_question": {
        const mine = Boolean((payload as any)?.mine);
        const id = String((payload as any)?.id);
        const next: HomeQAItem = {
          id,
          text: String((payload as any)?.text ?? ""),
          answer: null,
          answeredBy: null,
          askedAt: Number((payload as any)?.askedAt ?? Date.now()),
          answeredAt: null,
          isPublic: false,
          mine,
        };
        setQaItems((prev) => {
          const exists = prev.some((x) => x.id === id);
          if (exists) return prev.map((x) => (x.id === id ? { ...x, ...next } : x));
          return [...prev, next].sort((a, b) => a.askedAt - b.askedAt);
        });
        break;
      }
      case "global_qa_answered_private": {
        const id = String((payload as any)?.id);
        const answered: HomeQAItem = {
          id,
          text: String((payload as any)?.text ?? ""),
          answer: String((payload as any)?.answer ?? ""),
          answeredBy: (payload as any)?.answeredBy ? String((payload as any).answeredBy) : null,
          askedAt: Number((payload as any)?.askedAt ?? Date.now()),
          answeredAt: Number((payload as any)?.answeredAt ?? Date.now()),
          isPublic: false,
          mine: true,
        };
        setQaItems((prev) => {
          const exists = prev.some((x) => x.id === id);
          if (exists) return prev.map((x) => (x.id === id ? { ...x, ...answered } : x));
          return [...prev, answered].sort((a, b) => a.askedAt - b.askedAt);
        });
        break;
      }
      case "global_qa_published": {
        const id = String((payload as any)?.id);
        const answered: HomeQAItem = {
          id,
          text: String((payload as any)?.text ?? ""),
          answer: String((payload as any)?.answer ?? ""),
          answeredBy: (payload as any)?.answeredBy ? String((payload as any).answeredBy) : null,
          askedAt: Number((payload as any)?.askedAt ?? Date.now()),
          answeredAt: Number((payload as any)?.answeredAt ?? Date.now()),
          isPublic: true,
          mine: Boolean((payload as any)?.mine),
        };
        setQaItems((prev) => {
          const exists = prev.some((x) => x.id === id);
          if (exists) return prev.map((x) => (x.id === id ? { ...x, ...answered } : x));
          return [...prev, answered].sort((a, b) => a.askedAt - b.askedAt);
        });
        break;
      }
    }
  }, [lastMessage]);

  const joinSession = () => {
    if (!gameCode || !nickname) return;

    sessionStorage.setItem("quizblast_nickname", nickname);
    setLocation(`/play/${gameCode.toUpperCase()}?tab=game`);
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    joinSession();
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
            <div className="mb-6">
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-primary">Join a live session</p>
              <h2 className="mt-2 text-3xl font-display font-black text-foreground">Enter your game PIN</h2>
              <p className="mt-2 text-sm text-muted-foreground">Use the PIN shared by the host to enter the GoComet quiz room.</p>
            </div>

            <div className="mb-5 rounded-2xl border border-primary/15 bg-primary/5 px-4 py-3">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">Live Q&A</p>
              <p className="mt-1 text-sm font-semibold text-foreground">Ask questions anonymously during the presentation.</p>
            </div>

            <form onSubmit={handleJoin} className="space-y-4">
              <input
                type="text"
                placeholder="Game PIN"
                value={gameCode}
                onChange={(e) => setGameCode(e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase())}
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

            {/* Q&A (always available) */}
            <div className="mt-6 rounded-3xl border border-border/70 bg-white/60 backdrop-blur-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MessageCircle size={18} className="text-primary" />
                  <p className="font-bold text-sm text-foreground">Live Q&A</p>
                </div>
                {!connected ? (
                  <span className="text-xs text-muted-foreground flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin" /> Connecting
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">Connected</span>
                )}
              </div>

              <div className="max-h-[220px] overflow-y-auto p-4 flex flex-col gap-3">
                {qaItems.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-center py-8">
                    <MessageCircle size={44} className="text-muted-foreground/20 mb-2" />
                    <p className="font-bold text-muted-foreground">No questions yet</p>
                    <p className="text-sm text-muted-foreground/70 mt-1">Ask any time during the presentation.</p>
                  </div>
                ) : (
                  [...qaItems].reverse().map((q) => (
                    <div key={q.id} className={`rounded-2xl border p-3 ${q.isPublic ? "bg-green-50 border-green-200" : q.mine && q.answer ? "bg-blue-50 border-blue-200" : "bg-white border-border"}`}>
                      <p className="text-sm font-semibold text-foreground mb-2">{q.text}</p>
                      {q.answer ? (
                        <div className={`border-t pt-3 ${q.isPublic ? "border-green-200" : "border-blue-200"}`}>
                          <p className="text-xs font-bold uppercase tracking-wider mb-1">
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

              <div className="p-4 border-t border-border bg-white">
                <p className="text-xs text-muted-foreground text-center mb-2">Your question is sent anonymously to the host(s).</p>
                <div className="flex items-center gap-2 bg-muted rounded-2xl px-4 py-3 border border-border focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 transition-all">
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
                    className="w-9 h-9 bg-primary text-white rounded-xl flex items-center justify-center disabled:opacity-40 transition-opacity shrink-0"
                    title="Send"
                  >
                    <Send size={15} />
                  </button>
                </div>
                <p className="text-xs text-muted-foreground text-right mt-1">{qaInput.length}/200</p>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
