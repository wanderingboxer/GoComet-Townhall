import { Triangle, Square, Circle, Diamond } from "lucide-react";

export const ANSWER_COLORS = [
  { bg: "bg-quiz-red", shadow: "shadow-[#071733]", hover: "hover:bg-[#0C214C]/90", icon: Triangle },
  { bg: "bg-quiz-blue", shadow: "shadow-[#003699]", hover: "hover:bg-[#0054FF]/90", icon: Diamond },
  { bg: "bg-quiz-yellow", shadow: "shadow-[#34559B]", hover: "hover:bg-[#4B72E5]/90", icon: Circle },
  { bg: "bg-quiz-green", shadow: "shadow-[#10254B]", hover: "hover:bg-[#1A316C]/90", icon: Square },
];

export const TIME_LIMITS = [5, 10, 20, 30, 60, 90, 120];
export const POINT_VALUES = [0, 500, 1000, 2000];
