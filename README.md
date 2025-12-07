# Pigs and Farmers

A web-based chess variant game featuring **8 Pawns (Pigs)** vs **1 Queen (Farmer)** with a high-performance WebAssembly engine.

## Game Rules

- **Pigs (White)**: 8 Pawns starting on rank 2. Move like standard chess pawns.
- **Farmer (Black)**: 1 Queen starting on d8. Moves like a standard chess queen.

### Win Conditions
- **White wins**: Any pawn reaches rank 8 (promotion) OR the queen is captured
- **Black wins**: All pawns are captured
- **Draw**: Stalemate (no legal moves available)

**Note**: This game is theoretically solved - with perfect play, White can force a win!

## Features

### Engine (C++ → WebAssembly)
- Bitboard representation for fast move generation
- Minimax with Alpha-Beta pruning
- Transposition Table with Zobrist hashing (~1M entries)
- Iterative Deepening
- Advanced move ordering:
  - PV-Move (Principal Variation)
  - MVV-LVA (Most Valuable Victim - Least Valuable Aggressor)
  - Killer move heuristic
  - History heuristic
- Quiescence search for tactical accuracy
- MultiPV: Returns top 3 best moves with full analysis
- Can reach depths of 20+ plies in seconds

### UI (Lichess-style)
- Dark mode theme
- SVG chess pieces with drag-and-drop
- Move highlighting (last move, legal moves)
- **Evaluation bar** showing engine advantage
- **Live analysis** with best move arrow overlay
- Engine statistics: Depth, nodes per second (NPS), PV lines
- Interactive move history with click-to-navigate
- Undo/Redo/Flip board controls
- Play vs Computer mode
- Keyboard shortcuts (Arrow keys, F to flip)

## Getting Started

### Prerequisites
- Node.js (v18+)
- Emscripten (for building WASM)

### Installation

```bash
# Install dependencies
npm install

# Build the WASM engine
make wasm

# Start development server
npm run dev
```

The game will open at **http://localhost:3000/**

### Build Commands

```bash
# Development (with dev server)
npm run dev

# Build WASM only
npm run build:wasm

# Build WASM with debug symbols
npm run build:wasm:debug

# Full production build (WASM + frontend)
npm run build

# Preview production build
npm run preview

# Clean build artifacts
npm run clean
```

## Project Structure

```
pigFarmer2/
├── src/
│   ├── cpp/              # C++ engine source
│   │   ├── game.h        # Game state and rules
│   │   ├── game.cpp      # Bitboard implementation
│   │   ├── ai.h          # AI engine interface
│   │   ├── ai.cpp        # Alpha-beta search with optimizations
│   │   └── wasm_bindings.cpp  # JavaScript/WASM bridge
│   ├── ts/               # TypeScript frontend
│   │   ├── types.ts      # Type definitions
│   │   ├── GameController.ts  # Game logic wrapper
│   │   ├── UIRenderer.ts # UI rendering and interactions
│   │   └── main.ts       # Entry point
│   └── styles/
│       └── main.css      # Lichess-inspired styling
├── public/               # Static assets (WASM output goes here)
├── index.html           # Main HTML file
├── Makefile             # WASM build configuration
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## How to Play

1. **Make moves**: Click or drag pieces to move them
2. **Analyze**: Click "Analyze" to see engine evaluation and best moves
3. **Play vs Computer**: Click "Play vs Computer" to enable AI opponent
4. **Navigate**: Use arrow keys or click moves in the move list
5. **Flip board**: Press F or click "Flip" to view from Black's perspective

### Controls
- `←/→` - Undo/Redo moves
- `F` - Flip board
- Click moves in history to jump to that position

## Engine Settings

Adjust in the UI:
- **Max Depth**: Maximum search depth (1-50)
- **Time**: Time limit in seconds for analysis

## Technical Details

### Performance
- Reaches depth 20+ in seconds on modern hardware
- ~1 million nodes per second on typical machines
- Optimized for this specific game variant

### Memory Usage
- Initial: 64MB
- Maximum: 256MB
- Transposition table: ~16MB (1M entries × 16 bytes)

## Development

### Debug Build
```bash
make debug
```
Includes assertions and debug symbols for development.

### TypeScript
The frontend is written in TypeScript with strict mode enabled. Vite provides hot module replacement for fast iteration.

## License

MIT

## Credits

Built with:
- Emscripten (C++ to WebAssembly compiler)
- Vite (Frontend build tool)
- TypeScript
- Modern browser APIs (WebAssembly, Canvas, etc.)

Inspired by Lichess.org's clean, functional chess interface.
