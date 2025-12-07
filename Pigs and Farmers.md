Prompts Pigs and Farmers
You are an expert Game Developer and AI Engineer specializing in Chess variants and WebAssembly.
Project Goal:
Build a web-based, fully playable version of the chess variant "Pigs and Farmers" (Queen vs. 8 Pawns) with a high-performance analysis engine and a UI that mimics Lichess.org.

1. Game Rules:

- Board: Standard 8x8 Chess board.
- Pieces:
- White (Pigs): 8 Pawns placed on Rank 2 (squares a2-h2). They move exactly like Chess pawns (move forward 1, capture diagonally 1). They can move 2 squares on their first move.
- Black (Farmer): 1 Queen placed on square d8. Moves like a standard Chess Queen.
- Objective:
- White Wins: If any Pawn reaches Rank 8 (promotion) OR if the Black Queen is captured.
- Black Wins: If all White Pawns are captured.
- Draw: Stalemate (no legal moves but not in check/captured).
- Turn: White moves first.

2. Tech Stack:

- Core Engine: C++17 compiled to WebAssembly (WASM) via Emscripten. This is crucial for performance to reach high depths (20+).
- Frontend: TypeScript, HTML5, CSS3.
- Build Tool: Webpack or Vite.

3. Engine Requirements (C++):

- Implement a Bitboard or highly optimized 1D array representation.
- Search Algorithm: Minimax with Alpha-Beta Pruning.
- Optimizations (Mandatory):
- Transposition Table (Zobrist Hashing): To cache positions and avoid recalculating identical states.
- Iterative Deepening: To provide immediate results and progressively search deeper.
- Move Ordering: Use PV-Move, MVV-LVA (Most Valuable Victim - Least Valuable Aggressor), and Killer Heuristic to speed up pruning.
- MultiPV: The engine must return the top 3 best moves with their evaluations and Principal Variation (PV) lines.

4. UI/UX Requirements (Lichess Style):

- Visuals: Dark mode theme (charcoal/grey background).
- Board: SVG pieces, "Wood" or "Green/White" board theme, smooth drag-and-drop animations, and move highlighting (last move, valid moves).
- Analysis Panel (The "Lichess" feel):
- Evaluation Bar: A vertical bar on the side showing the current engine advantage (e.g., +3.5, Mate in 5).
- Live Analysis: Show the "Best Move" arrow on the board.
- Engine Output: Display the Depth (e.g., "Depth 24/24"), Nodes per second (NPS), and the PV line (e.g., "1. e4 Qd6 2. d4...").
- Move History: A clean, clickable list of moves played.
- Controls: Buttons for Undo, Redo, Flip Board, and "Play from here against Computer".

5. Specific deliverables:

- Provide the C++ code for game.cpp, ai.cpp (with the optimizations listed), and wasm_bindings.cpp.
- Provide the TypeScript code for the Game Controller and UI rendering.
- Provide the CSS to replicate the clean, flat Lichess aesthetic.
  Context:
  This game is theoretically solved. The engine must be strong enough to prove the win (find
  "Mate in X") quickly.
