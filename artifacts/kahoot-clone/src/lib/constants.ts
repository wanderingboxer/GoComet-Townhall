import { Triangle, Square, Circle, Diamond } from "lucide-react";

export const ANSWER_COLORS = [
  { bg: "bg-quiz-red", shadow: "shadow-[#8B0E1E]", hover: "hover:bg-[#E21B3C]/90", icon: Triangle },
  { bg: "bg-quiz-blue", shadow: "shadow-[#0A3E7A]", hover: "hover:bg-[#1368CE]/90", icon: Diamond },
  { bg: "bg-quiz-yellow", shadow: "shadow-[#7A4F00]", hover: "hover:bg-[#FFA602]/90", icon: Circle },
  { bg: "bg-quiz-green", shadow: "shadow-[#154805]", hover: "hover:bg-[#26890C]/90", icon: Square },
];

export const TIME_LIMITS = [5, 10, 20, 30, 60, 90, 120];
export const POINT_VALUES = [0, 500, 1000, 2000];
