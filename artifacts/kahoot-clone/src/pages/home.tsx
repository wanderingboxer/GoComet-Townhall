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
    <div className="min-h-screen relative flex flex-col items-center justify-center p-4 overflow-hidden">
      {/* Background Image */}
      <img 
        src={`${import.meta.env.BASE_URL}images/hero-bg.png`}
        alt="Vibrant colorful background" 
        className="absolute inset-0 w-full h-full object-cover opacity-20 z-0 pointer-events-none"
      />
      
      <div className="z-10 w-full max-w-4xl grid md:grid-cols-2 gap-8 md:gap-12 items-center">
        
        {/* Join Panel */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="glass-panel p-8 sm:p-10 rounded-3xl w-full flex flex-col items-center shadow-2xl relative overflow-hidden"
        >
          <div className="absolute top-0 inset-x-0 h-3 bg-primary"></div>
          
          <img 
            src={`${import.meta.env.BASE_URL}images/logo.png`}
            alt="QuizBlast Logo" 
            className="w-48 h-48 object-contain mb-6 drop-shadow-xl"
          />
          
          <form onSubmit={handleJoin} className="w-full space-y-4">
            <input
              type="text"
              placeholder="Game PIN"
              value={gameCode}
              onChange={(e) => setGameCode(e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase())}
              className="w-full text-center text-3xl font-display font-black tracking-widest uppercase py-4 px-6 rounded-2xl border-4 border-black/10 bg-white text-foreground focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/20 transition-all placeholder:text-muted-foreground/50"
              required
            />
            <input
              type="text"
              placeholder="Nickname"
              value={nickname}
              onChange={(e) => setNickname(e.target.value.slice(0, 15))}
              className="w-full text-center text-xl font-display font-bold py-4 px-6 rounded-2xl border-4 border-black/10 bg-white text-foreground focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/20 transition-all placeholder:text-muted-foreground/50"
              required
            />
            <button
              type="submit"
              disabled={!gameCode || !nickname}
              className="w-full game-button bg-foreground text-background py-5 rounded-2xl text-2xl font-black shadow-[0_6px_0_0_rgba(0,0,0,0.8)] hover:bg-foreground/90 disabled:opacity-50 disabled:shadow-[0_2px_0_0_rgba(0,0,0,0.8)] disabled:translate-y-[4px] mt-4 flex justify-center items-center gap-2"
            >
              <Play fill="currentColor" /> Enter
            </button>
          </form>
        </motion.div>

        {/* Host Panel */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="flex flex-col justify-center items-start text-center md:text-left"
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary font-bold mb-6 border border-primary/20">
            <Sparkles size={18} /> For Teachers & Creators
          </div>
          
          <h1 className="text-5xl md:text-6xl lg:text-7xl font-display font-black text-foreground leading-[1.1] mb-6">
            Make learning <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-quiz-blue">AWESOME.</span>
          </h1>
          
          <p className="text-xl text-muted-foreground mb-10 font-medium">
            Create, host, and share interactive quizzes in seconds. Perfect for classrooms, meetings, and trivia nights.
          </p>
          
          <Link href="/dashboard" className="inline-block w-full md:w-auto">
            <button className="w-full game-button bg-primary text-primary-foreground px-8 py-5 rounded-2xl text-2xl font-black shadow-[0_6px_0_0_hsl(var(--primary-border))] hover:bg-primary/90 flex justify-center items-center gap-3">
              <Presentation size={28} /> Host a Game
            </button>
          </Link>
        </motion.div>
      </div>
    </div>
  );
}
