import React from "react";
import { Triangle, Diamond, Circle, Square } from "lucide-react";

// Colorblind-safe answer identity: color + shape together.
export const ANSWERS = [
  { color: "#FF3366", Icon: Triangle, text: "#ffffff", name: "Triangle" },
  { color: "#00E5FF", Icon: Diamond, text: "#001018", name: "Diamond" },
  { color: "#FFD700", Icon: Circle, text: "#181400", name: "Circle" },
  { color: "#00FF66", Icon: Square, text: "#001a08", name: "Square" },
];

export function ShapeIcon({ index, size = 32, fill = true }) {
  const a = ANSWERS[index];
  if (!a) return null;
  const { Icon, text } = a;
  return <Icon size={size} strokeWidth={2.5} color={text} fill={fill ? text : "none"} />;
}
