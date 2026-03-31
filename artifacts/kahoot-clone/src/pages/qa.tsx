import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { MessageCircle, Send, Settings, Users, Clock, CheckCircle2, X, LogOut, Shield } from "lucide-react";
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

  // Host access state
  const [hasHostAccess, setHasHostAccess] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [authError, setAuthError] = useState("");

  const apiOrigin = import.meta.env.VITE_API_ORIGIN?.trim();
  const apiUrl = (path: string) => (apiOrigin ? `${apiOrigin}${path}` : path);

  const getStoredHostAccessCode = () =>
    typeof window !== "undefined"
      ? window.sessionStorage.getItem(HOST_ACCESS_STORAGE_KEY) || ""
      : "";

  const getHostAccessHeaders = (overrideCode?: string) => {
    const code = overrideCode ?? getStoredHostAccessCode();
    return code ? { "x-host-access-code": code } : undefined;
  };

  // Check host access on mount
  useEffect(() => {
    const checkAccess = async () => {
      try {
        const res = await fetch(apiUrl("/api/host-access/status"), {
          credentials: "include",
          headers: getHostAccessHeaders(),
        });
        const data = await res.json();
        setHasHostAccess(Boolean(data.authenticated));
        if (!data.authenticated) {
          setAuthError("Host access required. Please login from dashboard.");
          // Redirect to dashboard after a short delay
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

  // Initialize host WebSocket connection when authenticated
  useEffect(() => {
    if (!hasHostAccess || !connected) return;

    // Join as host to receive questions
    const hostName = typeof window !== "undefined"
      ? window.sessionStorage.getItem(HOST_DISPLAY_NAME_STORAGE_KEY)?.trim() || "Host"
      : "Host";

    const accessKey = getStoredHostAccessCode();
    
    emit("host_join", { gameCode: "qa-room", accessKey, hostName });
    
    // Request initial questions list
    emit("get_live_questions", {});
    
    // Add some demo questions for testing (remove in production)
    setTimeout(() => {
      setQaItems([
        {
          id: "demo-1",
          text: "What is the purpose of this Q&A system?",
          answer: null,
          answeredBy: null,
          isPublic: false,
          askedAt: Date.now() - 5000,
          answeredAt: null,
          mine: false,
        },
        {
          id: "demo-2", 
          text: "How do I submit questions anonymously?",
          answer: "You can submit questions through the main page by selecting Q&A mode and clicking the 'Open Live Q&A' button. All questions are anonymous by default.",
          answeredBy: "Host",
          isPublic: false,
          askedAt: Date.now() - 10000,
          answeredAt: Date.now() - 8000,
          mine: false,
        }
      ]);
    }, 1000);
    
  }, [hasHostAccess, connected, emit]);

  // SOCKET HANDLER - Always call this useEffect, no conditions
  useEffect(() => {
    if (!lastMessage || !hasHostAccess) return;
    
    const { type, payload } = lastMessage;

    switch (type) {
      case "live_questions_list":
      case "global_live_questions_list": {
        const questions = (Array.isArray(payload?.questions) ? payload.questions : []) as Array<{
          id: string | number;
          text: string;
          answer?: string | null;
          answeredBy?: string | null;
          isPublic?: boolean;
          askedAt: number;
          answeredAt?: number | null;
          mine?: boolean;
        }>;
        setQaItems(
          questions
            .map((question: any) => ({
              id: String(question.id),
              text: String(question.text),
              answer: question.answer ? String(question.answer) : null,
              answeredBy: question.answeredBy ? String(question.answeredBy) : null,
              isPublic: Boolean(question.isPublic),
              askedAt: Number(question.askedAt),
              answeredAt: question.answeredAt ? Number(question.answeredAt) : null,
              mine: Boolean(question.mine),
            }))
            .sort((a: QAItem, b: QAItem) => a.askedAt - b.askedAt),
        );
        break;
      }
      case "new_live_question":
      case "global_new_question": {
        const q: QAItem = { 
          id: String(payload.id), 
          text: String(payload.text), 
          answer: null, 
          answeredBy: null, 
          isPublic: false, 
          askedAt: Number(payload.askedAt),
          answeredAt: null,
          mine: Boolean(payload.mine),
        };
        setQaItems(prev => prev.find(item => item.id === q.id) ? prev : [...prev, q]);
        if (!showQaPanel) setUnreadQa(n => n + 1);
        break;
      }
      case "global_qa_answered": {
        const id = String(payload.id);
        setQaItems(prev =>
          prev.map((q) =>
            q.id === id
              ? {
                  ...q,
                  answer: String(payload.answer),
                  answeredBy: payload.answeredBy ? String(payload.answeredBy) : q.answeredBy,
                  isPublic: false,
                  answeredAt: Date.now(),
                }
              : q,
          ),
        );
        break;
      }
      case "global_qa_published": {
        const id = String(payload.id);
        setQaItems(prev =>
          prev.map((q) =>
            q.id === id
              ? {
                  ...q,
                  answer: String(payload.answer),
                  answeredBy: payload.answeredBy ? String(payload.answeredBy) : q.answeredBy,
                  isPublic: true,
                  answeredAt: Date.now(),
                }
              : q,
          ),
        );
        break;
      }
      case "qa_answered": {
        const id = String(payload.id);
        setQaItems(prev => prev.map(q => q.id === id ? { 
          ...q, 
          answer: String(payload.answer), 
          answeredBy: payload.answeredBy ? String(payload.answeredBy) : q.answeredBy, 
          isPublic: Boolean(payload.isPublic),
          answeredAt: Date.now(),
        } : q));
        break;
      }
    }
  }, [lastMessage, showQaPanel, hasHostAccess]);

  const handleLogout = async () => {
    await fetch(apiUrl("/api/host-access/logout"), {
      method: "POST",
      credentials: "include",
    });

    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(HOST_ACCESS_STORAGE_KEY);
      window.sessionStorage.removeItem(HOST_DISPLAY_NAME_STORAGE_KEY);
    }
    setLocation("/dashboard");
  };

  const handleSendAnswer = (qId: string) => {
    const answer = (qaAnswers[qId] || "").trim();
    if (!answer) return;
    
    // Send answer to server
    emit("answer_global_question", { questionId: qId, answer });
    
    // Update local state immediately for better UX
    setQaItems(prev => prev.map(q => 
      q.id === qId 
        ? { 
            ...q, 
            answer, 
            answeredBy: "Host", 
            isPublic: false,
            answeredAt: Date.now(),
          } 
        : q
    ));
    
    setQaAnswers(prev => ({ ...prev, [qId]: "" }));
  };

  const handlePublish = (qId: string) => {
    const question = qaItems.find(q => q.id === qId);
    if (!question || !question.answer) return;
    
    // Publish the question to make it public for everyone
    emit("publish_question", { questionId: qId });
    
    // Update local state
    setQaItems(prev => prev.map(q => 
      q.id === qId 
        ? { ...q, isPublic: true } 
        : q
    ));
  };

  // Early returns must be after all hooks
  if (typeof window === "undefined") return <LoadingSpinner message="Loading Q&A Management..." />;
  if (checkingAccess) return <LoadingSpinner message="Checking host access..." />;
  if (!hasHostAccess) {
    return (
      <div className="min-h-screen bg-muted/40 px-4 flex items-center justify-center">
        <div className="w-full max-w-md bg-white border border-border rounded-[28px] p-8 shadow-xl">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-5">
            <Shield size={24} />
          </div>
          <h1 className="text-3xl font-display font-black text-foreground">Access Denied</h1>
          <p className="mt-2 text-sm text-muted-foreground leading-6">
            {authError || "Host access required. Please login from dashboard."}
          </p>
          <button
            onClick={() => setLocation("/dashboard")}
            className="w-full mt-6 game-button brand-gradient text-white px-5 py-3 rounded-xl font-bold"
          >
            Return to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-border shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 rounded-xl bg-primary/5 px-3 py-2 text-sm font-bold text-primary">
                <MessageCircle size={14} /> Q&A Management
              </div>
              <button
                onClick={handleLogout}
                className="px-4 py-2.5 rounded-xl border border-border text-sm font-bold text-foreground hover:bg-muted transition-colors flex items-center gap-2"
              >
                <LogOut size={16} /> Back to Dashboard
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 bg-muted/40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
            {/* Q&A Panel */}
            <div className="bg-white rounded-2xl border border-border shadow-lg">
              <div className="flex items-center justify-between p-6 border-b border-border">
                <div className="flex items-center gap-3">
                  <MessageCircle size={24} className="text-primary" />
                  <h2 className="text-2xl font-display font-black text-foreground">Live Q&A Inbox</h2>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    {qaItems.filter(q => !q.answer).length} unanswered
                  </span>
                  {unreadQa > 0 && (
                    <span className="bg-primary text-white text-xs px-2 py-1 rounded-full ml-2">
                      {unreadQa} new
                    </span>
                  )}
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
                            <p className="text-sm text-foreground mb-2">{q.answer}</p>
                            <p className="text-xs text-muted-foreground">by {q.answeredBy || "Host"}</p>
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
                            <div className="flex gap-2 mt-2">
                              <button
                                onClick={() => handlePublish(q.id)}
                                className="px-3 py-2 rounded-lg border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors"
                              >
                                <CheckCircle2 size={14} />
                                Make Public
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

            {/* Stats Panel */}
            <div className="space-y-6">
              <div className="bg-white rounded-2xl border border-border p-6 shadow-lg">
                <h3 className="text-lg font-display font-bold text-foreground mb-4">Q&A Statistics</h3>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Total Questions</span>
                    <span className="text-lg font-bold text-foreground">{qaItems.length}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Answered</span>
                    <span className="text-lg font-bold text-green-600">
                      {qaItems.filter(q => q.answer).length}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Unanswered</span>
                    <span className="text-lg font-bold text-orange-600">
                      {qaItems.filter(q => !q.answer).length}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Public Replies</span>
                    <span className="text-lg font-bold text-blue-600">
                      {qaItems.filter(q => q.isPublic).length}
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-border p-6 shadow-lg">
                <h3 className="text-lg font-display font-bold text-foreground mb-4">Quick Actions</h3>
                <div className="space-y-3">
                  <button className="w-full px-4 py-3 rounded-xl border border-border text-foreground hover:bg-muted transition-colors text-left flex items-center gap-3">
                    <Users size={16} />
                    <div>
                      <div className="font-medium">View All Participants</div>
                      <div className="text-xs text-muted-foreground">Manage session attendees</div>
                    </div>
                  </button>
                  <button className="w-full px-4 py-3 rounded-xl border border-border text-foreground hover:bg-muted transition-colors text-left flex items-center gap-3">
                    <Settings size={16} />
                    <div>
                      <div className="font-medium">Q&A Settings</div>
                      <div className="text-xs text-muted-foreground">Configure Q&A behavior</div>
                    </div>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
