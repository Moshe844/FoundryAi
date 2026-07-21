export type MissionQualityLevel = "quick" | "standard" | "thorough" | "production";

export type QualityLevelDisplay = { emoji: string; label: string; blurb: string };

export const QUALITY_LEVEL_DISPLAY: Record<MissionQualityLevel, QualityLevelDisplay> = {
  quick: { emoji: "\u26A1", label: "Quick", blurb: "Prioritize speed — minimal planning, fast implementation" },
  standard: { emoji: "\u2705", label: "Standard", blurb: "Balanced speed and quality" },
  thorough: { emoji: "\uD83D\uDD0D", label: "Thorough", blurb: "Architecture review and verification before completion" },
  production: { emoji: "\uD83C\uDFC6", label: "Production", blurb: "Maximum quality — full review, verification, and reporting" },
};

export const DEFAULT_MISSION_QUALITY: MissionQualityLevel = "standard";
