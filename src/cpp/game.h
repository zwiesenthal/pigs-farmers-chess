#ifndef GAME_H
#define GAME_H

#include <cstdint>
#include <vector>
#include <string>
#include <array>

namespace PigsAndFarmers {

// Bitboard type
using Bitboard = uint64_t;

// Square indices (0-63, a1=0, h8=63)
enum Square : int {
    A1, B1, C1, D1, E1, F1, G1, H1,
    A2, B2, C2, D2, E2, F2, G2, H2,
    A3, B3, C3, D3, E3, F3, G3, H3,
    A4, B4, C4, D4, E4, F4, G4, H4,
    A5, B5, C5, D5, E5, F5, G5, H5,
    A6, B6, C6, D6, E6, F6, G6, H6,
    A7, B7, C7, D7, E7, F7, G7, H7,
    A8, B8, C8, D8, E8, F8, G8, H8,
    NO_SQUARE = 64
};

// Move representation (16 bits: 6 for from, 6 for to, 4 for flags)
struct Move {
    uint16_t data;

    Move() : data(0) {}
    Move(int from, int to, int flags = 0) : data((flags << 12) | (to << 6) | from) {}

    int from() const { return data & 0x3F; }
    int to() const { return (data >> 6) & 0x3F; }
    int flags() const { return (data >> 12) & 0xF; }
    bool isCapture() const { return flags() & 4; }
    bool isDoublePush() const { return flags() == 1; }
    bool isPromotion() const { return to() >= A8; }
    bool isValid() const { return data != 0; }

    bool operator==(const Move& other) const { return data == other.data; }
    bool operator!=(const Move& other) const { return data != other.data; }
};

// Move flags
enum MoveFlag {
    QUIET = 0,
    DOUBLE_PUSH = 1,
    CAPTURE = 4
};

// Game result
enum class GameResult {
    ONGOING,
    WHITE_WINS_PROMOTION,  // Pawn reached rank 8
    WHITE_WINS_CAPTURE,    // Queen captured
    BLACK_WINS,            // All pawns captured
    DRAW_STALEMATE
};

// Side to move
enum Side {
    WHITE = 0,  // Pigs (Pawns)
    BLACK = 1   // Farmer (Queen)
};

class Game {
public:
    Game();

    // State management
    void reset();
    void setPosition(Bitboard pawns, Bitboard queen, Side side);

    // Move generation
    std::vector<Move> generateLegalMoves() const;
    bool isLegalMove(Move move) const;

    // Move execution
    bool makeMove(Move move);
    bool unmakeMove();

    // Game state queries
    GameResult getResult() const;
    bool isGameOver() const;
    Side getSideToMove() const { return sideToMove; }

    // Board queries
    Bitboard getPawns() const { return pawns; }
    Bitboard getQueen() const { return queen; }
    int getQueenSquare() const;
    int getPawnCount() const;
    bool isPawnAt(int sq) const { return pawns & (1ULL << sq); }
    bool isQueenAt(int sq) const { return queen & (1ULL << sq); }

    // Zobrist hashing
    uint64_t getHash() const { return hash; }

    // Utility
    std::string moveToAlgebraic(Move move) const;
    Move algebraicToMove(const std::string& str) const;
    std::string toFen() const;

    // Move history for undo
    struct UndoInfo {
        Move move;
        Bitboard capturedPiece;  // For queen capturing pawn
        uint64_t hash;
    };

    const std::vector<UndoInfo>& getMoveHistory() const { return moveHistory; }
    int getPly() const { return ply; }

    // Bitboard utilities (public for AI usage)
    static int popCount(Bitboard bb);
    static int lsb(Bitboard bb);
    static Bitboard rookAttacks(int sq, Bitboard occupied);
    static Bitboard bishopAttacks(int sq, Bitboard occupied);
    static Bitboard queenAttacks(int sq, Bitboard occupied);

private:
    Bitboard pawns;     // White pawns bitboard
    Bitboard queen;     // Black queen bitboard
    Side sideToMove;
    uint64_t hash;
    int ply;

    std::vector<UndoInfo> moveHistory;

    // Move generation helpers
    void generatePawnMoves(std::vector<Move>& moves) const;
    void generateQueenMoves(std::vector<Move>& moves) const;

    // Zobrist keys
    static std::array<uint64_t, 64> pawnKeys;
    static std::array<uint64_t, 64> queenKeys;
    static uint64_t sideKey;
    static bool zobristInitialized;
    static void initZobrist();
};

// Precomputed attack tables
extern std::array<Bitboard, 64> kingAttacks;
extern std::array<Bitboard, 64> knightAttacks;
extern void initAttackTables();

// Square/file/rank utilities
inline int fileOf(int sq) { return sq & 7; }
inline int rankOf(int sq) { return sq >> 3; }
inline int makeSquare(int file, int rank) { return rank * 8 + file; }
inline Bitboard squareBB(int sq) { return 1ULL << sq; }

// Rank masks
constexpr Bitboard RANK_1 = 0x00000000000000FFULL;
constexpr Bitboard RANK_2 = 0x000000000000FF00ULL;
constexpr Bitboard RANK_3 = 0x0000000000FF0000ULL;
constexpr Bitboard RANK_4 = 0x00000000FF000000ULL;
constexpr Bitboard RANK_5 = 0x000000FF00000000ULL;
constexpr Bitboard RANK_6 = 0x0000FF0000000000ULL;
constexpr Bitboard RANK_7 = 0x00FF000000000000ULL;
constexpr Bitboard RANK_8 = 0xFF00000000000000ULL;

// File masks
constexpr Bitboard FILE_A = 0x0101010101010101ULL;
constexpr Bitboard FILE_B = 0x0202020202020202ULL;
constexpr Bitboard FILE_G = 0x4040404040404040ULL;
constexpr Bitboard FILE_H = 0x8080808080808080ULL;

} // namespace PigsAndFarmers

#endif // GAME_H
