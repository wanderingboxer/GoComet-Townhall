import { useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { motion } from "framer-motion";
import { Play, Presentation, Sparkles } from "lucide-react";

export default function Home() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const prefilledCode = params.get("code")?.replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase() || "";
  const [gameCode, setGameCode] = useState(prefilledCode);
  const [nickname, setNickname] = useState("");

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!gameCode || !nickname) return;
    
    sessionStorage.setItem("quizblast_nickname", nickname);
    setLocation(`/play/${gameCode.toUpperCase()}`);
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
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/8 px-4 py-2 text-sm font-bold text-primary">
            <Sparkles size={16} /> GoComet Learning Experience
          </div>

          <h1 className="mt-5 text-5xl font-display font-black leading-tight text-foreground sm:text-6xl lg:text-7xl">
            GoComet
            <span className="block text-transparent bg-clip-text bg-gradient-to-r from-[#0C214C] via-[#1A316C] to-[#0054FF]">
              Quiz Hub
            </span>
          </h1>

          <p className="mt-5 max-w-2xl text-lg text-muted-foreground sm:text-xl">
            A cleaner, enterprise-style space for onboarding, training, live knowledge checks, and Q&amp;A — designed to feel aligned with the GoComet brand.
          </p>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-border bg-white/80 px-4 py-3 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Live</p>
              <p className="mt-1 text-sm font-semibold text-foreground">Real-time sessions</p>
            </div>
            <div className="rounded-2xl border border-border bg-white/80 px-4 py-3 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Private</p>
              <p className="mt-1 text-sm font-semibold text-foreground">1:1 host replies</p>
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
              <p className="mt-2 text-sm text-muted-foreground">Use the PIN shared by the host to enter the GoComet-styled quiz room.</p>
            </div>

            <form onSubmit={handleJoin} className="space-y-4">
              <input
                type="text"
                placeholder="Game PIN"
                value={gameCode}
                onChange={(e) => setGameCode(e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase())}
                className="w-full rounded-2xl border border-border bg-white px-5 py-4 text-center text-3xl font-display font-black tracking-[0.35em] uppercase text-foreground shadow-sm focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/15 placeholder:text-muted-foreground/60"
                required
              />
              <input
                type="text"
                placeholder="Your name"
                value={nickname}
                onChange={(e) => setNickname(e.target.value.slice(0, 15))}
                className="w-full rounded-2xl border border-border bg-white px-5 py-4 text-lg font-semibold text-foreground shadow-sm focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/15 placeholder:text-muted-foreground/60"
                required
              />
              <button
                type="submit"
                disabled={!gameCode || !nickname}
                className="w-full game-button brand-gradient py-4 rounded-2xl text-lg font-black text-white shadow-[0_8px_24px_rgba(0,84,255,0.24)] disabled:opacity-50 mt-2 flex justify-center items-center gap-2"
              >
                <Play fill="currentColor" size={18} /> Join Session
              </button>
            </form>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
