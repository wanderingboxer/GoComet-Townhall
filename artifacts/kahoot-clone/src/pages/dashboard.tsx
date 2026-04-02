import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  useListQuizzes,
  useCreateQuiz,
  useDeleteQuiz,
  useCreateGame,
  getListQuizzesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Play,
  Plus,
  Trash2,
  Edit3,
  Settings,
  AlertCircle,
  MessageCircle,
  LogOut,
  Shield,
  Loader2,
} from "lucide-react";
import { LoadingSpinner } from "@/components/game-ui";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

const HOST_ACCESS_STORAGE_KEY = "quizblast_host_access_code";
const HOST_DISPLAY_NAME_STORAGE_KEY = "quizblast_host_display_name";

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const apiOrigin = import.meta.env.VITE_API_ORIGIN?.trim();
  const apiUrl = (path: string) => (apiOrigin ? `${apiOrigin}${path}` : path);

  const [accessKey, setAccessKey] = useState("");
  const [hostName, setHostName] = useState(
    typeof window !== "undefined"
      ? window.sessionStorage.getItem(HOST_DISPLAY_NAME_STORAGE_KEY) || ""
      : ""
  );

  const [hasHostAccess, setHasHostAccess] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [authError, setAuthError] = useState("");

  const getStoredHostAccessCode = () =>
    typeof window !== "undefined"
      ? window.sessionStorage.getItem(HOST_ACCESS_STORAGE_KEY) || ""
      : "";

  const getHostAccessHeaders = (overrideCode?: string) => {
    const code = overrideCode ?? getStoredHostAccessCode();
    return code ? { "x-host-access-code": code } : undefined;
  };

  // ---------------- ACCESS CHECK ----------------
  useEffect(() => {
    const checkAccess = async () => {
      // First check if we have stored credentials
      const storedCode = getStoredHostAccessCode();
      const storedName = typeof window !== "undefined" 
        ? window.sessionStorage.getItem(HOST_DISPLAY_NAME_STORAGE_KEY)
        : null;
      
      console.log("Dashboard: Checking access", { storedCode, storedName });
      
      // If we have stored credentials, grant access immediately
      if (storedCode && storedName) {
        console.log("Dashboard: Found stored credentials, granting access");
        setHasHostAccess(true);
        setCheckingAccess(false);
        return;
      }

      // If no stored credentials, check with server or show login
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      try {
        const res = await fetch(apiUrl("/api/host-access/status"), {
          credentials: "include",
          headers: getHostAccessHeaders(),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        const data = await res.json();
        setHasHostAccess(Boolean(data.authenticated));
      } catch {
        setAuthError("Could not verify host access. Please enter your access code.");
      } finally {
        setCheckingAccess(false);
      }
    };

    checkAccess();
  }, []); // Run on every mount to check session

  // ---------------- QUERIES ----------------
  const { data: quizzes, error } = useListQuizzes({
    query: {
      queryKey: getListQuizzesQueryKey(),
      enabled: hasHostAccess,
      staleTime: 5 * 60 * 1000, // 5 minutes
      gcTime: 10 * 60 * 1000, // 10 minutes
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  });

  useEffect(() => {
    if ((error as any)?.status === 401) {
      setHasHostAccess(false);
      setAuthError("Session expired. Please login again.");
      // Don't automatically clear session - let user decide
    }
  }, [error]);

  // ---------------- MUTATIONS ----------------
  const createQuiz = useCreateQuiz({
    mutation: {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: getListQuizzesQueryKey() });
        setLocation(`/quiz/${data.id}/edit`);
      },
    },
  });

  const deleteQuiz = useDeleteQuiz({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListQuizzesQueryKey() });
      },
    },
  });

  const createGame = useCreateGame();

  // ---------------- HANDLERS ----------------
  const handleCreateNew = () => {
    createQuiz.mutate({
      data: { title: "My Awesome Quiz", description: "A fun new quiz" },
    });
  };

  const handleUnlockConsole = async () => {
    if (!accessKey.trim() || !hostName.trim()) return;

    setIsUnlocking(true);
    setAuthError("");

    try {
      const res = await fetch(apiUrl("/api/host-access/login"), {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(getHostAccessHeaders(accessKey) ?? {}),
        },
        body: JSON.stringify({ accessKey }),
      });

      if (!res.ok) throw new Error("Invalid access code");

      sessionStorage.setItem(HOST_ACCESS_STORAGE_KEY, accessKey);
      sessionStorage.setItem(HOST_DISPLAY_NAME_STORAGE_KEY, hostName);

      setHasHostAccess(true);
      setAccessKey("");
    } catch (err: any) {
      setAuthError(err.message);
    } finally {
      setIsUnlocking(false);
    }
  };

  const handleLogout = async () => {
    await fetch(apiUrl("/api/host-access/logout"), {
      method: "POST",
      credentials: "include",
    });

    sessionStorage.clear();
    setHasHostAccess(false);
    setHostName("");
    setAccessKey("");
  };

  const handleLaunchSession = (quizId: number) => {
    createGame.mutate(
      { data: { quizId } },
      {
        onSuccess: (data) => {
          setLocation(`/host/${data.gameCode}`);
        },
      }
    );
  };

  // ---------------- UI STATES ----------------
  if (checkingAccess) {
    return <LoadingSpinner message="Checking host access..." />;
  }

  if (!hasHostAccess) {
    return (
      <div className="min-h-screen bg-muted/40 px-4 flex items-center justify-center">
        <div className="w-full max-w-md bg-white border border-border rounded-[28px] p-8 shadow-xl">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-5">
            <Shield size={24} />
          </div>
          <h1 className="text-3xl font-display font-black text-foreground">Host access required</h1>
          <p className="mt-2 text-sm text-muted-foreground leading-6">
            Only approved hosts can open dashboard, launch host console, and view private Q&A replies.
          </p>

          <div className="mt-6 space-y-3">
            <input
              type="text"
              placeholder="Your host name"
              value={hostName}
              onChange={(e) => setHostName(e.target.value.slice(0, 30))}
              onKeyDown={(e) => e.key === "Enter" && handleUnlockConsole()}
              className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
            <input
              type="password"
              placeholder="Enter host access code"
              value={accessKey}
              onChange={(e) => setAccessKey(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleUnlockConsole()}
              className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
            <button
              onClick={handleUnlockConsole}
              disabled={!accessKey.trim() || !hostName.trim() || isUnlocking}
              className="game-button w-full brand-gradient text-white px-5 py-3 rounded-xl font-bold disabled:opacity-50"
            >
              {isUnlocking ? "Checking..." : "Unlock host console"}
            </button>
          </div>

          {(authError || error) && (
            <div className="mt-4 bg-destructive/10 text-destructive p-3 rounded-xl text-sm flex items-center gap-2">
              <AlertCircle size={16} /> {authError || "Failed to verify access."}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---------------- MAIN DASHBOARD ----------------
  return (
    <div className="min-h-screen bg-muted/40">
      {/* Header */}
      <header className="bg-white border-b border-border shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <div className="hidden sm:flex items-center gap-2 rounded-xl bg-primary/5 px-3 py-2 text-sm font-bold text-primary">
                <Shield size={14} /> {hostName.trim() || "Host"}
              </div>
              <button
                onClick={handleLogout}
                className="px-4 py-2.5 rounded-xl border border-border text-sm font-bold text-foreground hover:bg-muted transition-colors flex items-center gap-2"
              >
                <LogOut size={16} /> Sign out
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-end justify-between mb-6">
          <div>
            <h2 className="text-3xl font-display font-black text-foreground">Your quiz library</h2>
            <p className="text-muted-foreground mt-1 font-medium">Edit, host, and maintain your session-ready content</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setLocation("/qa")}
              className="game-button bg-primary text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 shadow-[0_8px_20px_rgba(0,84,255,0.2)] hover:bg-primary/90 transition-colors"
            >
              <MessageCircle size={20} />
              <span>Manage Q&A</span>
            </button>
            <button
              onClick={handleCreateNew}
              className="game-button brand-gradient text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 shadow-[0_8px_20px_rgba(0,84,255,0.2)]"
            >
              <Plus /> Create Quiz
            </button>
          </div>
        </div>

        {quizzes?.length === 0 ? (
          <div className="bg-white border-2 border-dashed border-border rounded-3xl p-16 text-center flex flex-col items-center shadow-sm">
            <div className="w-24 h-24 bg-muted rounded-full flex items-center justify-center mb-6">
              <Settings className="text-muted-foreground" size={40} />
            </div>
            <h2 className="text-2xl font-display font-bold text-foreground mb-2">No quizzes yet</h2>
            <p className="text-muted-foreground mb-6 max-w-sm">
              Create your first quiz to get started. Add questions, configure options, and launch engaging live sessions.
            </p>
            <button
              onClick={handleCreateNew}
              className="game-button brand-gradient text-white px-8 py-4 rounded-2xl font-bold flex items-center gap-2 shadow-[0_8px_24px_rgba(0,84,255,0.24)]"
            >
              <Plus /> Create Quiz
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {quizzes?.map((quiz) => (
              <div key={quiz.id} className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden hover:shadow-xl hover:border-primary/30 transition-all group flex flex-col">
                <div className="h-32 bg-gradient-to-br from-[#0C214C] via-[#1A316C] to-[#0054FF] flex items-center justify-center relative">
                  <span className="text-5xl font-display font-black text-white/25">{quiz.questionCount}Q</span>
                  <div className="absolute inset-0 bg-[#0C214C]/15 opacity-100 flex items-center justify-center gap-4">
                    <button
                      onClick={() => handleLaunchSession(quiz.id)}
                      disabled={quiz.questionCount === 0 || createGame.isPending}
                      className="game-button bg-white text-primary w-14 h-14 rounded-full flex items-center justify-center shadow-[0_8px_18px_rgba(12,33,76,0.2)] hover:-translate-y-1 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
                      title={quiz.questionCount === 0 ? "Add questions before hosting" : "Host Game"}
                    >
                      {createGame.isPending ? <Loader2 className="animate-spin" size={22} /> : <Play fill="currentColor" size={22} />}
                    </button>
                  </div>
                </div>
                <div className="p-6 flex-1 flex flex-col">
                  <h3 className="text-xl font-display font-bold text-foreground line-clamp-1">{quiz.title}</h3>
                  <p className="text-sm text-muted-foreground mt-1 mb-4 flex-1 line-clamp-2">{quiz.description || "No description"}</p>

                  <div className="flex items-center justify-between mt-auto pt-4 border-t border-border">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      {format(new Date(quiz.createdAt), 'MMM d, yyyy')}
                    </span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setLocation(`/quiz/${quiz.id}/edit`)}
                        className="p-2 rounded-xl border border-border text-foreground hover:bg-muted transition-colors"
                        title="Edit Quiz"
                      >
                        <Edit3 size={16} />
                      </button>
                      <button
                        onClick={() => deleteQuiz.mutate({ id: quiz.id })}
                        className="p-2 rounded-xl border border-border text-destructive hover:bg-destructive/10 transition-colors"
                        title="Delete Quiz"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
      
    </div>
  );
}
