import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { MessageCircle, Send, Clock, CheckCircle2, LogOut, Shield } from "lucide-react";
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

    emit("host_join", {
      gameCode: "qa-room",
      accessKey: getStoredHostAccessCode(),
      hostName,
    });

    emit("get_live_questions", {});
  }, [hasHostAccess, connected, emit]);

  // SOCKET HANDLER
  useEffect(() => {
    if (!lastMessage || !hasHostAccess) return;

    const { type, payload } = lastMessage;

    switch (type) {
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
            .sort((a, b) => a.askedAt - b.askedAt)
        );
        break;
      }

      case "new_live_question":
      case "global_new_question": {
        if (!payload) return;

        const q: QAItem = {
          id: String(payload?.id),
          text: String(payload?.text),
          answer: null,
          answeredBy: null,
          isPublic: false,
          askedAt: Number(payload?.askedAt),
          answeredAt: null,
          mine: Boolean(payload?.mine),
        };

        setQaItems((prev) =>
          prev.find((item) => item.id === q.id) ? prev : [...prev, q]
        );

        setUnreadQa((n) => n + 1);
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
    const answer = (qaAnswers[qId] || "").trim();
    if (!answer) return;

    emit("answer_global_question", { questionId: qId, answer });

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

    emit("publish_question", { questionId: qId });

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
    <div className="p-6">
      <button onClick={handleLogout}>
        <LogOut /> Dashboard
      </button>

      {qaItems.map((q) => (
        <motion.div key={q.id}>
          <p>{q.text}</p>

          {q.answer ? (
            <p>{q.answer}</p>
          ) : (
            <div>
              <input
                value={qaAnswers[q.id] || ""}
                onChange={(e) =>
                  setQaAnswers((prev) => ({
                    ...prev,
                    [q.id]: e.target.value,
                  }))
                }
              />
              <button onClick={() => handleSendAnswer(q.id)}>
                <Send />
              </button>
            </div>
          )}

          {q.answer && !q.isPublic && (
            <button onClick={() => handlePublish(q.id)}>
              <CheckCircle2 /> Publish
            </button>
          )}
        </motion.div>
      ))}
    </div>
  );
}