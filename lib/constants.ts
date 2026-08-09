// App-wide constants and display helpers that aren't sport-specific.
// Per-sport rating attributes live in lib/sports.ts.

export type Gender = "M" | "F";

export type DisplayOptions = {
  averages: boolean;
  radar: boolean;
  overall: boolean;
  best_worst: boolean;
  archetype: boolean;
};

export const DEFAULT_DISPLAY_OPTIONS: DisplayOptions = {
  averages: false,
  radar: false,
  overall: true,
  best_worst: false,
  archetype: false,
};

// Quick presets for the group owner's settings panel. Purely a UI
// convenience — clicking one just sets the same independent toggles above,
// there's no stored "which preset is active" concept.
export const DISPLAY_PRESETS: Record<string, DisplayOptions> = {
  nothing: { averages: false, radar: false, overall: false, best_worst: false, archetype: false },
  overallOnly: { averages: false, radar: false, overall: true, best_worst: false, archetype: false },
  full: { averages: true, radar: true, overall: true, best_worst: true, archetype: true },
};

export const GAMEDAY_TEAM_SIZE_MIN = 2;
export const GAMEDAY_TEAM_SIZE_MAX = 11;

// Map an already-normalized 0..1 weighted score to the 70–100 "OVR" scale
// shown for every player, in every sport. Never labeled "normalized" in the UI.
export function scoreToDisplay(score01: number): number {
  const clamped = Math.max(0, Math.min(1, score01));
  return Math.round(70 + clamped * 30);
}

// Convert cm to a friendly feet'inches" string for display.
export function cmToFeet(cm: number | null | undefined): string {
  if (!cm) return "—";
  const totalInches = cm / 2.54;
  const feet = Math.floor(totalInches / 12);
  const inches = Math.round(totalInches - feet * 12);
  if (inches === 12) return `${feet + 1}'0"`;
  return `${feet}'${inches}"`;
}

// Every UI surface shows BOTH units together, e.g. "185 cm (6'1")".
export function formatHeight(cm: number | null | undefined): string {
  if (!cm) return "—";
  return `${Math.round(cm)} cm (${cmToFeet(cm)})`;
}

export const GENDER_LABELS: Record<Gender, string> = {
  M: "Male",
  F: "Female",
};

export const GENDER_LABELS_HE: Record<Gender, string> = {
  M: "זכר",
  F: "נקבה",
};
