import { useState, useEffect, useRef } from "react";
import { useRoute, Link } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useGetQuiz, useUpdateQuiz, useAddQuestion, useUpdateQuestion, useDeleteQuestion } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetQuizQueryKey } from "@workspace/api-client-react";
import { ArrowLeft, Save, Plus, Trash2, GripVertical, CheckCircle2, Clock, Trophy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { LoadingSpinner } from "@/components/game-ui";
import { ANSWER_COLORS, TIME_LIMITS, POINT_VALUES } from "@/lib/constants";
import { cn } from "@/lib/utils";

const questionSchema = z.object({
  text: z.string().min(1, "Question text is required"),
  options: z.array(z.string().min(1, "Option is required")).length(4),
  correctOption: z.coerce.number().min(0).max(3),
  timeLimit: z.coerce.number(),
  points: z.coerce.number()
});

type QuestionFormValues = z.infer<typeof questionSchema>;

export default function QuizEditor() {
  const [, params] = useRoute("/quiz/:id/edit");
  const quizId = parseInt(params?.id || "0", 10);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: quiz, isLoading } = useGetQuiz(quizId);
  const [selectedQuestionId, setSelectedQuestionId] = useState<number | null>(null);
  
  const updateQuiz = useUpdateQuiz({
    mutation: {
      onSuccess: () => {
        toast({ title: "Quiz settings saved!" });
        queryClient.invalidateQueries({ queryKey: getGetQuizQueryKey(quizId) });
      }
    }
  });

  const addQuestion = useAddQuestion({
    mutation: {
      onSuccess: (data) => {
        toast({ title: "Question added" });
        queryClient.invalidateQueries({ queryKey: getGetQuizQueryKey(quizId) });
        setSelectedQuestionId(data.id);
      }
    }
  });

  const updateQuestion = useUpdateQuestion({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetQuizQueryKey(quizId) });
      }
    }
  });

  const deleteQuestion = useDeleteQuestion({
    mutation: {
      onSuccess: () => {
        toast({ title: "Question deleted" });
        queryClient.invalidateQueries({ queryKey: getGetQuizQueryKey(quizId) });
        setSelectedQuestionId(null);
      }
    }
  });

  // Selected question data for form
  const selectedQuestion = quiz?.questions?.find(q => q.id === selectedQuestionId) || quiz?.questions?.[0];

  useEffect(() => {
    if (quiz?.questions?.length && !selectedQuestionId) {
      setSelectedQuestionId(quiz.questions[0].id);
    }
  }, [quiz, selectedQuestionId]);

  const form = useForm<QuestionFormValues>({
    resolver: zodResolver(questionSchema),
    defaultValues: {
      text: "",
      options: ["", "", "", ""],
      correctOption: 0,
      timeLimit: 20,
      points: 1000
    }
  });
  const autoSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedSnapshotRef = useRef("");
  const watchedQuestion = form.watch();
  const isDirty = form.formState.isDirty;

  const normalizeQuestionValues = (data: QuestionFormValues): QuestionFormValues => ({
    ...data,
    text: data.text.trim(),
    options: data.options.map((option) => option.trim()),
  });

  const saveQuestion = (data: QuestionFormValues, showToast = false) => {
    if (!selectedQuestion) return;

    const normalized = normalizeQuestionValues(data);

    // H8: Reject duplicate answer options.
    const filled = normalized.options.filter(Boolean);
    const unique = new Set(filled.map((o) => o.toLowerCase()));
    if (unique.size < filled.length) {
      toast({ title: "Duplicate options", description: "All answer options must be unique.", variant: "destructive" });
      return;
    }

    updateQuestion.mutate(
      { id: selectedQuestion.id, data: normalized },
      {
        onSuccess: () => {
          if (showToast) {
            toast({ title: "Question saved" });
          }
          queryClient.invalidateQueries({ queryKey: getGetQuizQueryKey(quizId) });
        },
        onError: (err: any) => {
          toast({
            title: "Failed to save question",
            description: err?.message ?? "Please try again.",
            variant: "destructive",
          });
        },
      },
    );
  };

  // Reset form when selected question changes
  useEffect(() => {
    if (selectedQuestion) {
      const resetValues = {
        text: selectedQuestion.text,
        options: selectedQuestion.options.length === 4 ? selectedQuestion.options : ["", "", "", ""],
        correctOption: selectedQuestion.correctOption,
        timeLimit: selectedQuestion.timeLimit,
        points: selectedQuestion.points
      };
      form.reset(resetValues);
      lastSavedSnapshotRef.current = JSON.stringify(normalizeQuestionValues(resetValues));
    } else {
      const resetValues = {
        text: "",
        options: ["", "", "", ""],
        correctOption: 0,
        timeLimit: 20,
        points: 1000
      };
      form.reset(resetValues);
      lastSavedSnapshotRef.current = "";
    }
  }, [selectedQuestion, form]);

  useEffect(() => {
    if (!selectedQuestion || !isDirty || updateQuestion.isPending) {
      return;
    }

    const normalized = normalizeQuestionValues(watchedQuestion);
    const hasQuestionText = normalized.text.length > 0;
    const hasAllOptions = normalized.options.length === 4 && normalized.options.every((option) => option.length > 0);

    if (!hasQuestionText || !hasAllOptions) {
      return;
    }

    const snapshot = JSON.stringify(normalized);
    if (snapshot === lastSavedSnapshotRef.current) {
      return;
    }

    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }

    autoSaveTimeoutRef.current = setTimeout(() => {
      lastSavedSnapshotRef.current = snapshot;
      saveQuestion(normalized, false);
    }, 700);

    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, [selectedQuestion, watchedQuestion, isDirty, updateQuestion.isPending]);

  const onSubmit = (data: QuestionFormValues) => {
    if (selectedQuestion) {
      const normalized = normalizeQuestionValues(data);
      lastSavedSnapshotRef.current = JSON.stringify(normalized);
      saveQuestion(normalized, true);
    }
  };

  const handleAddNewQuestion = () => {
    addQuestion.mutate({
      id: quizId,
      data: {
        text: "New Question",
        options: ["Option 1", "Option 2", "Option 3", "Option 4"],
        correctOption: 0,
        timeLimit: 20,
        points: 1000,
        orderIndex: quiz?.questions?.length || 0
      }
    });
  };

  if (isLoading) return <div className="min-h-screen pt-20"><LoadingSpinner message="Loading editor..." /></div>;
  if (!quiz) return <div>Quiz not found</div>;

  return (
    <div className="min-h-screen bg-muted/30 flex flex-col">
      {/* Top Navbar */}
      <header className="bg-white border-b border-border h-16 flex items-center px-4 justify-between z-20 shrink-0">
        <div className="flex items-center gap-4">
          <Link href="/dashboard">
            <button className="p-2 hover:bg-muted rounded-lg transition-colors text-muted-foreground hover:text-foreground">
              <ArrowLeft size={20} />
            </button>
          </Link>
          <input
            type="text"
            className="text-xl font-display font-bold bg-transparent border-none outline-none focus:ring-2 focus:ring-primary/20 rounded px-2 py-1 w-64"
            defaultValue={quiz.title}
            onBlur={(e) => {
              const newTitle = e.target.value.trim();
              if (!newTitle) {
                e.target.value = quiz.title; // revert to last saved title
                return;
              }
              if (newTitle !== quiz.title) {
                updateQuiz.mutate({ id: quiz.id, data: { title: newTitle } });
              }
            }}
          />
        </div>
        <div className="flex items-center gap-3">
          <Link href="/dashboard">
            <button className="game-button bg-muted text-foreground px-6 py-2 rounded-xl font-bold shadow-[0_4px_0_0_hsl(var(--muted-border))]">
              Exit
            </button>
          </Link>
          <button 
            onClick={form.handleSubmit(onSubmit)}
            disabled={updateQuestion.isPending}
            className="game-button bg-primary text-white px-6 py-2 rounded-xl font-bold shadow-[0_4px_0_0_hsl(var(--primary-border))] flex items-center gap-2"
          >
            <Save size={18} /> Save
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar - Question List */}
        <div className="w-64 bg-white border-r border-border flex flex-col shrink-0">
          <div className="p-4 border-b border-border font-bold text-foreground flex justify-between items-center">
            <span>Questions ({quiz.questions?.length || 0})</span>
            <button 
              onClick={handleAddNewQuestion}
              className="p-1 bg-primary/10 text-primary hover:bg-primary hover:text-white rounded transition-colors"
            >
              <Plus size={20} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {quiz.questions?.map((q, idx) => (
              <div 
                key={q.id}
                onClick={() => setSelectedQuestionId(q.id)}
                className={cn(
                  "p-3 rounded-xl border-2 cursor-pointer transition-all flex items-start gap-2",
                  selectedQuestionId === q.id 
                    ? "border-primary bg-primary/5 shadow-sm" 
                    : "border-transparent hover:bg-muted"
                )}
              >
                <div className="text-muted-foreground mt-0.5"><GripVertical size={16} /></div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-muted-foreground mb-1">Question {idx + 1}</div>
                  <div className="text-sm font-semibold truncate">{q.text}</div>
                </div>
              </div>
            ))}
            {(!quiz.questions || quiz.questions.length === 0) && (
              <div className="text-center p-4 text-muted-foreground text-sm">
                No questions yet.
              </div>
            )}
          </div>
        </div>

        {/* Main Editor Area */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8 bg-gray-50 flex justify-center">
          {selectedQuestion ? (
            <div className="w-full max-w-4xl flex flex-col gap-6">
              
              {/* Toolbar */}
              <div className="flex justify-between items-center bg-white p-3 rounded-2xl border border-border shadow-sm">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-muted rounded-lg">
                    <Clock size={16} className="text-muted-foreground" />
                    <select 
                      {...form.register("timeLimit")}
                      className="bg-transparent border-none text-sm font-bold outline-none cursor-pointer"
                    >
                      {TIME_LIMITS.map(t => <option key={t} value={t}>{t} sec</option>)}
                    </select>
                  </div>
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-muted rounded-lg">
                    <Trophy size={16} className="text-muted-foreground" />
                    <select 
                      {...form.register("points")}
                      className="bg-transparent border-none text-sm font-bold outline-none cursor-pointer"
                    >
                      {POINT_VALUES.map(p => <option key={p} value={p}>{p} pts</option>)}
                    </select>
                  </div>
                </div>
                <button 
                  type="button"
                  onClick={() => {
                    if (confirm('Delete this question?')) {
                      deleteQuestion.mutate({ id: selectedQuestion.id });
                    }
                  }}
                  className="p-2 text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                >
                  <Trash2 size={20} />
                </button>
              </div>

              {/* Question Input */}
              <div className="bg-white p-6 rounded-3xl shadow-sm border border-border">
                <input
                  {...form.register("text")}
                  placeholder="Start typing your question"
                  className="w-full text-center text-2xl md:text-4xl font-display font-bold outline-none placeholder:text-muted-foreground/40"
                />
              </div>

              {/* Answer Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-auto">
                {ANSWER_COLORS.map((colorConfig, index) => {
                  const Icon = colorConfig.icon;
                  const isCorrect = form.watch("correctOption") === index;
                  
                  return (
                    <div 
                      key={index} 
                      className={cn(
                        "relative rounded-2xl flex items-center p-4 min-h-[120px] transition-all",
                        colorConfig.bg,
                        colorConfig.shadow,
                        "shadow-[0_6px_0_0]",
                        isCorrect ? "ring-4 ring-white ring-offset-4 ring-offset-primary" : ""
                      )}
                    >
                      <div className="absolute left-4 p-2 bg-black/15 rounded-xl">
                        <Icon size={24} className="text-white" strokeWidth={3} />
                      </div>
                      
                      <textarea
                        {...form.register(`options.${index}`)}
                        placeholder={`Add answer ${index + 1}`}
                        className="w-full h-full ml-14 mr-12 bg-transparent text-white placeholder:text-white/50 font-display font-bold text-xl md:text-2xl outline-none resize-none flex items-center"
                        rows={2}
                      />
                      
                      <button
                        type="button"
                        onClick={() => form.setValue("correctOption", index, { shouldDirty: true })}
                        className={cn(
                          "absolute right-4 w-10 h-10 rounded-full border-4 flex items-center justify-center transition-all",
                          isCorrect 
                            ? "bg-quiz-green border-white" 
                            : "border-white/50 hover:bg-white/20"
                        )}
                      >
                        {isCorrect && <CheckCircle2 size={24} className="text-white" />}
                      </button>
                    </div>
                  );
                })}
              </div>

            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <p>Select a question or create a new one</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
