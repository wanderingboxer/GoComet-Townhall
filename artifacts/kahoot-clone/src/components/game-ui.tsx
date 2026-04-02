import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ANSWER_COLORS } from "@/lib/constants";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function CountdownBar({ 
  timeLimit, 
  timeLeft,
  isPaused = false 
}: { 
  timeLimit: number; 
  timeLeft: number;
  isPaused?: boolean;
}) {
  const percentage = Math.max(0, Math.min(100, (timeLeft / timeLimit) * 100));
  
  let colorClass = "bg-primary";
  if (percentage < 25) colorClass = "bg-quiz-red";
  else if (percentage < 50) colorClass = "bg-quiz-yellow";

  return (
    <div className="w-full h-4 bg-black/10 rounded-full overflow-hidden">
      <motion.div 
        className={cn("h-full rounded-full", colorClass)}
        initial={{ width: "100%" }}
        animate={{ width: `${percentage}%` }}
        transition={isPaused ? { duration: 0.2 } : { ease: "linear", duration: 1 }}
      />
    </div>
  );
}

function getOptionTextSize(text: string): string {
  if (text.length <= 20) return "text-2xl sm:text-3xl md:text-4xl";
  if (text.length <= 40) return "text-xl sm:text-2xl md:text-3xl";
  return "text-base sm:text-lg md:text-2xl";
}

export function AnswerGrid({
  options, 
  onSelect, 
  disabled,
  selectedOption,
  correctOption,
  showResults = false
}: { 
  options: string[]; 
  onSelect?: (index: number) => void;
  disabled?: boolean;
  selectedOption?: number;
  correctOption?: number;
  showResults?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full h-full max-h-[600px] min-h-[300px]">
      <AnimatePresence>
        {options.map((option, index) => {
          const config = ANSWER_COLORS[index % 4];
          const Icon = config.icon;
          
          let stateClass = "";
          let isFaded = false;
          
          if (showResults) {
            if (index === correctOption) {
              stateClass = "ring-8 ring-white z-10 scale-[1.02]";
            } else {
              isFaded = true;
            }
          } else if (selectedOption !== undefined) {
            if (selectedOption === index) {
              stateClass = "ring-8 ring-white z-10";
            } else {
              isFaded = true;
            }
          }

          return (
            <motion.button
              key={index}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ 
                opacity: isFaded ? 0.4 : 1, 
                scale: isFaded ? 0.95 : 1,
              }}
              whileHover={!disabled && !showResults ? { scale: 1.02 } : {}}
              whileTap={!disabled && !showResults ? { scale: 0.98 } : {}}
              onClick={() => !disabled && onSelect?.(index)}
              disabled={disabled}
              className={cn(
                "game-button relative flex flex-col items-center justify-center p-6 rounded-2xl sm:rounded-3xl shadow-[0_8px_0_0]",
                config.bg,
                config.shadow,
                !disabled && config.hover,
                stateClass,
                "text-white overflow-hidden group"
              )}
            >
              <div className="absolute top-4 left-4 p-3 bg-black/15 rounded-xl">
                <Icon size={32} className="text-white drop-shadow-md" strokeWidth={3} />
              </div>
              <span className={cn(
                "font-display font-bold text-center drop-shadow-lg text-stroke leading-tight break-words px-2 w-full",
                getOptionTextSize(option)
              )}>
                {option}
              </span>
            </motion.button>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

export function LoadingSpinner({ message = "Loading..." }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center space-y-6 p-8">
      <div className="relative w-24 h-24">
        {ANSWER_COLORS.map((c, i) => {
          const Icon = c.icon;
          return (
            <motion.div
              key={i}
              className={cn("absolute w-10 h-10 rounded-xl flex items-center justify-center shadow-lg", c.bg)}
              animate={{
                scale: [1, 1.2, 1],
                rotate: [0, 90, 180, 270, 360],
                x: [
                  i % 2 === 0 ? -20 : 20,
                  i % 2 === 0 ? 20 : -20,
                  i % 2 === 0 ? -20 : 20,
                ],
                y: [
                  i < 2 ? -20 : 20,
                  i < 2 ? 20 : -20,
                  i < 2 ? -20 : 20,
                ]
              }}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: "easeInOut",
                delay: i * 0.2
              }}
            >
              <Icon size={20} className="text-white" strokeWidth={3} />
            </motion.div>
          );
        })}
      </div>
      <h3 className="text-2xl font-display font-bold text-primary animate-pulse">{message}</h3>
    </div>
  );
}
