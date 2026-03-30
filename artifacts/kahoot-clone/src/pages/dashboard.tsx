import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useListQuizzes, useCreateQuiz, useDeleteQuiz, useCreateGame } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListQuizzesQueryKey } from "@workspace/api-client-react";
import { Play, Plus, Trash2, Edit3, Settings, AlertCircle, LayoutDashboard } from "lucide-react";
import { LoadingSpinner } from "@/components/game-ui";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: quizzes, isLoading, error } = useListQuizzes();
  
  const createQuiz = useCreateQuiz({
    mutation: {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: getListQuizzesQueryKey() });
        toast({ title: "Quiz created!", description: "Taking you to the editor..." });
        setLocation(`/quiz/${data.id}/edit`);
      }
    }
  });

  const deleteQuiz = useDeleteQuiz({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListQuizzesQueryKey() });
        toast({ title: "Quiz deleted" });
      }
    }
  });

  const createGame = useCreateGame({
    mutation: {
      onSuccess: (data) => {
        setLocation(`/host/${data.gameCode}`);
      },
      onError: (err: any) => {
        toast({ title: "Failed to start game", description: err.message, variant: "destructive" });
      }
    }
  });

  const handleCreateNew = () => {
    createQuiz.mutate({
      data: { title: "My Awesome Quiz", description: "A fun new quiz" }
    });
  };

  if (isLoading) return <div className="min-h-screen pt-20"><LoadingSpinner message="Loading your quizzes..." /></div>;
  if (error) return <div className="min-h-screen pt-20 flex justify-center"><div className="bg-destructive/10 text-destructive p-6 rounded-xl flex items-center gap-3"><AlertCircle /> Failed to load quizzes.</div></div>;

  return (
    <div className="min-h-screen bg-muted/40 pb-20">
      <header className="sticky top-0 z-30 border-b border-border bg-white/90 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-20 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 cursor-pointer">
            <div className="w-10 h-10 rounded-xl brand-gradient flex items-center justify-center shadow-lg shadow-primary/20">
              <LayoutDashboard className="text-white" size={20} />
            </div>
            <div>
              <span className="block text-2xl font-display font-black text-foreground">GoComet Quiz Hub</span>
              <span className="block text-[11px] uppercase tracking-[0.24em] text-muted-foreground">Host console</span>
            </div>
          </Link>
          <button
            onClick={handleCreateNew}
            disabled={createQuiz.isPending}
            className="game-button brand-gradient text-white px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 shadow-[0_8px_20px_rgba(0,84,255,0.2)]"
          >
            <Plus size={18} /> Create Quiz
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
        <div className="rounded-[28px] brand-gradient text-white p-6 sm:p-8 shadow-[0_24px_60px_rgba(12,33,76,0.18)] mb-8">
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-white/70">GoComet learning operations</p>
          <h1 className="mt-2 text-4xl sm:text-5xl font-display font-black">Manage quizzes and live sessions</h1>
          <p className="mt-3 max-w-2xl text-white/80 text-sm sm:text-base">
            Create branded knowledge checks, launch live sessions, and keep team engagement aligned with the GoComet product experience.
          </p>
        </div>

        <div className="flex items-end justify-between mb-6">
          <div>
            <h2 className="text-3xl font-display font-black text-foreground">Your quiz library</h2>
            <p className="text-muted-foreground mt-1 font-medium">Edit, host, and maintain your session-ready content</p>
          </div>
        </div>

        {quizzes?.length === 0 ? (
          <div className="bg-white border-2 border-dashed border-border rounded-3xl p-16 text-center flex flex-col items-center shadow-sm">
            <div className="w-24 h-24 bg-muted rounded-full flex items-center justify-center mb-6">
              <Settings className="text-muted-foreground" size={40} />
            </div>
            <h2 className="text-2xl font-display font-bold text-foreground mb-2">No quizzes yet</h2>
            <p className="text-muted-foreground mb-8">Create your first GoComet-styled quiz to get started.</p>
            <button
              onClick={handleCreateNew}
              className="game-button brand-gradient text-white px-8 py-4 rounded-xl font-bold flex items-center gap-2 shadow-[0_8px_20px_rgba(0,84,255,0.2)]"
            >
              <Plus /> Create Quiz
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {quizzes?.map((quiz) => (
              <div key={quiz.id} className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden hover:shadow-xl hover:border-primary/30 transition-all group flex flex-col">
                <div className="h-32 bg-gradient-to-br from-[#0C214C] via-[#1A316C] to-[#0054FF] flex items-center justify-center relative">
                  <span className="text-5xl font-display font-black text-white/25">{quiz.questionCount}Q</span>
                  <div className="absolute inset-0 bg-[#0C214C]/15 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-4">
                    <button
                      onClick={() => createGame.mutate({ data: { quizId: quiz.id } })}
                      className="game-button bg-white text-primary w-14 h-14 rounded-full flex items-center justify-center shadow-[0_8px_18px_rgba(12,33,76,0.2)] hover:-translate-y-1"
                      title="Host Game"
                    >
                      <Play fill="currentColor" size={22} />
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
                      <Link href={`/quiz/${quiz.id}/edit`}>
                        <button className="p-2 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg transition-colors">
                          <Edit3 size={18} />
                        </button>
                      </Link>
                      <button
                        onClick={() => {
                          if (confirm('Are you sure you want to delete this quiz?')) {
                            deleteQuiz.mutate({ id: quiz.id });
                          }
                        }}
                        className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                      >
                        <Trash2 size={18} />
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
