// Web Worker for running the chess engine off the main thread

declare const self: DedicatedWorkerGlobalScope;

interface WasmModule {
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

let wasm: WasmModule | null = null;

// Message types
type WorkerMessage =
  | { type: 'init' }
  | { type: 'reset' }
  | { type: 'getBoardState' }
  | { type: 'getLegalMoves' }
  | { type: 'makeMove'; from: number; to: number }
  | { type: 'undoMove' }
  | { type: 'getMoveHistory' }
  | { type: 'search'; depth: number; timeMs: number; multiPV: number }
  | { type: 'stopSearch' }
  | { type: 'clearHash' };

// Load the WASM module
importScripts('/pigs_and_farmers.js');

async function initWasm(): Promise<void> {
  // @ts-ignore - PigsAndFarmersModule is loaded via importScripts
  wasm = await PigsAndFarmersModule();
  wasm!.init();

  // Set up search callback
  wasm!.setSearchCallback((infoJson: string) => {
    self.postMessage({ type: 'searchProgress', data: infoJson });
  });

  self.postMessage({ type: 'ready' });
}

// Handle messages from main thread
self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const msg = e.data;

  if (msg.type === 'init') {
    await initWasm();
    return;
  }

  if (!wasm) {
    self.postMessage({ type: 'error', error: 'WASM not initialized' });
    return;
  }

  try {
    switch (msg.type) {
      case 'reset':
        wasm.resetGame();
        wasm.clearHash();
        self.postMessage({ type: 'reset', success: true });
        break;

      case 'getBoardState':
        const state = wasm.getBoardState();
        self.postMessage({ type: 'boardState', data: state });
        break;

      case 'getLegalMoves':
        const moves = wasm.getLegalMoves();
        self.postMessage({ type: 'legalMoves', data: moves });
        break;

      case 'makeMove':
        const success = wasm.makeMove(msg.from, msg.to);
        self.postMessage({ type: 'moveResult', success });
        break;

      case 'undoMove':
        const undoSuccess = wasm.undoMove();
        self.postMessage({ type: 'undoResult', success: undoSuccess });
        break;

      case 'getMoveHistory':
        const history = wasm.getMoveHistory();
        self.postMessage({ type: 'moveHistory', data: history });
        break;

      case 'search':
        const result = wasm.searchBestMove(msg.depth, msg.timeMs, msg.multiPV);
        self.postMessage({ type: 'searchComplete', data: result });
        break;

      case 'stopSearch':
        wasm.stopSearch();
        self.postMessage({ type: 'searchStopped' });
        break;

      case 'clearHash':
        wasm.clearHash();
        self.postMessage({ type: 'hashCleared' });
        break;
    }
  } catch (error) {
    self.postMessage({ type: 'error', error: String(error) });
  }
};

export {};
