import {
  BoardState,
  GameResult,
  Move,
  SearchInfo,
  WasmModule,
  squareToAlgebraic,
  moveToAlgebraic as moveToAlg
} from './types';

// WasmModule is loaded from window.PigsAndFarmersModule

export type SearchCallback = (info: SearchInfo) => void;
export type StateChangeCallback = (state: BoardState) => void;

export class GameController {
  private wasm: WasmModule | null = null;
  private searchCallback: SearchCallback | null = null;
  private stateChangeCallback: StateChangeCallback | null = null;
  private isSearching = false;
  private moveHistory: string[] = [];
  private currentMoveIndex = -1;

  async initialize(): Promise<void> {
    if (typeof window.PigsAndFarmersModule !== 'function') {
      throw new Error('WASM module not loaded');
    }

    this.wasm = await window.PigsAndFarmersModule();
    this.wasm.init();

    // Set up search callback wrapper
    this.wasm.setSearchCallback((infoJson: string) => {
      if (this.searchCallback) {
        try {
          const info = JSON.parse(infoJson) as SearchInfo;

          // Convert move arrays [from, to] to Move objects {from, to}
          if (info.pvLines) {
            info.pvLines = info.pvLines.map(pv => ({
              ...pv,
              moves: (pv.moves as any).map((m: number[]) => ({ from: m[0], to: m[1] }))
            }));
          }

          // Use setTimeout to yield to browser and keep UI responsive
          setTimeout(() => {
            if (this.searchCallback) {
              this.searchCallback(info);
            }
          }, 0);
        } catch (e) {
          console.error('Failed to parse search info:', e);
        }
      }
    });
  }

  setSearchCallback(callback: SearchCallback): void {
    this.searchCallback = callback;
  }

  setStateChangeCallback(callback: StateChangeCallback): void {
    this.stateChangeCallback = callback;
  }

  private notifyStateChange(): void {
    if (this.stateChangeCallback) {
      this.stateChangeCallback(this.getBoardState());
    }
  }

  getBoardState(): BoardState {
    if (!this.wasm) {
      return {
        pawns: [],
        queen: -1,
        sideToMove: 0,
        result: GameResult.ONGOING,
        ply: 0
      };
    }

    const stateJson = this.wasm.getBoardState();
    return JSON.parse(stateJson) as BoardState;
  }

  getLegalMoves(): Move[] {
    if (!this.wasm) return [];

    const movesJson = this.wasm.getLegalMoves();
    const moveArrays = JSON.parse(movesJson) as number[][];
    return moveArrays.map(([from, to]) => ({ from, to }));
  }

  getLegalMovesFrom(square: number): Move[] {
    return this.getLegalMoves().filter(m => m.from === square);
  }

  makeMove(from: number, to: number): boolean {
    if (!this.wasm || this.isSearching) return false;

    const success = this.wasm.makeMove(from, to);
    if (success) {
      // Truncate future moves if we're not at the end
      if (this.currentMoveIndex < this.moveHistory.length - 1) {
        this.moveHistory = this.moveHistory.slice(0, this.currentMoveIndex + 1);
      }

      // Add to history
      const moveStr = this.wasm.moveToAlgebraic(from, to);
      this.moveHistory.push(moveStr);
      this.currentMoveIndex = this.moveHistory.length - 1;

      this.notifyStateChange();
    }
    return success;
  }

  undoMove(): boolean {
    if (!this.wasm || this.isSearching) return false;
    if (this.currentMoveIndex < 0) return false;

    const success = this.wasm.undoMove();
    if (success) {
      this.currentMoveIndex--;
      this.notifyStateChange();
    }
    return success;
  }

  redoMove(): boolean {
    if (!this.wasm || this.isSearching) return false;
    if (this.currentMoveIndex >= this.moveHistory.length - 1) return false;

    const nextMove = this.moveHistory[this.currentMoveIndex + 1];
    const from = (nextMove.charCodeAt(0) - 'a'.charCodeAt(0)) +
                 (nextMove.charCodeAt(1) - '1'.charCodeAt(0)) * 8;
    const to = (nextMove.charCodeAt(2) - 'a'.charCodeAt(0)) +
               (nextMove.charCodeAt(3) - '1'.charCodeAt(0)) * 8;

    const success = this.wasm.makeMove(from, to);
    if (success) {
      this.currentMoveIndex++;
      this.notifyStateChange();
    }
    return success;
  }

  resetGame(): void {
    if (!this.wasm) return;

    this.wasm.resetGame();
    this.wasm.clearHash();
    this.moveHistory = [];
    this.currentMoveIndex = -1;
    this.notifyStateChange();
  }

  goToMove(index: number): void {
    if (!this.wasm || this.isSearching) return;

    // Reset to start
    this.wasm.resetGame();
    this.currentMoveIndex = -1;

    // Replay moves up to index
    for (let i = 0; i <= index && i < this.moveHistory.length; i++) {
      const move = this.moveHistory[i];
      const from = (move.charCodeAt(0) - 'a'.charCodeAt(0)) +
                   (move.charCodeAt(1) - '1'.charCodeAt(0)) * 8;
      const to = (move.charCodeAt(2) - 'a'.charCodeAt(0)) +
                 (move.charCodeAt(3) - '1'.charCodeAt(0)) * 8;

      this.wasm.makeMove(from, to);
      this.currentMoveIndex = i;
    }

    this.notifyStateChange();
  }

  async search(depth: number = 20, timeMs: number = 5000, multiPV: number = 3): Promise<SearchInfo | null> {
    if (!this.wasm || this.isSearching) return null;

    this.isSearching = true;

    return new Promise((resolve) => {
      try {
        const resultJson = this.wasm!.searchBestMove(depth, timeMs, multiPV);
        const result = JSON.parse(resultJson) as SearchInfo;

        // Convert bestMove array to Move object
        if ((result as any).bestMove) {
          const [from, to] = (result as any).bestMove as number[];
          result.bestMove = { from, to };
        }

        // Convert PV line moves
        result.pvLines = result.pvLines.map(pv => ({
          ...pv,
          moves: (pv.moves as any).map((m: number[]) => ({ from: m[0], to: m[1] }))
        }));

        this.isSearching = false;
        resolve(result);
      } catch (e) {
        console.error('Search failed:', e);
        this.isSearching = false;
        resolve(null);
      }
    });
  }

  stopSearch(): void {
    if (this.wasm) {
      this.wasm.stopSearch();
    }
    this.isSearching = false;
  }

  getMoveHistory(): string[] {
    return [...this.moveHistory];
  }

  getCurrentMoveIndex(): number {
    return this.currentMoveIndex;
  }

  isGameOver(): boolean {
    const state = this.getBoardState();
    return state.result !== GameResult.ONGOING;
  }

  getResultString(): string {
    const state = this.getBoardState();
    switch (state.result) {
      case GameResult.WHITE_WINS_PROMOTION:
        return 'Pigs win by promotion!';
      case GameResult.WHITE_WINS_CAPTURE:
        return 'Pigs win by capturing the Farmer!';
      case GameResult.BLACK_WINS:
        return 'Farmer wins!';
      case GameResult.DRAW_STALEMATE:
        return 'Draw by stalemate';
      default:
        return '';
    }
  }

  getSideToMoveString(): string {
    const state = this.getBoardState();
    return state.sideToMove === 0 ? 'Pigs (White)' : 'Farmer (Black)';
  }

  // Format score for display
  formatScore(info: SearchInfo): string {
    if (info.isMate) {
      const sign = info.mateIn > 0 ? '+' : '';
      return `M${sign}${info.mateIn}`;
    }

    const score = info.score / 100;  // Convert centipawns to pawns
    const sign = score >= 0 ? '+' : '';
    return `${sign}${score.toFixed(2)}`;
  }

  // Format PV line for display
  formatPVLine(moves: Move[], startPly: number): string {
    const state = this.getBoardState();
    const isWhiteToMove = state.sideToMove === 0;
    let moveNum = Math.floor(startPly / 2) + 1;
    let result = '';

    moves.forEach((move, i) => {
      const isWhiteMove = (startPly + i) % 2 === 0;

      if (isWhiteMove) {
        result += `${moveNum}. `;
      } else if (i === 0 && !isWhiteMove) {
        result += `${moveNum}... `;
      }

      result += squareToAlgebraic(move.from) + squareToAlgebraic(move.to) + ' ';

      if (!isWhiteMove) {
        moveNum++;
      }
    });

    return result.trim();
  }

  // Get square color for the board
  getSquareColor(file: number, rank: number): 'light' | 'dark' {
    return (file + rank) % 2 === 0 ? 'dark' : 'light';
  }
}
