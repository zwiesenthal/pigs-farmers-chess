import {
  BoardState,
  GameResult,
  Move,
  SearchInfo,
  PVLine,
  squareToAlgebraic
} from './types';

export type SearchCallback = (info: SearchInfo) => void;
export type StateChangeCallback = (state: BoardState) => void;

export class WorkerGameController {
  private worker: Worker | null = null;
  private searchCallback: SearchCallback | null = null;
  private stateChangeCallback: StateChangeCallback | null = null;
  private isSearching = false;
  private moveHistory: string[] = [];
  private currentMoveIndex = -1;
  private cachedBoardState: BoardState | null = null;

  // Pending promises for async operations
  private pendingResolvers: Map<string, (value: any) => void> = new Map();
  private messageId = 0;
  private searchResolver: ((value: any) => void) | null = null;
  private reinitializing = false;

  async initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Get the absolute URLs for the WASM module
        const baseUrl = window.location.origin;
        const wasmJsUrl = new URL('/pigs_and_farmers.js', baseUrl).href;
        const wasmBinaryUrl = new URL('/pigs_and_farmers.wasm', baseUrl).href;

        // Create worker from inline script to avoid separate file issues
        const workerCode = `
          let wasm = null;
          const wasmJsUrl = '${wasmJsUrl}';
          const wasmBinaryUrl = '${wasmBinaryUrl}';

          importScripts(wasmJsUrl);

          async function initWasm() {
            // Configure module to find the WASM binary
            wasm = await PigsAndFarmersModule({
              locateFile: (path) => {
                if (path.endsWith('.wasm')) {
                  return wasmBinaryUrl;
                }
                return path;
              }
            });
            wasm.init();
            wasm.setSearchCallback((infoJson) => {
              self.postMessage({ type: 'searchProgress', data: infoJson });
            });
            self.postMessage({ type: 'ready' });
          }

          self.onmessage = async (e) => {
            const msg = e.data;

            if (msg.type === 'init') {
              try {
                await initWasm();
              } catch (err) {
                self.postMessage({ type: 'initError', error: String(err) });
              }
              return;
            }

            if (!wasm) {
              self.postMessage({ type: 'error', id: msg.id, error: 'WASM not initialized' });
              return;
            }

            try {
              switch (msg.type) {
                case 'reset':
                  wasm.resetGame();
                  wasm.clearHash();
                  self.postMessage({ type: 'reset', id: msg.id, success: true });
                  break;

                case 'getBoardState':
                  const state = wasm.getBoardState();
                  self.postMessage({ type: 'boardState', id: msg.id, data: state });
                  break;

                case 'getLegalMoves':
                  const moves = wasm.getLegalMoves();
                  self.postMessage({ type: 'legalMoves', id: msg.id, data: moves });
                  break;

                case 'makeMove':
                  const success = wasm.makeMove(msg.from, msg.to);
                  const newState = wasm.getBoardState();
                  self.postMessage({ type: 'moveResult', id: msg.id, success, state: newState });
                  break;

                case 'undoMove':
                  const undoSuccess = wasm.undoMove();
                  const undoState = wasm.getBoardState();
                  self.postMessage({ type: 'undoResult', id: msg.id, success: undoSuccess, state: undoState });
                  break;

                case 'search':
                  const result = wasm.searchBestMove(msg.depth, msg.timeMs, msg.multiPV);
                  self.postMessage({ type: 'searchComplete', id: msg.id, data: result });
                  break;

                case 'stopSearch':
                  wasm.stopSearch();
                  self.postMessage({ type: 'searchStopped', id: msg.id });
                  break;

                case 'clearHash':
                  wasm.clearHash();
                  self.postMessage({ type: 'hashCleared', id: msg.id });
                  break;

                case 'moveToAlgebraic':
                  const algebraic = wasm.moveToAlgebraic(msg.from, msg.to);
                  self.postMessage({ type: 'algebraic', id: msg.id, data: algebraic });
                  break;
              }
            } catch (error) {
              self.postMessage({ type: 'error', id: msg.id, error: String(error) });
            }
          };
        `;

        const blob = new Blob([workerCode], { type: 'application/javascript' });
        const workerUrl = URL.createObjectURL(blob);
        this.worker = new Worker(workerUrl);

        this.worker.onmessage = (e) => {
          const msg = e.data;

          if (msg.type === 'ready') {
            resolve();
            return;
          }

          if (msg.type === 'initError') {
            console.error('Worker init error:', msg.error);
            reject(new Error(msg.error));
            return;
          }

          if (msg.type === 'searchProgress') {
            this.handleSearchProgress(msg.data);
            return;
          }

          if (msg.type === 'error') {
            console.error('Worker error:', msg.error);
            const resolver = this.pendingResolvers.get(msg.id);
            if (resolver) {
              this.pendingResolvers.delete(msg.id);
              resolver(null);
            }
            return;
          }

          // Handle responses with IDs
          const resolver = this.pendingResolvers.get(msg.id);
          if (resolver) {
            this.pendingResolvers.delete(msg.id);
            resolver(msg);
          }
        };

        this.worker.onerror = (e) => {
          console.error('Worker error:', e);
          reject(e);
        };

        // Initialize the worker
        this.worker.postMessage({ type: 'init' });

      } catch (error) {
        reject(error);
      }
    });
  }

  private sendMessage(msg: any): Promise<any> {
    return new Promise((resolve) => {
      const id = String(++this.messageId);
      msg.id = id;
      this.pendingResolvers.set(id, resolve);
      this.worker?.postMessage(msg);
    });
  }

  private handleSearchProgress(infoJson: string): void {
    if (!this.searchCallback) return;

    try {
      const info = JSON.parse(infoJson) as SearchInfo;

      // Convert move arrays to Move objects
      if (info.pvLines) {
        info.pvLines = info.pvLines.map(pv => ({
          ...pv,
          moves: (pv.moves as any).map((m: number[]) => ({ from: m[0], to: m[1] }))
        }));
      }

      this.searchCallback(info);
    } catch (e) {
      console.error('Failed to parse search progress:', e);
    }
  }

  setSearchCallback(callback: SearchCallback): void {
    this.searchCallback = callback;
  }

  setStateChangeCallback(callback: StateChangeCallback): void {
    this.stateChangeCallback = callback;
  }

  private notifyStateChange(): void {
    if (this.stateChangeCallback && this.cachedBoardState) {
      this.stateChangeCallback(this.cachedBoardState);
    }
  }

  async getBoardState(): Promise<BoardState> {
    const response = await this.sendMessage({ type: 'getBoardState' });
    if (response?.data) {
      this.cachedBoardState = JSON.parse(response.data);
      return this.cachedBoardState!;
    }
    return {
      pawns: [],
      queen: -1,
      sideToMove: 0,
      result: GameResult.ONGOING,
      ply: 0
    };
  }

  getBoardStateSync(): BoardState {
    return this.cachedBoardState || {
      pawns: [],
      queen: -1,
      sideToMove: 0,
      result: GameResult.ONGOING,
      ply: 0
    };
  }

  async getLegalMoves(): Promise<Move[]> {
    const response = await this.sendMessage({ type: 'getLegalMoves' });
    if (response?.data) {
      const moveArrays = JSON.parse(response.data) as number[][];
      return moveArrays.map(([from, to]) => ({ from, to }));
    }
    return [];
  }

  async getLegalMovesFrom(square: number): Promise<Move[]> {
    const moves = await this.getLegalMoves();
    return moves.filter(m => m.from === square);
  }

  async makeMove(from: number, to: number): Promise<boolean> {
    if (this.isSearching) return false;

    const response = await this.sendMessage({ type: 'makeMove', from, to });
    if (response?.success) {
      // Update cached state
      if (response.state) {
        this.cachedBoardState = JSON.parse(response.state);
      }

      // Clear hash table after move to ensure fresh analysis
      await this.sendMessage({ type: 'clearHash' });

      // Truncate future moves if not at the end
      if (this.currentMoveIndex < this.moveHistory.length - 1) {
        this.moveHistory = this.moveHistory.slice(0, this.currentMoveIndex + 1);
      }

      // Get algebraic notation
      const moveStr = squareToAlgebraic(from) + squareToAlgebraic(to);
      this.moveHistory.push(moveStr);
      this.currentMoveIndex = this.moveHistory.length - 1;

      this.notifyStateChange();
      return true;
    }
    return false;
  }

  async undoMove(): Promise<boolean> {
    if (this.isSearching) return false;
    if (this.currentMoveIndex < 0) return false;

    const response = await this.sendMessage({ type: 'undoMove' });
    if (response?.success) {
      if (response.state) {
        this.cachedBoardState = JSON.parse(response.state);
      }
      this.currentMoveIndex--;
      this.notifyStateChange();
      return true;
    }
    return false;
  }

  async redoMove(): Promise<boolean> {
    if (this.isSearching) return false;
    if (this.currentMoveIndex >= this.moveHistory.length - 1) return false;

    const nextMove = this.moveHistory[this.currentMoveIndex + 1];
    const from = (nextMove.charCodeAt(0) - 'a'.charCodeAt(0)) +
                 (nextMove.charCodeAt(1) - '1'.charCodeAt(0)) * 8;
    const to = (nextMove.charCodeAt(2) - 'a'.charCodeAt(0)) +
               (nextMove.charCodeAt(3) - '1'.charCodeAt(0)) * 8;

    const response = await this.sendMessage({ type: 'makeMove', from, to });
    if (response?.success) {
      if (response.state) {
        this.cachedBoardState = JSON.parse(response.state);
      }
      this.currentMoveIndex++;
      this.notifyStateChange();
      return true;
    }
    return false;
  }

  async resetGame(): Promise<void> {
    await this.sendMessage({ type: 'reset' });
    this.moveHistory = [];
    this.currentMoveIndex = -1;
    await this.getBoardState();  // Refresh cached state
    this.notifyStateChange();
  }

  async goToMove(index: number): Promise<void> {
    if (this.isSearching) return;

    // Reset to start
    await this.sendMessage({ type: 'reset' });
    this.currentMoveIndex = -1;

    // Replay moves up to index
    for (let i = 0; i <= index && i < this.moveHistory.length; i++) {
      const move = this.moveHistory[i];
      const from = (move.charCodeAt(0) - 'a'.charCodeAt(0)) +
                   (move.charCodeAt(1) - '1'.charCodeAt(0)) * 8;
      const to = (move.charCodeAt(2) - 'a'.charCodeAt(0)) +
                 (move.charCodeAt(3) - '1'.charCodeAt(0)) * 8;

      await this.sendMessage({ type: 'makeMove', from, to });
      this.currentMoveIndex = i;
    }

    await this.getBoardState();
    this.notifyStateChange();
  }

  async search(depth: number = 20, timeMs: number = 5000, multiPV: number = 3): Promise<SearchInfo | null> {
    if (this.isSearching || this.reinitializing) return null;

    this.isSearching = true;

    return new Promise((resolve) => {
      this.searchResolver = resolve;

      this.sendMessage({
        type: 'search',
        depth,
        timeMs,
        multiPV
      }).then((response) => {
        this.searchResolver = null;
        this.isSearching = false;

        if (response?.data) {
          try {
            const result = JSON.parse(response.data) as SearchInfo;

            // Convert bestMove array to Move object
            if ((result as any).bestMove) {
              const [from, to] = (result as any).bestMove as number[];
              result.bestMove = { from, to };
            }

            // Convert PV line moves
            if (result.pvLines) {
              result.pvLines = result.pvLines.map(pv => ({
                ...pv,
                moves: (pv.moves as any).map((m: number[]) => ({ from: m[0], to: m[1] }))
              }));
            }

            resolve(result);
          } catch (e) {
            console.error('Search parse failed:', e);
            resolve(null);
          }
        } else {
          resolve(null);
        }
      }).catch((e) => {
        console.error('Search failed:', e);
        this.searchResolver = null;
        this.isSearching = false;
        resolve(null);
      });
    });
  }

  async stopSearch(): Promise<void> {
    if (!this.isSearching) return;

    // The worker is blocked in a synchronous search call and can't receive messages.
    // We need to terminate the worker and reinitialize it.
    this.reinitializing = true;
    this.isSearching = false;

    // Resolve the pending search promise with null
    if (this.searchResolver) {
      this.searchResolver(null);
      this.searchResolver = null;
    }

    // Clear all pending resolvers
    this.pendingResolvers.forEach((resolver) => resolver(null));
    this.pendingResolvers.clear();

    // Terminate the worker
    this.worker?.terminate();
    this.worker = null;

    // Reinitialize the worker
    await this.initialize();

    // Replay moves to get back to current position
    for (const moveStr of this.moveHistory.slice(0, this.currentMoveIndex + 1)) {
      const from = (moveStr.charCodeAt(0) - 'a'.charCodeAt(0)) +
                   (moveStr.charCodeAt(1) - '1'.charCodeAt(0)) * 8;
      const to = (moveStr.charCodeAt(2) - 'a'.charCodeAt(0)) +
                 (moveStr.charCodeAt(3) - '1'.charCodeAt(0)) * 8;
      await this.sendMessage({ type: 'makeMove', from, to });
    }

    // Refresh cached state
    await this.getBoardState();

    this.reinitializing = false;
  }

  getMoveHistory(): string[] {
    return [...this.moveHistory];
  }

  getCurrentMoveIndex(): number {
    return this.currentMoveIndex;
  }

  isGameOver(): boolean {
    const state = this.getBoardStateSync();
    return state.result !== GameResult.ONGOING;
  }

  getResultString(): string {
    const state = this.getBoardStateSync();
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
    const state = this.getBoardStateSync();
    return state.sideToMove === 0 ? 'Pigs (White)' : 'Farmer (Black)';
  }

  formatScore(info: SearchInfo): string {
    if (info.isMate) {
      const sign = info.mateIn > 0 ? '+' : '';
      return `M${sign}${info.mateIn}`;
    }

    const score = info.score / 100;
    const sign = score >= 0 ? '+' : '';
    return `${sign}${score.toFixed(2)}`;
  }

  formatPVLine(moves: Move[], startPly: number): string {
    const state = this.getBoardStateSync();
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

  getSquareColor(file: number, rank: number): 'light' | 'dark' {
    return (file + rank) % 2 === 0 ? 'dark' : 'light';
  }

  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
