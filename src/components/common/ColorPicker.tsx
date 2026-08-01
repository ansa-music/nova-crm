import { Check } from "lucide-react";
import { cn } from "@/utils/cn";

export const COLOR_PRESETS: string[] = [
  "243 75% 59%", // indigo
  "271 81% 56%", // violet
  "199 89% 48%", // sky
  "152 60% 40%", // emerald
  "38 92% 50%", // amber
  "0 72% 51%", // red
  "330 81% 60%", // pink
  "24 75% 50%", // orange
  "240 4% 46%", // slate
];

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
}

export function ColorPicker({ value, onChange }: ColorPickerProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {COLOR_PRESETS.map((color) => (
        <button
          key={color}
          type="button"
          onClick={() => onChange(color)}
          className="flex h-8 w-8 items-center justify-center rounded-full transition-transform hover:scale-110"
          style={{ backgroundColor: `hsl(${color})` }}
        >
          {value === color && <Check className="h-4 w-4 text-white" />}
        </button>
      ))}
    </div>
  );
}
