import type { Gender } from "./constants";
import type { SportId } from "./sports";

export type Profile = {
  id: string;
  username: string;
  display_name: string;
  email: string | null;
  gender: Gender | null;
  height_cm: number | null;
  weight_kg: number | null;
  photo_url: string | null;
  created_at: string;
};

export type Group = {
  id: string;
  code: string;
  name: string;
  sport: SportId;
  creator_id: string;
  display_options: {
    averages: boolean;
    radar: boolean;
    overall: boolean;
    best_worst: boolean;
    archetype: boolean;
  };
  created_at: string;
};

export type GroupPlayer = {
  group_id: string;
  user_id: string;
  joined_at: string;
  rating_weight: number;
  is_manager: boolean;
  profile?: Profile;
};

// One rater's submission about one ratee, within one group. `values` is
// sparse — only keys that were actually rated. Never exposed to any client
// except the rater's own row (RLS) or via server-computed aggregates.
export type Rating = {
  group_id: string;
  rater_id: string;
  ratee_id: string;
  values: Record<string, number>;
  weight: 1 | 2 | 3 | 5;
  source: "normal" | "manager";
  updated_at: string;
};

export type Gameday = {
  id: string;
  group_id: string;
  creator_id: string;
  name: string;
  date: string; // YYYY-MM-DD
  team_size: number;
  created_at: string;
};

export type GamedayGuest = {
  id: string;
  gameday_id: string;
  name: string;
  gender: Gender | null;
  height_cm: number | null;
  photo_url: string | null;
  created_by: string;
  created_at: string;
};

export type ParticipantKind = "member" | "guest";

// A resolved participant — either a group member (profile) or a gameday-only
// guest — used anywhere the UI needs to render "who is this."
export type Participant =
  | { kind: "member"; id: string; profile: Profile }
  | { kind: "guest"; id: string; guest: GamedayGuest };

export type WaitlistEntry = {
  gameday_id: string;
  user_id: string;
  added_at: string;
  profile?: Profile;
  position: number; // 1 = next up
};

export type GamedayRestriction = {
  id: string;
  gameday_id: string;
  kind: "apart" | "together";
  a: Participant;
  b: Participant;
};

export type Team = {
  id: string;
  gameday_id: string;
  name: string;
  seed: number;
  members?: (Participant & { is_reserve: boolean })[];
};

// Aggregate stats/score for one player, shaped by the group's display_options
// and the sport's params. Numbers are always the 70–100 display scale.
export type PlayerCard = {
  user_id: string;
  username: string;
  display_name: string;
  photo_url: string | null;
  height_cm: number | null;
  gender: Gender | null;
  sport: SportId;
  averages: Record<string, number> | null; // per-attribute, 70-100, gated by display_options.averages
  overall: number | null; // 70-100, gated by display_options.overall
  normalized: Record<string, number> | null; // 0..1 per param, for radar shape
  archetype: string | null;
  archetype_tier: string | null;
  best_param: string | null;
  worst_param: string | null;
  raterCount: number; // how many people have rated this player at all (any attribute)
};

// Manager-only per-attribute rated-by counts for one player. Counts only —
// never exposes who rated what.
export type ManagerInspection = {
  user_id: string;
  overallRaterCount: number;
  perParam: { key: string; label: string; raterCount: number }[];
  myRating: Record<string, number> | null; // the manager's own rating of this player, if any
  // Full current averages/overall (70-100 scale), computed regardless of the
  // group's display_options — manager-only, never exposed to regular
  // members. Still never reveals who rated what/how, only the aggregate.
  averages: Record<string, number>;
  overall: number | null;
};
