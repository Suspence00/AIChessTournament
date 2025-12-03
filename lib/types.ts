export type MatchMode = "strict" | "chaos" | "bullet";

export interface MatchClocks {
  whiteMs: number;
  blackMs: number;
}

export interface MatchRequest {
  whiteModel: string;
  blackModel: string;
  mode: MatchMode;
  clockMinutes?: number;
}

export interface MatchMoveEvent {
  type: "move";
  move: string;
  fen: string;
  san?: string;
  displayMoveNum?: number;
  ply: number;
  activeColor: "white" | "black";
  illegalCounts: {
    white: number;
    black: number;
  };
  clocks?: MatchClocks;
  note?: string;
  timestamp?: number; // milliseconds since move started
}

export interface MatchStatusEvent {
  type: "status";
  message: string;
  illegalCounts?: {
    white: number;
    black: number;
  };
  clocks?: MatchClocks;
}

export interface MatchEndEvent {
  type: "end";
  result: MatchResult;
}

export type MatchStreamEvent = MatchMoveEvent | MatchStatusEvent | MatchEndEvent;

export type MatchReason =
  | "checkmate"
  | "resignation"
  | "illegal"
  | "timeout"
  | "stalemate"
  | "fifty-move"
  | "insufficient"
  | "threefold"
  | "max-move";

export interface MatchResult {
  winner: "white" | "black" | "draw";
  reason: MatchReason;
  moves: string[];
  pgn: string;
  illegalCounts: {
    white: number;
    black: number;
  };
  clocks?: MatchClocks;
  finalFen: string;
}

export interface ArenaModelOption {
  label: string;
  value: string;
  provider?: string;
  context?: string;
  inputCostPerMTokens?: number; // dollars per million input tokens
  outputCostPerMTokens?: number; // dollars per million output tokens
  cacheReadCostPerMTokens?: number;
  cacheWriteCostPerMTokens?: number;
}

export interface TournamentRequest {
  models: string[];
  mode: MatchMode;
  clockMinutes?: number;
}

export interface TournamentMatch {
  white: string;
  black: string;
  result: MatchResult;
}

export interface TournamentStanding {
  model: string;
  rating: number;
  games: number;
  points: number;
  wins: number;
  draws: number;
  losses: number;
  checkmates: number;
  illegalForfeits: number;
  timeouts: number;
  resignations: number;
}

export interface TournamentResult {
  mode: MatchMode;
  matches: TournamentMatch[];
  standings: TournamentStanding[];
}
