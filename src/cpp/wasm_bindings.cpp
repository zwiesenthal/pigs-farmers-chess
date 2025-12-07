#include "game.h"
#include "ai.h"
#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <sstream>

using namespace emscripten;
using namespace PigsAndFarmers;

// Global instances
static Game* game = nullptr;
static AI* ai = nullptr;

// Initialize the engine
void init() {
    if (game) delete game;
    if (ai) delete ai;

    game = new Game();
    ai = new AI();
}

// Reset the game
void resetGame() {
    if (game) {
        game->reset();
    }
}

// Get board state as JSON string
std::string getBoardState() {
    if (!game) return "{}";

    std::ostringstream ss;
    ss << "{";

    // Pawns array
    ss << "\"pawns\":[";
    Bitboard pawns = game->getPawns();
    bool first = true;
    for (int sq = 0; sq < 64; sq++) {
        if (pawns & (1ULL << sq)) {
            if (!first) ss << ",";
            ss << sq;
            first = false;
        }
    }
    ss << "],";

    // Queen position
    ss << "\"queen\":" << game->getQueenSquare() << ",";

    // Side to move
    ss << "\"sideToMove\":" << (game->getSideToMove() == WHITE ? 0 : 1) << ",";

    // Game result
    int result = 0;
    switch (game->getResult()) {
        case GameResult::ONGOING: result = 0; break;
        case GameResult::WHITE_WINS_PROMOTION: result = 1; break;
        case GameResult::WHITE_WINS_CAPTURE: result = 2; break;
        case GameResult::BLACK_WINS: result = 3; break;
        case GameResult::DRAW_STALEMATE: result = 4; break;
    }
    ss << "\"result\":" << result << ",";

    // Move count
    ss << "\"ply\":" << game->getPly();

    ss << "}";
    return ss.str();
}

// Get legal moves as JSON array of [from, to] pairs
std::string getLegalMoves() {
    if (!game) return "[]";

    auto moves = game->generateLegalMoves();
    std::ostringstream ss;
    ss << "[";
    for (size_t i = 0; i < moves.size(); i++) {
        if (i > 0) ss << ",";
        ss << "[" << moves[i].from() << "," << moves[i].to() << "]";
    }
    ss << "]";
    return ss.str();
}

// Make a move (from, to as square indices)
bool makeMove(int from, int to) {
    if (!game) return false;

    // Find the move with correct flags
    auto moves = game->generateLegalMoves();
    for (const auto& m : moves) {
        if (m.from() == from && m.to() == to) {
            return game->makeMove(m);
        }
    }
    return false;
}

// Undo last move
bool undoMove() {
    if (!game) return false;
    return game->unmakeMove();
}

// Get move history as JSON
std::string getMoveHistory() {
    if (!game) return "[]";

    const auto& history = game->getMoveHistory();
    std::ostringstream ss;
    ss << "[";
    for (size_t i = 0; i < history.size(); i++) {
        if (i > 0) ss << ",";
        ss << "\"" << game->moveToAlgebraic(history[i].move) << "\"";
    }
    ss << "]";
    return ss.str();
}

// Global callback for search updates
static val jsCallback = val::undefined();

void cppSearchCallback(const SearchInfo& info) {
    if (jsCallback.isUndefined()) return;

    // Build PV lines JSON
    std::ostringstream pvSS;
    pvSS << "[";
    for (size_t i = 0; i < info.pvLines.size(); i++) {
        if (i > 0) pvSS << ",";
        pvSS << "{\"score\":" << info.pvLines[i].score;
        pvSS << ",\"depth\":" << info.pvLines[i].depth;
        pvSS << ",\"moves\":[";
        for (size_t j = 0; j < info.pvLines[i].moves.size(); j++) {
            if (j > 0) pvSS << ",";
            pvSS << "[" << info.pvLines[i].moves[j].from() << ","
                 << info.pvLines[i].moves[j].to() << "]";
        }
        pvSS << "]}";
    }
    pvSS << "]";

    // Build full info JSON
    std::ostringstream ss;
    ss << "{";
    ss << "\"depth\":" << info.depth << ",";
    ss << "\"selDepth\":" << info.selDepth << ",";
    ss << "\"score\":" << info.score << ",";
    ss << "\"nodes\":" << info.nodes << ",";
    ss << "\"nps\":" << info.nps << ",";
    ss << "\"timeMs\":" << info.timeMs << ",";
    ss << "\"isMate\":" << (info.isMate() ? "true" : "false") << ",";
    ss << "\"mateIn\":" << info.mateIn() << ",";
    ss << "\"pvLines\":" << pvSS.str();
    ss << "}";

    jsCallback(val(ss.str()));
}

// Start AI search
std::string searchBestMove(int depth, int timeMs, int multiPV) {
    if (!game || !ai) return "{}";

    ai->setMaxDepth(depth);
    ai->setTimeLimit(timeMs);
    ai->setMultiPV(multiPV);
    ai->setCallback(cppSearchCallback);

    SearchInfo info = ai->search(*game);

    // Return final result
    std::ostringstream ss;
    ss << "{";
    ss << "\"depth\":" << info.depth << ",";
    ss << "\"selDepth\":" << info.selDepth << ",";
    ss << "\"score\":" << info.score << ",";
    ss << "\"nodes\":" << info.nodes << ",";
    ss << "\"nps\":" << info.nps << ",";
    ss << "\"timeMs\":" << info.timeMs << ",";
    ss << "\"isMate\":" << (info.isMate() ? "true" : "false") << ",";
    ss << "\"mateIn\":" << info.mateIn() << ",";

    // Best move
    Move best = ai->getBestMove();
    ss << "\"bestMove\":[" << best.from() << "," << best.to() << "],";

    // PV lines
    ss << "\"pvLines\":[";
    for (size_t i = 0; i < info.pvLines.size(); i++) {
        if (i > 0) ss << ",";
        ss << "{\"score\":" << info.pvLines[i].score;
        ss << ",\"depth\":" << info.pvLines[i].depth;
        ss << ",\"moves\":[";
        for (size_t j = 0; j < info.pvLines[i].moves.size(); j++) {
            if (j > 0) ss << ",";
            ss << "[" << info.pvLines[i].moves[j].from() << ","
                 << info.pvLines[i].moves[j].to() << "]";
        }
        ss << "]}";
    }
    ss << "]";

    ss << "}";
    return ss.str();
}

// Stop ongoing search
void stopSearch() {
    if (ai) {
        ai->stopSearch();
    }
}

// Set search callback
void setSearchCallback(val callback) {
    jsCallback = callback;
}

// Clear transposition table
void clearHash() {
    if (ai) {
        ai->clearHash();
        ai->clearKillers();
    }
}

// Convert square index to algebraic notation
std::string squareToAlgebraic(int sq) {
    if (sq < 0 || sq >= 64) return "";
    char file = 'a' + fileOf(sq);
    char rank = '1' + rankOf(sq);
    return std::string(1, file) + std::string(1, rank);
}

// Convert move to algebraic notation
std::string moveToAlgebraic(int from, int to) {
    return squareToAlgebraic(from) + squareToAlgebraic(to);
}

// Get evaluation of current position
int evaluate() {
    if (!game || !ai) return 0;

    // Use the AI's evaluate function indirectly via a shallow search
    // For now, return a simple material count
    int score = 0;
    score += game->getPawnCount() * 100;  // Pawn value
    if (game->getQueenSquare() != NO_SQUARE) {
        score -= 900;  // Queen value
    }
    return score;
}

// Emscripten bindings
EMSCRIPTEN_BINDINGS(pigs_and_farmers) {
    function("init", &init);
    function("resetGame", &resetGame);
    function("getBoardState", &getBoardState);
    function("getLegalMoves", &getLegalMoves);
    function("makeMove", &makeMove);
    function("undoMove", &undoMove);
    function("getMoveHistory", &getMoveHistory);
    function("searchBestMove", &searchBestMove);
    function("stopSearch", &stopSearch);
    function("setSearchCallback", &setSearchCallback);
    function("clearHash", &clearHash);
    function("squareToAlgebraic", &squareToAlgebraic);
    function("moveToAlgebraic", &moveToAlgebraic);
    function("evaluate", &evaluate);
}
