import { useEffect, useState } from "react";
import { useLocation, Link } from "wouter";
import { motion } from "framer-motion";
import { MessageCircle, Clock, CheckCircle2, LogOut, Shield, ArrowLeft, Globe, Monitor } from "lucide-react";
import { useGameWebSocket } from "@/hooks/use-websocket";
import { LoadingSpinner } from "@/components/game-ui";

const HOST_ACCESS_STORAGE_KEY = "quizblast_host_access_code";
const HOST_DISPLAY_NAME_STORAGE_KEY = "quizblast_host_display_name";

interface QAItem {
  id: string;
  text: string;
  isPublic: boolean;
  askedAt: number;
  mine: boolean;
}

export default function QA() {
  const [, setLocation] = useLocation();
  const { connected, lastMessage, emit } = useGameWebSocket();

  const [qaItems, setQaItems] = useState<QAItem[]>([]);
  const [showQaPanel, setShowQaPanel] = useState(true);
  const [unreadQa, setUnreadQa] = useState(0);

  const [hasHostAccess, setHasHostAccess] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [authError, setAuthError] = useState("");

  const apiOrigin = import.meta.env.VITE_API_ORIGIN?.trim();
  const apiUrl = (path: string) => (apiOrigin ? `${apiOrigin}${path}` : path);

  const getStoredHostAccessCode = () =>
    typeof window !== "undefined"
      ? window.localStorage.getItem(HOST_ACCESS_STORAGE_KEY) || ""
      : "";

  const getHostAccessHeaders = () => {
    const code = getStoredHostAccessCode();
    return code ? { "x-host-access-code": code } : undefined;
  };

  // ACCESS CHECK
  useEffect(() => {
    const checkAccess = async () => {
      try {
        const res = await fetch(apiUrl("/api/host-access/status"), {
          credentials: "include",
          headers: getHostAccessHeaders(),
        });

        const data = await res.json();
        setHasHostAccess(Boolean(data?.authenticated));

        if (!data?.authenticated) {
          setAuthError("Host access required.");
          setTimeout(() => setLocation("/dashboard"), 2000);
        }
      } catch {
        setAuthError("Could not verify host access.");
        setTimeout(() => setLocation("/dashboard"), 2000);
      } finally {
        setCheckingAccess(false);
      }
    };

    checkAccess();
  }, [setLocation]);

  // SOCKET JOIN
  useEffect(() => {
    if (!hasHostAccess || !connected) return;

    const hostName =
      typeof window !== "undefined"
        ? window.localStorage.getItem(HOST_DISPLAY_NAME_STORAGE_KEY) || "Host"
        : "Host";

    emit("qa_host_join", { accessKey: getStoredHostAccessCode(), hostName });
    emit("get_live_questions", {});
  }, [hasHostAccess, connected, emit]);

  // SOCKET HANDLER
  useEffect(() => {
    if (!lastMessage || !hasHostAccess) return;

    const { type, payload } = lastMessage;

    switch (type) {
      case "error": {
        const errorMessage = payload?.message || payload?.error || "Unknown server error";
        setAuthError(`Q&A Error: ${errorMessage}`);
        if (errorMessage?.toLowerCase().includes("unauthorized") || errorMessage?.toLowerCase().includes("access denied")) {
          setTimeout(() => setLocation("/dashboard"), 3000);
        }
        break;
      }

      case "live_questions_list":
      case "global_live_questions_list": {
        const questions = Array.isArray(payload?.questions) ? payload.questions : [];
        setQaItems(
          questions
            .map((q: any) => ({
              id: String(q.id),
              text: String(q.text),
              isPublic: Boolean(q.isPublic),
              askedAt: Number(q.askedAt),
              mine: Boolean(q.mine),
            }))
            .sort((a: QAItem, b: QAItem) => a.askedAt - b.askedAt)
        );
        break;
      }

      case "new_live_question":
      case "global_new_question":
      case "ask_question": {
        if (!payload) return;
        const q: QAItem = {
          id: String(payload.id),
          text: String(payload.text),
          isPublic: false,
          askedAt: Number(payload.askedAt),
          mine: false,
        };
        setQaItems(prev => prev.find(item => item.id === q.id) ? prev : [...prev, q]);
        if (!showQaPanel) setUnreadQa(n => n + 1);
        break;
      }

      case "global_qa_published":
      case "qa_answered": {
        const id = String(payload?.id);
        setQaItems((prev) =>
          prev.map((q) =>
            q.id === id ? { ...q, isPublic: true } : q
          )
        );
        break;
      }
    }
  }, [lastMessage, hasHostAccess]);

  const handleLogout = async () => {
    await fetch(apiUrl("/api/host-access/logout"), {
      method: "POST",
      credentials: "include",
    });
    localStorage.removeItem(HOST_ACCESS_STORAGE_KEY);
    localStorage.removeItem(HOST_DISPLAY_NAME_STORAGE_KEY);
    setLocation("/dashboard");
  };

  const handlePublish = (qId: string) => {
    emit("publish_global_question", { questionId: qId });
    setQaItems((prev) =>
      prev.map((q) => (q.id === qId ? { ...q, isPublic: true } : q))
    );
  };

  if (checkingAccess) return <LoadingSpinner message="Checking host access..." />;

  if (!hasHostAccess) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div>
          <Shield />
          <p>{authError}</p>
        </div>
      </div>
    );
  }

  const pendingCount = qaItems.filter(q => !q.isPublic).length;
  const publicCount = qaItems.filter(q => q.isPublic).length;

  return (
    <div className="min-h-screen bg-muted/40">
      <header className="bg-white border-b border-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/dashboard">
              <button className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                <ArrowLeft size={16} /> Dashboard
              </button>
            </Link>
            <div className="w-px h-5 bg-border" />
            <MessageCircle size={20} className="text-primary" />
            <h1 className="text-xl font-display font-bold text-foreground">Q&A Management</h1>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={`${import.meta.env.BASE_URL}public-qa`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold text-green-700 bg-green-50 border border-green-200 hover:bg-green-100 transition-colors"
            >
              <Monitor size={16} /> Open Display Screen
            </a>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            >
              <LogOut size={16} /> Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats row */}
        <div className="flex gap-4 mb-6">
          <div className="bg-white rounded-xl border border-border px-5 py-3 flex items-center gap-3">
            <MessageCircle size={18} className="text-orange-500" />
            <div>
              <p className="text-xs text-muted-foreground font-medium">Pending</p>
              <p className="text-2xl font-display font-black text-foreground">{pendingCount}</p>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-border px-5 py-3 flex items-center gap-3">
            <Globe size={18} className="text-green-500" />
            <div>
              <p className="text-xs text-muted-foreground font-medium">Public</p>
              <p className="text-2xl font-display font-black text-foreground">{publicCount}</p>
            </div>
          </div>
        </div>

        {/* Q&A Panel */}
        <div className="bg-white rounded-2xl border border-border shadow-lg">
          <div className="flex items-center justify-between p-6 border-b border-border">
            <div className="flex items-center gap-3">
              <MessageCircle size={24} className="text-primary" />
              <div>
                <h2 className="text-2xl font-display font-black text-foreground">Live Q&A Inbox</h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Click "Share Publicly" to show a question on the live display screen
                </p>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            {qaItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <MessageCircle size={48} className="text-muted-foreground/20 mb-4" />
                <h3 className="text-xl font-display font-bold text-muted-foreground mb-2">No questions yet</h3>
                <p className="text-sm text-muted-foreground">Questions will appear here when participants ask them.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {qaItems.map((q) => (
                  <motion.div
                    key={q.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`rounded-2xl border p-4 ${
                      q.isPublic ? "bg-green-50 border-green-200" : "bg-white border-border"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-foreground mb-2">{q.text}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Clock size={12} />
                          <span>{new Date(q.askedAt).toLocaleTimeString()}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {q.isPublic ? (
                          <div className="px-3 py-1.5 rounded-lg bg-green-100 text-green-700 text-xs font-semibold flex items-center gap-1.5">
                            <Globe size={12} />
                            Public
                          </div>
                        ) : (
                          <button
                            onClick={() => handlePublish(q.id)}
                            className="px-3 py-2 rounded-lg border border-green-200 bg-green-50 text-green-700 text-sm font-medium hover:bg-green-100 transition-colors flex items-center gap-2"
                          >
                            <CheckCircle2 size={14} />
                            Share Publicly
                          </button>
                        )}
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
