#include "game.h"
#include <random>
#include <algorithm>
#include <sstream>
#include <cstring>

namespace PigsAndFarmers {

// Static member initialization
std::array<uint64_t, 64> Game::pawnKeys;
std::array<uint64_t, 64> Game::queenKeys;
uint64_t Game::sideKey;
bool Game::zobristInitialized = false;

// Attack tables
std::array<Bitboard, 64> kingAttacks;
std::array<Bitboard, 64> knightAttacks;

void initAttackTables() {
    // Initialize king attacks (not used in this game but useful)
    for (int sq = 0; sq < 64; sq++) {
        Bitboard attacks = 0;
        int rank = rankOf(sq);
        int file = fileOf(sq);

        for (int dr = -1; dr <= 1; dr++) {
            for (int df = -1; df <= 1; df++) {
                if (dr == 0 && df == 0) continue;
                int nr = rank + dr;
                int nf = file + df;
                if (nr >= 0 && nr < 8 && nf >= 0 && nf < 8) {
                    attacks |= squareBB(makeSquare(nf, nr));
                }
            }
        }
        kingAttacks[sq] = attacks;
    }

    // Knight attacks (not used but included for completeness)
    const int knightOffsets[8][2] = {
        {-2, -1}, {-2, 1}, {-1, -2}, {-1, 2},
        {1, -2}, {1, 2}, {2, -1}, {2, 1}
    };

    for (int sq = 0; sq < 64; sq++) {
        Bitboard attacks = 0;
        int rank = rankOf(sq);
        int file = fileOf(sq);

        for (int i = 0; i < 8; i++) {
            int nr = rank + knightOffsets[i][0];
            int nf = file + knightOffsets[i][1];
            if (nr >= 0 && nr < 8 && nf >= 0 && nf < 8) {
                attacks |= squareBB(makeSquare(nf, nr));
            }
        }
        knightAttacks[sq] = attacks;
    }
}

void Game::initZobrist() {
    if (zobristInitialized) return;

    std::mt19937_64 rng(0x1234567890ABCDEFULL);

    for (int sq = 0; sq < 64; sq++) {
        pawnKeys[sq] = rng();
        queenKeys[sq] = rng();
    }
    sideKey = rng();

    zobristInitialized = true;
}

Game::Game() {
    initZobrist();
    initAttackTables();
    reset();
}

void Game::reset() {
    // Place 8 pawns on rank 2 (a2-h2)
    pawns = RANK_2;

    // Place queen on d8
    queen = squareBB(D8);

    sideToMove = WHITE;
    ply = 0;

    // Calculate initial hash
    hash = 0;
    for (int sq = A2; sq <= H2; sq++) {
        hash ^= pawnKeys[sq];
    }
    hash ^= queenKeys[D8];
    // White to move, so no sideKey XOR needed initially
}

void Game::setPosition(Bitboard p, Bitboard q, Side side) {
    pawns = p;
    queen = q;
    sideToMove = side;
    ply = 0;
    moveHistory.clear();

    // Recalculate hash
    hash = 0;
    Bitboard bb = pawns;
    while (bb) {
        int sq = lsb(bb);
        hash ^= pawnKeys[sq];
        bb &= bb - 1;
    }
    bb = queen;
    while (bb) {
        int sq = lsb(bb);
        hash ^= queenKeys[sq];
        bb &= bb - 1;
    }
    if (sideToMove == BLACK) {
        hash ^= sideKey;
    }
}

int Game::popCount(Bitboard bb) {
#ifdef __EMSCRIPTEN__
    return __builtin_popcountll(bb);
#else
    return __builtin_popcountll(bb);
#endif
}

int Game::lsb(Bitboard bb) {
    if (bb == 0) return -1;
#ifdef __EMSCRIPTEN__
    return __builtin_ctzll(bb);
#else
    return __builtin_ctzll(bb);
#endif
}

Bitboard Game::rookAttacks(int sq, Bitboard occupied) {
    Bitboard attacks = 0;
    int rank = rankOf(sq);
    int file = fileOf(sq);

    // North
    for (int r = rank + 1; r < 8; r++) {
        attacks |= squareBB(makeSquare(file, r));
        if (occupied & squareBB(makeSquare(file, r))) break;
    }
    // South
    for (int r = rank - 1; r >= 0; r--) {
        attacks |= squareBB(makeSquare(file, r));
        if (occupied & squareBB(makeSquare(file, r))) break;
    }
    // East
    for (int f = file + 1; f < 8; f++) {
        attacks |= squareBB(makeSquare(f, rank));
        if (occupied & squareBB(makeSquare(f, rank))) break;
    }
    // West
    for (int f = file - 1; f >= 0; f--) {
        attacks |= squareBB(makeSquare(f, rank));
        if (occupied & squareBB(makeSquare(f, rank))) break;
    }

    return attacks;
}

Bitboard Game::bishopAttacks(int sq, Bitboard occupied) {
    Bitboard attacks = 0;
    int rank = rankOf(sq);
    int file = fileOf(sq);

    // NE
    for (int r = rank + 1, f = file + 1; r < 8 && f < 8; r++, f++) {
        attacks |= squareBB(makeSquare(f, r));
        if (occupied & squareBB(makeSquare(f, r))) break;
    }
    // NW
    for (int r = rank + 1, f = file - 1; r < 8 && f >= 0; r++, f--) {
        attacks |= squareBB(makeSquare(f, r));
        if (occupied & squareBB(makeSquare(f, r))) break;
    }
    // SE
    for (int r = rank - 1, f = file + 1; r >= 0 && f < 8; r--, f++) {
        attacks |= squareBB(makeSquare(f, r));
        if (occupied & squareBB(makeSquare(f, r))) break;
    }
    // SW
    for (int r = rank - 1, f = file - 1; r >= 0 && f >= 0; r--, f--) {
        attacks |= squareBB(makeSquare(f, r));
        if (occupied & squareBB(makeSquare(f, r))) break;
    }

    return attacks;
}

Bitboard Game::queenAttacks(int sq, Bitboard occupied) {
    return rookAttacks(sq, occupied) | bishopAttacks(sq, occupied);
}

void Game::generatePawnMoves(std::vector<Move>& moves) const {
    Bitboard occupied = pawns | queen;

    Bitboard bb = pawns;
    while (bb) {
        int from = lsb(bb);
        bb &= bb - 1;

        int rank = rankOf(from);
        int file = fileOf(from);

        // Single push (forward = +8 for white)
        int to = from + 8;
        if (to < 64 && !(occupied & squareBB(to))) {
            moves.push_back(Move(from, to, QUIET));

            // Double push from rank 2
            if (rank == 1) {
                int to2 = from + 16;
                if (!(occupied & squareBB(to2))) {
                    moves.push_back(Move(from, to2, DOUBLE_PUSH));
                }
            }
        }

        // Captures (diagonal)
        // Left capture (NW)
        if (file > 0) {
            int capSq = from + 7;
            if (capSq < 64 && (queen & squareBB(capSq))) {
                moves.push_back(Move(from, capSq, CAPTURE));
            }
        }
        // Right capture (NE)
        if (file < 7) {
            int capSq = from + 9;
            if (capSq < 64 && (queen & squareBB(capSq))) {
                moves.push_back(Move(from, capSq, CAPTURE));
            }
        }
    }
}

void Game::generateQueenMoves(std::vector<Move>& moves) const {
    if (queen == 0) return;

    int from = lsb(queen);
    Bitboard occupied = pawns | queen;
    Bitboard attacks = queenAttacks(from, occupied);

    // Non-captures (to empty squares)
    Bitboard nonCaptures = attacks & ~occupied;
    while (nonCaptures) {
        int to = lsb(nonCaptures);
        nonCaptures &= nonCaptures - 1;
        moves.push_back(Move(from, to, QUIET));
    }

    // Captures (pawns only)
    Bitboard captures = attacks & pawns;
    while (captures) {
        int to = lsb(captures);
        captures &= captures - 1;
        moves.push_back(Move(from, to, CAPTURE));
    }
}

std::vector<Move> Game::generateLegalMoves() const {
    std::vector<Move> moves;
    moves.reserve(32);

    if (sideToMove == WHITE) {
        generatePawnMoves(moves);
    } else {
        generateQueenMoves(moves);
    }

    return moves;
}

bool Game::isLegalMove(Move move) const {
    auto moves = generateLegalMoves();
    for (const auto& m : moves) {
        if (m == move) return true;
    }
    return false;
}

bool Game::makeMove(Move move) {
    if (!isLegalMove(move)) return false;

    UndoInfo undo;
    undo.move = move;
    undo.hash = hash;
    undo.capturedPiece = 0;

    int from = move.from();
    int to = move.to();

    if (sideToMove == WHITE) {
        // Pawn move
        if (move.isCapture()) {
            // Pawn captures queen
            undo.capturedPiece = queen;
            hash ^= queenKeys[to];
            queen = 0;
        }

        // Move pawn
        hash ^= pawnKeys[from];
        hash ^= pawnKeys[to];
        pawns &= ~squareBB(from);
        pawns |= squareBB(to);
    } else {
        // Queen move
        if (move.isCapture()) {
            // Queen captures pawn
            undo.capturedPiece = squareBB(to);
            hash ^= pawnKeys[to];
            pawns &= ~squareBB(to);
        }

        // Move queen
        hash ^= queenKeys[from];
        hash ^= queenKeys[to];
        queen &= ~squareBB(from);
        queen |= squareBB(to);
    }

    hash ^= sideKey;
    sideToMove = (sideToMove == WHITE) ? BLACK : WHITE;
    ply++;

    moveHistory.push_back(undo);
    return true;
}

bool Game::unmakeMove() {
    if (moveHistory.empty()) return false;

    UndoInfo undo = moveHistory.back();
    moveHistory.pop_back();

    int from = undo.move.from();
    int to = undo.move.to();

    // Switch side back
    sideToMove = (sideToMove == WHITE) ? BLACK : WHITE;
    ply--;

    if (sideToMove == WHITE) {
        // Unmake pawn move
        pawns &= ~squareBB(to);
        pawns |= squareBB(from);

        if (undo.move.isCapture()) {
            // Restore queen
            queen = undo.capturedPiece;
        }
    } else {
        // Unmake queen move
        queen &= ~squareBB(to);
        queen |= squareBB(from);

        if (undo.move.isCapture()) {
            // Restore pawn
            pawns |= undo.capturedPiece;
        }
    }

    hash = undo.hash;
    return true;
}

GameResult Game::getResult() const {
    // Check if any pawn reached rank 8 (promotion)
    if (pawns & RANK_8) {
        return GameResult::WHITE_WINS_PROMOTION;
    }

    // Check if queen is captured
    if (queen == 0) {
        return GameResult::WHITE_WINS_CAPTURE;
    }

    // Check if all pawns are captured
    if (pawns == 0) {
        return GameResult::BLACK_WINS;
    }

    // Check for stalemate
    auto moves = generateLegalMoves();
    if (moves.empty()) {
        return GameResult::DRAW_STALEMATE;
    }

    return GameResult::ONGOING;
}

bool Game::isGameOver() const {
    return getResult() != GameResult::ONGOING;
}

int Game::getQueenSquare() const {
    if (queen == 0) return NO_SQUARE;
    return lsb(queen);
}

int Game::getPawnCount() const {
    return popCount(pawns);
}

std::string Game::moveToAlgebraic(Move move) const {
    static const char files[] = "abcdefgh";
    static const char ranks[] = "12345678";

    std::string result;
    result += files[fileOf(move.from())];
    result += ranks[rankOf(move.from())];
    result += files[fileOf(move.to())];
    result += ranks[rankOf(move.to())];

    return result;
}

Move Game::algebraicToMove(const std::string& str) const {
    if (str.length() < 4) return Move();

    int fromFile = str[0] - 'a';
    int fromRank = str[1] - '1';
    int toFile = str[2] - 'a';
    int toRank = str[3] - '1';

    if (fromFile < 0 || fromFile > 7 || fromRank < 0 || fromRank > 7 ||
        toFile < 0 || toFile > 7 || toRank < 0 || toRank > 7) {
        return Move();
    }

    int from = makeSquare(fromFile, fromRank);
    int to = makeSquare(toFile, toRank);

    // Determine flags
    int flags = QUIET;
    Bitboard toBB = squareBB(to);

    if (sideToMove == WHITE) {
        if (queen & toBB) flags = CAPTURE;
        else if (toRank - fromRank == 2) flags = DOUBLE_PUSH;
    } else {
        if (pawns & toBB) flags = CAPTURE;
    }

    return Move(from, to, flags);
}

std::string Game::toFen() const {
    std::string fen;

    // Board representation (rank 8 to rank 1)
    for (int rank = 7; rank >= 0; rank--) {
        int empty = 0;
        for (int file = 0; file < 8; file++) {
            int sq = makeSquare(file, rank);
            if (pawns & squareBB(sq)) {
                if (empty > 0) {
                    fen += std::to_string(empty);
                    empty = 0;
                }
                fen += 'P';
            } else if (queen & squareBB(sq)) {
                if (empty > 0) {
                    fen += std::to_string(empty);
                    empty = 0;
                }
                fen += 'q';
            } else {
                empty++;
            }
        }
        if (empty > 0) {
            fen += std::to_string(empty);
        }
        if (rank > 0) fen += '/';
    }

    // Side to move
    fen += (sideToMove == WHITE) ? " w" : " b";

    // No castling, no en passant, halfmove, fullmove
    fen += " - - 0 ";
    fen += std::to_string(ply / 2 + 1);

    return fen;
}

} // namespace PigsAndFarmers
