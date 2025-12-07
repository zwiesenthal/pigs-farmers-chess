// Type definitions for Pigs and Farmers

export interface BoardState {
  pawns: number[];          // Array of square indices where pawns are
  queen: number;            // Square index of queen (-1 if captured)
  sideToMove: number;       // 0 = White (Pigs), 1 = Black (Farmer)
  result: GameResult;
  ply: number;
}

export enum GameResult {
  ONGOING = 0,
  WHITE_WINS_PROMOTION = 1,
  WHITE_WINS_CAPTURE = 2,
  BLACK_WINS = 3,
  DRAW_STALEMATE = 4
}

export interface Move {
  from: number;
  to: number;
}

export interface PVLine {
  score: number;
  depth: number;
  moves: Move[];
}

export interface SearchInfo {
  depth: number;
  selDepth: number;
  score: number;
  nodes: number;
  nps: number;
  timeMs: number;
  isMate: boolean;
  mateIn: number;
  pvLines: PVLine[];
  bestMove?: Move;
}

export interface WasmModule {
  init(): void;
  resetGame(): void;
  getBoardState(): string;
  getLegalMoves(): string;
  makeMove(from: number, to: number): boolean;
  undoMove(): boolean;
  getMoveHistory(): string;
  searchBestMove(depth: number, timeMs: number, multiPV: number): string;
  stopSearch(): void;
  setSearchCallback(callback: (info: string) => void): void;
  clearHash(): void;
  squareToAlgebraic(sq: number): string;
  moveToAlgebraic(from: number, to: number): string;
  evaluate(): number;
}

// Square utilities
export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
export const RANKS = ['1', '2', '3', '4', '5', '6', '7', '8'];

export function fileOf(sq: number): number {
  return sq & 7;
}

export function rankOf(sq: number): number {
  return sq >> 3;
}

export function makeSquare(file: number, rank: number): number {
  return rank * 8 + file;
}

export function squareToAlgebraic(sq: number): string {
  if (sq < 0 || sq >= 64) return '';
  return FILES[fileOf(sq)] + RANKS[rankOf(sq)];
}

export function algebraicToSquare(str: string): number {
  if (str.length !== 2) return -1;
  const file = str.charCodeAt(0) - 'a'.charCodeAt(0);
  const rank = str.charCodeAt(1) - '1'.charCodeAt(0);
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return -1;
  return makeSquare(file, rank);
}

export function moveToAlgebraic(move: Move): string {
  return squareToAlgebraic(move.from) + squareToAlgebraic(move.to);
}
