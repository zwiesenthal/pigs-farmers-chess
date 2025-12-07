#ifndef AI_H
#define AI_H

#include "game.h"
#include <vector>
#include <array>
#include <chrono>
#include <functional>
#include <atomic>

namespace PigsAndFarmers {

// Transposition table entry types
enum TTFlag : uint8_t {
    TT_EXACT = 0,
    TT_ALPHA = 1,  // Upper bound
    TT_BETA = 2    // Lower bound
};

// Transposition table entry
struct TTEntry {
    uint64_t hash;
    int16_t score;
    int8_t depth;
    uint8_t flag;
    Move bestMove;
    uint8_t age;

    bool isValid(uint64_t h, int d) const {
        return hash == h && depth >= d;
    }
};

// Principal Variation line
struct PVLine {
    std::vector<Move> moves;
    int score;
    int depth;

    void clear() {
        moves.clear();
        score = 0;
        depth = 0;
    }
};

// Search info returned to UI
struct SearchInfo {
    int depth;
    int selDepth;
    int score;       // In centipawns, or MATE_SCORE - ply for mate
    uint64_t nodes;
    uint64_t nps;
    int timeMs;
    std::vector<PVLine> pvLines;  // MultiPV lines

    bool isMate() const { return score > 90000 || score < -90000; }
    int mateIn() const {
        if (score > 90000) return (100000 - score + 1) / 2;
        if (score < -90000) return -(100000 + score + 1) / 2;
        return 0;
    }
};

// Callback for search updates
using SearchCallback = std::function<void(const SearchInfo&)>;

class AI {
public:
    AI();
    ~AI();

    // Configuration
    void setMultiPV(int n) { multiPV = std::min(n, 10); }
    void setMaxDepth(int d) { maxDepth = d; }
    void setTimeLimit(int ms) { timeLimitMs = ms; }
    void setCallback(SearchCallback cb) { callback = cb; }

    // Search
    SearchInfo search(Game& game);
    void stopSearch() { shouldStop = true; }
    bool isSearching() const { return searching; }

    // Clear state
    void clearHash();
    void clearKillers();

    // Stats
    uint64_t getNodes() const { return nodes; }
    uint64_t getTTHits() const { return ttHits; }

    // Get best move directly
    Move getBestMove() const { return bestMoveFound; }

private:
    // Search parameters
    int multiPV = 3;
    int maxDepth = 64;
    int timeLimitMs = 0;  // 0 = infinite
    SearchCallback callback;

    // Search state
    std::atomic<bool> shouldStop;
    std::atomic<bool> searching;
    uint64_t nodes;
    uint64_t ttHits;
    int selDepth;
    Move bestMoveFound;

    // Timing
    std::chrono::steady_clock::time_point startTime;

    // Transposition table
    static constexpr size_t TT_SIZE = 1 << 20;  // ~1M entries
    std::vector<TTEntry> transTable;
    uint8_t ttAge;

    // Killer moves (2 killers per ply, max 128 ply)
    std::array<std::array<Move, 2>, 128> killers;

    // History heuristic
    std::array<std::array<int, 64>, 64> history;

    // Evaluation
    int evaluate(const Game& game) const;

    // Search functions
    int alphaBeta(Game& game, int depth, int alpha, int beta, int ply, PVLine& pv);
    int quiescence(Game& game, int alpha, int beta, int ply);

    // Move ordering
    void orderMoves(std::vector<Move>& moves, const Game& game, Move ttMove, int ply) const;
    int scoreMove(Move move, const Game& game, Move ttMove, int ply) const;

    // TT operations
    void storeTT(uint64_t hash, int score, int depth, TTFlag flag, Move bestMove);
    TTEntry* probeTT(uint64_t hash);

    // Utility
    bool checkTime();
    int adjustMateScore(int score, int ply) const;
};

// Score constants
constexpr int MATE_SCORE = 100000;
constexpr int INFINITY_SCORE = 1000000;

// Piece values for evaluation
constexpr int PAWN_VALUE = 100;
constexpr int QUEEN_VALUE = 900;
constexpr int PROMOTION_BONUS = 50000;  // Near-winning

} // namespace PigsAndFarmers

#endif // AI_H
