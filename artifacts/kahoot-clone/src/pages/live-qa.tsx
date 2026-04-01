import { useEffect, useState } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { MessageCircle, Send, ArrowLeft } from "lucide-react";
import { useGameWebSocket } from "@/hooks/use-websocket";

interface HomeQAItem {
  id: string;
  text: string;
  isPublic: boolean;
  askedAt: number;
  mine: boolean;
}

const QA_CLIENT_ID_KEY = "quizblast_qa_client_id";

export default function LiveQA() {
  const { connected, lastMessage, emit } = useGameWebSocket();
  const [qaClientId, setQaClientId] = useState("");
  const [qaInput, setQaInput] = useState("");
  const [qaItems, setQaItems] = useState<HomeQAItem[]>([]);

  // Init client ID
  useEffect(() => {
    if (typeof window === "undefined") return;
    const existing = sessionStorage.getItem(QA_CLIENT_ID_KEY);
    if (existing) { setQaClientId(existing); return; }
    const generated = `anon-${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(QA_CLIENT_ID_KEY, generated);
    setQaClientId(generated);
  }, []);

  // Join QA socket
  useEffect(() => {
    if (!connected || !qaClientId) return;
    emit("qa_client_join", { clientId: qaClientId });
  }, [connected, qaClientId, emit]);

  // Socket handler
  useEffect(() => {
    if (!lastMessage) return;
    const { type, payload } = lastMessage;

    if (type === "global_live_questions_list") {
      const questions = payload?.questions || [];
      setQaItems(
        questions.map((q: any) => ({
          id: String(q.id),
          text: String(q.text),
          isPublic: Boolean(q.isPublic),
          askedAt: Number(q.askedAt),
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
          : [...prev, { id: String(q.id), text: String(q.text), isPublic: false, askedAt: Number(q.askedAt), mine: Boolean(q.mine) }]
      );
    }

    if (type === "global_qa_published") {
      const q = payload as any;
      if (!q?.id) return;
      setQaItems((prev) =>
        prev.map((item) =>
          item.id === String(q.id) ? { ...item, isPublic: true } : item
        )
      );
    }
  }, [lastMessage]);

  const handleSend = () => {
    if (!qaInput.trim() || !connected) return;
    emit("ask_global_question", { text: qaInput });
    setQaInput("");
  };

  const myQuestions = qaItems.filter((q) => q.mine);

  return (
    <div className="min-h-screen bg-muted/30 flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-white/90 backdrop-blur-md border-b border-border px-4 sm:px-6 py-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/">
              <button className="flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-lg hover:bg-muted">
                <ArrowLeft size={18} />
                <span className="hidden sm:inline">Back</span>
              </button>
            </Link>
            <div className="w-px h-5 bg-border" />
            <div className="flex items-center gap-2">
              <MessageCircle size={20} className="text-primary" />
              <div>
                <h1 className="text-base font-display font-black text-foreground leading-none">Live Q&amp;A</h1>
                <p className="text-[11px] text-muted-foreground mt-0.5">Anonymous questions</p>
              </div>
            </div>
          </div>
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border ${connected ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-muted text-muted-foreground border-border"}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-emerald-500" : "bg-muted-foreground"}`} />
            {connected ? "Live" : "Connecting…"}
          </div>
        </div>
      </header>

      {/* Ask Box */}
      <div className="bg-white border-b border-border px-4 sm:px-6 py-5">
        <div className="max-w-2xl mx-auto">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Ask a question</p>
          <div className="flex items-center gap-3 bg-muted/60 rounded-2xl px-4 py-3 border border-border focus-within:bg-white focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/10 transition-all">
            <input
              type="text"
              placeholder="Type your question…"
              value={qaInput}
              onChange={(e) => setQaInput(e.target.value.slice(0, 200))}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              className="flex-1 bg-transparent text-sm font-medium text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
            />
            <button
              onClick={handleSend}
              disabled={!qaInput.trim() || !connected}
              className="w-9 h-9 bg-primary text-white rounded-xl flex items-center justify-center disabled:opacity-40 transition-opacity shrink-0 hover:bg-primary/90"
            >
              <Send size={15} />
            </button>
          </div>
          <div className="flex justify-between items-center mt-1.5 px-1">
            <p className="text-[11px] text-muted-foreground">{qaInput.length}/200</p>
          </div>
        </div>
      </div>

      {/* Main content */}
      <main className="flex-1 px-4 sm:px-6 py-6 max-w-2xl mx-auto w-full space-y-8">

        {/* My Questions */}
        {myQuestions.length > 0 && (
          <section>
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Your questions</h2>
            <div className="space-y-3">
              <AnimatePresence>
                {[...myQuestions].reverse().map((q) => (
                  <motion.div
                    key={q.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-2xl border p-4 bg-white border-border"
                  >
                    <p className="text-sm font-semibold text-foreground">{q.text}</p>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </section>
        )}

        {myQuestions.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <MessageCircle size={40} className="text-muted-foreground/15 mb-3" />
            <p className="text-sm font-semibold text-muted-foreground">Ask a question above to get started</p>
          </div>
        )}
      </main>
    </div>
  );
}
