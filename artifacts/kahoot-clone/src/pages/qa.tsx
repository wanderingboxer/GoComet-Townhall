import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { MessageCircle, Send, Clock, CheckCircle2, LogOut, Shield, Settings } from "lucide-react";
import { useGameWebSocket } from "@/hooks/use-websocket";
import { LoadingSpinner } from "@/components/game-ui";

const HOST_ACCESS_STORAGE_KEY = "quizblast_host_access_code";
const HOST_DISPLAY_NAME_STORAGE_KEY = "quizblast_host_display_name";

interface QAItem {
  id: string;
  text: string;
  answer: string | null;
  answeredBy: string | null;
  isPublic: boolean;
  askedAt: number;
  answeredAt: number | null;
  mine: boolean;
}

export default function QA() {
  const [, setLocation] = useLocation();
  const { connected, lastMessage, emit } = useGameWebSocket();

  const [qaItems, setQaItems] = useState<QAItem[]>([]);
  const [qaAnswers, setQaAnswers] = useState<Record<string, string>>({});
  const [showQaPanel, setShowQaPanel] = useState(true);
  const [unreadQa, setUnreadQa] = useState(0);

  const [hasHostAccess, setHasHostAccess] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [authError, setAuthError] = useState("");

  const apiOrigin = import.meta.env.VITE_API_ORIGIN?.trim();
  const apiUrl = (path: string) => (apiOrigin ? `${apiOrigin}${path}` : path);

  const getStoredHostAccessCode = () =>
    typeof window !== "undefined"
      ? window.sessionStorage.getItem(HOST_ACCESS_STORAGE_KEY) || ""
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
        ? window.sessionStorage.getItem(HOST_DISPLAY_NAME_STORAGE_KEY) || "Host"
        : "Host";

    console.log("QA: Joining as host", { gameCode: "qa-room", accessKey: getStoredHostAccessCode(), hostName });
    
    emit("host_join", {
      gameCode: "qa-room",
      accessKey: getStoredHostAccessCode(),
      hostName,
    });

    console.log("QA: Requesting questions");
    emit("get_live_questions", {});
  }, [hasHostAccess, connected, emit]);

  // SOCKET HANDLER
  useEffect(() => {
    console.log("QA: Message handler triggered", { hasLastMessage: !!lastMessage, hasHostAccess, connected });
    
    if (!lastMessage || !hasHostAccess) return;

    const { type, payload } = lastMessage;
    console.log("QA: Received message", { type, payload });

    switch (type) {
      case "error": {
        console.error("QA: Server error", payload);
        // Show specific error to user
        const errorMessage = payload?.message || payload?.error || "Unknown server error";
        setAuthError(`Q&A Error: ${errorMessage}`);
        
        // If it's an authentication error, redirect to dashboard
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
              answer: q.answer ?? null,
              answeredBy: q.answeredBy ?? null,
              isPublic: Boolean(q.isPublic),
              askedAt: Number(q.askedAt),
              answeredAt: q.answeredAt ?? null,
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
          answer: null,
          answeredBy: null,
          isPublic: false,
          askedAt: Number(payload.askedAt),
          answeredAt: null,
          mine: Boolean(payload?.playerId === playerId),
        };
        setQaItems(prev => prev.find(item => item.id === q.id) ? prev : [...prev, q]);
        if (!showQaPanel) setUnreadQa(n => n + 1);
        break;
      }

      case "global_qa_answered":
      case "qa_answered": {
        const id = String(payload?.id);

        setQaItems((prev) =>
          prev.map((q) =>
            q.id === id
              ? {
                  ...q,
                  answer: String(payload?.answer),
                  answeredBy: payload?.answeredBy ?? q.answeredBy,
                  isPublic: Boolean(payload?.isPublic),
                  answeredAt: Date.now(),
                }
              : q
          )
        );
        break;
      }

      case "global_qa_published": {
        const id = String(payload?.id);

        setQaItems((prev) =>
          prev.map((q) =>
            q.id === id
              ? {
                  ...q,
                  isPublic: true,
                  answeredAt: Date.now(),
                }
              : q
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

    sessionStorage.clear();
    setLocation("/dashboard");
  };

  const handleSendAnswer = (qId: string) => {
    console.log("QA: Send answer attempt", { 
      qId, 
      answer: qaAnswers[qId], 
      connected, 
      hasHostAccess 
    });
    
    const answer = (qaAnswers[qId] || "").trim();
    if (!answer) {
      console.log("QA: No answer provided, returning");
      return;
    }

    console.log("QA: Sending answer", { questionId: qId, answer });

    emit("answer_global_question", { questionId: qId, answer });

    console.log("QA: Updating local state immediately");
    setQaItems((prev) =>
      prev.map((q) =>
        q.id === qId
          ? { ...q, answer, answeredBy: "Host", answeredAt: Date.now() }
          : q
      )
    );

    setQaAnswers((prev) => ({ ...prev, [qId]: "" }));
  };

  const handlePublish = (qId: string) => {
    const question = qaItems.find((q) => q.id === qId);
    if (!question || !question.answer) return;

    console.log("QA: Publishing question", { questionId: qId, answer: question.answer });
    
    emit("publish_question", { questionId: qId });

    console.log("QA: Updating local state to make public");
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

  return (
    <div className="min-h-screen bg-muted/40">
      <header className="bg-white border-b border-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <MessageCircle size={24} className="text-primary" />
            <h1 className="text-2xl font-display font-bold text-foreground">Q&A Management</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowQaPanel(!showQaPanel)}
              className="p-2 rounded-lg hover:bg-muted transition-colors"
            >
              <Settings size={20} />
            </button>
            <button
              onClick={handleLogout}
              className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground"
            >
              <LogOut size={20} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
          {/* Q&A Panel */}
          <div className="bg-white rounded-2xl border border-border shadow-lg">
            <div className="flex items-center justify-between p-6 border-b border-border">
              <div className="flex items-center gap-3">
                <MessageCircle size={24} className="text-primary" />
                <div>
                  <h2 className="text-2xl font-display font-black text-foreground">Live Q&A Inbox</h2>
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
                        q.isPublic ? "bg-green-50 border-green-200" : 
                        q.answer ? "bg-blue-50 border-blue-200" : 
                        "bg-white border-border"
                      }`}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-foreground mb-2">{q.text}</p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Clock size={12} />
                            <span>{new Date(q.askedAt).toLocaleTimeString()}</span>
                          </div>
                        </div>
                        {q.answer ? (
                          <div className={`px-2 py-1 rounded-lg text-xs font-medium ${
                            q.isPublic ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"
                          }`}>
                            {q.isPublic ? "Public Reply" : "Private Reply"}
                          </div>
                        ) : (
                          <div className="px-2 py-1 rounded-lg bg-orange-100 text-orange-700 text-xs font-medium">
                            Unanswered
                          </div>
                        )}
                      </div>

                      {q.answer && (
                        <div className="border-t pt-3">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <p className="text-sm text-foreground mb-2">{q.answer}</p>
                              <p className="text-xs text-muted-foreground">by {q.answeredBy || "Host"}</p>
                            </div>
                            {!q.isPublic && (
                              <button
                                onClick={() => handlePublish(q.id)}
                                className="ml-4 px-3 py-2 rounded-lg border border-green-200 bg-green-50 text-green-700 text-sm font-medium hover:bg-green-100 transition-colors flex items-center gap-2"
                              >
                                <CheckCircle2 size={14} />
                                Make Public
                              </button>
                            )}
                          </div>
                        </div>
                      )}

                      {!q.answer && (
                        <div className="border-t pt-3">
                          <div className="flex gap-2">
                            <input
                              type="text"
                              placeholder="Type your answer..."
                              value={qaAnswers[q.id] || ""}
                              onChange={(e) => setQaAnswers(prev => ({ ...prev, [q.id]: e.target.value }))}
                              className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                            />
                            <button
                              onClick={() => handleSendAnswer(q.id)}
                              className="px-3 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors"
                            >
                              <Send size={14} />
                            </button>
                          </div>
                        </div>
                      )}
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}