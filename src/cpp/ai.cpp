#include "ai.h"
#include <algorithm>
#include <cstring>

namespace PigsAndFarmers {

AI::AI() : transTable(TT_SIZE), ttAge(0) {
    shouldStop = false;
    searching = false;
    clearKillers();
    clearHash();
}

AI::~AI() {
    shouldStop = true;
}

void AI::clearHash() {
    std::fill(transTable.begin(), transTable.end(), TTEntry{});
    ttAge = 0;
}

void AI::clearKillers() {
    for (auto& k : killers) {
        k[0] = Move();
        k[1] = Move();
    }
    for (auto& row : history) {
        std::fill(row.begin(), row.end(), 0);
    }
}

int AI::evaluate(const Game& game) const {
    // Get basic state
    int pawnCount = game.getPawnCount();
    int queenSq = game.getQueenSquare();

    // Terminal states
    GameResult result = game.getResult();
    if (result == GameResult::WHITE_WINS_PROMOTION ||
        result == GameResult::WHITE_WINS_CAPTURE) {
        return MATE_SCORE - 100;  // White wins
    }
    if (result == GameResult::BLACK_WINS) {
        return -MATE_SCORE + 100;  // Black wins
    }
    if (result == GameResult::DRAW_STALEMATE) {
        return 0;
    }

    int score = 0;

    // Material
    score += pawnCount * PAWN_VALUE;
    if (queenSq != NO_SQUARE) {
        score -= QUEEN_VALUE;
    }

    // Pawn advancement bonus (crucial for this game)
    // First, calculate queen attacks to know which pawns are under threat
    Bitboard queenAttacksBB = 0;
    if (queenSq != NO_SQUARE) {
        Bitboard occupied = game.getPawns() | game.getQueen();
        queenAttacksBB = Game::queenAttacks(queenSq, occupied);
    }

    Bitboard pawns = game.getPawns();
    while (pawns) {
        int sq = Game::lsb(pawns);
        pawns &= pawns - 1;

        int rank = rankOf(sq);
        bool canBeCaptured = (queenAttacksBB & squareBB(sq)) != 0;
        bool isQueenTurn = (game.getSideToMove() == BLACK);

        // Exponential bonus for advancement
        // Rank 2=0, 3=5, 4=15, 5=35, 6=75, 7=155
        int advBonus = (1 << (rank - 1)) * 5;

        // Extra bonus for pawns close to promotion
        int promoBonus = 0;
        if (rank >= 5) {
            promoBonus += (rank - 4) * 50;
        }
        if (rank == 7) {
            promoBonus += 200;  // One move from promotion!
        }

        // If pawn can be captured and it's queen's turn, significantly reduce bonus
        // because the queen will likely capture it
        if (canBeCaptured && isQueenTurn) {
            // Pawn is in danger - reduce advancement bonus significantly
            advBonus /= 4;
            promoBonus /= 4;
        } else if (canBeCaptured) {
            // White to move - pawn might escape or promote
            // Still give some penalty for being attacked
            advBonus = advBonus * 3 / 4;
            promoBonus = promoBonus * 3 / 4;
        }

        score += advBonus + promoBonus;
    }

    // Queen positioning (for Black)
    if (queenSq != NO_SQUARE) {
        int qRank = rankOf(queenSq);
        int qFile = fileOf(queenSq);

        // Queen wants to be active and central
        // Slightly prefer being in front of pawns
        int centralityBonus = 4 - std::abs(qFile - 3);  // Center files better
        score -= centralityBonus * 5;

        // Queen prefers lower ranks to block pawns
        score -= (8 - qRank) * 3;

        // Mobility bonus for queen
        Bitboard occupied = game.getPawns() | game.getQueen();
        Bitboard queenMoves = Game::queenAttacks(queenSq, occupied);
        int mobility = Game::popCount(queenMoves & ~game.getQueen());
        score -= mobility * 2;

        // Count pawns queen can attack
        int attackablePawns = Game::popCount(queenMoves & game.getPawns());
        score -= attackablePawns * 10;
    }

    // Pawn structure
    // Connected pawns are stronger
    Bitboard pawnsBB = game.getPawns();
    Bitboard pawnsCopy = pawnsBB;
    while (pawnsCopy) {
        int sq = Game::lsb(pawnsCopy);
        pawnsCopy &= pawnsCopy - 1;

        int file = fileOf(sq);
        int rank = rankOf(sq);

        // Check for adjacent pawns (protection)
        if (file > 0 && (pawnsBB & squareBB(sq - 1))) score += 5;
        if (file < 7 && (pawnsBB & squareBB(sq + 1))) score += 5;

        // Passed pawn detection (no queen in front)
        if (queenSq != NO_SQUARE) {
            int qFile = fileOf(queenSq);
            int qRank = rankOf(queenSq);

            // If queen is on same file ahead, pawn is blocked
            if (qFile == file && qRank > rank) {
                score -= 20;
            }
        }
    }

    // Side to move bonus
    if (game.getSideToMove() == WHITE) {
        score += 10;  // Tempo
    } else {
        score -= 10;
    }

    return score;
}

void AI::storeTT(uint64_t hash, int score, int depth, TTFlag flag, Move bestMove) {
    size_t index = hash % TT_SIZE;
    TTEntry& entry = transTable[index];

    // Replace if: same position, deeper, or old entry
    if (entry.hash != hash || depth >= entry.depth || entry.age != ttAge) {
        entry.hash = hash;
        entry.score = static_cast<int16_t>(score);
        entry.depth = static_cast<int8_t>(depth);
        entry.flag = flag;
        entry.bestMove = bestMove;
        entry.age = ttAge;
    }
}

TTEntry* AI::probeTT(uint64_t hash) {
    size_t index = hash % TT_SIZE;
    TTEntry& entry = transTable[index];

    // Only use entries from current or recent searches
    // Old entries might have incorrect scores due to different game states
    if (entry.hash == hash && (entry.age == ttAge || entry.age == ttAge - 1)) {
        ttHits++;
        return &entry;
    }
    return nullptr;
}

int AI::scoreMove(Move move, const Game& game, Move ttMove, int ply) const {
    // TT move gets highest priority
    if (move == ttMove) {
        return 1000000;
    }

    int score = 0;

    // Captures: MVV-LVA (Most Valuable Victim - Least Valuable Aggressor)
    if (move.isCapture()) {
        // In this game: pawn can capture queen (huge), queen captures pawn
        if (game.getSideToMove() == WHITE) {
            // Pawn capturing queen
            score = 900000;  // Queen value
        } else {
            // Queen capturing pawn
            score = 100000;  // Pawn value
        }
    }

    // Killer moves
    if (ply < 128) {
        if (move == killers[ply][0]) score += 90000;
        else if (move == killers[ply][1]) score += 80000;
    }

    // History heuristic
    score += history[move.from()][move.to()];

    // Promotion moves (reaching rank 8)
    if (game.getSideToMove() == WHITE && move.to() >= A8) {
        score += 500000;
    }

    // Pawn advancement
    if (game.getSideToMove() == WHITE) {
        score += rankOf(move.to()) * 100;
    }

    return score;
}

void AI::orderMoves(std::vector<Move>& moves, const Game& game, Move ttMove, int ply) const {
    std::vector<std::pair<int, Move>> scored;
    scored.reserve(moves.size());

    for (const Move& m : moves) {
        scored.push_back({scoreMove(m, game, ttMove, ply), m});
    }

    std::sort(scored.begin(), scored.end(),
              [](const auto& a, const auto& b) { return a.first > b.first; });

    for (size_t i = 0; i < moves.size(); i++) {
        moves[i] = scored[i].second;
    }
}

bool AI::checkTime() {
    if (timeLimitMs <= 0) return false;

    auto now = std::chrono::steady_clock::now();
    auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(now - startTime).count();
    return elapsed >= timeLimitMs;
}

int AI::adjustMateScore(int score, int ply) const {
    if (score > MATE_SCORE - 1000) {
        return score - ply;
    }
    if (score < -MATE_SCORE + 1000) {
        return score + ply;
    }
    return score;
}

int AI::quiescence(Game& game, int alpha, int beta, int ply) {
    if (shouldStop) return 0;

    nodes++;

    // Check for terminal state
    GameResult result = game.getResult();
    if (result != GameResult::ONGOING) {
        if (result == GameResult::DRAW_STALEMATE) {
            return 0;  // Stalemate
        }
        // Game is over - the opponent just made a winning move
        // In negamax, we return score from side-to-move's perspective
        // Since the game ended, the side to move has lost
        return -MATE_SCORE + ply;
    }

    // Stand pat
    int standPat = evaluate(game);
    if (game.getSideToMove() == BLACK) {
        standPat = -standPat;
    }

    if (standPat >= beta) {
        return beta;
    }
    if (standPat > alpha) {
        alpha = standPat;
    }

    // Generate and search only captures
    auto moves = game.generateLegalMoves();
    std::vector<Move> captures;

    for (const Move& m : moves) {
        if (m.isCapture()) {
            captures.push_back(m);
        }
        // Also consider promotion moves as "captures" (tactically critical)
        else if (game.getSideToMove() == WHITE && m.to() >= A8) {
            captures.push_back(m);
        }
    }

    if (captures.empty()) {
        return standPat;
    }

    // Order captures
    orderMoves(captures, game, Move(), ply);

    for (const Move& move : captures) {
        game.makeMove(move);
        int score = -quiescence(game, -beta, -alpha, ply + 1);
        game.unmakeMove();

        if (shouldStop) return 0;

        if (score >= beta) {
            return beta;
        }
        if (score > alpha) {
            alpha = score;
        }
    }

    return alpha;
}

int AI::alphaBeta(Game& game, int depth, int alpha, int beta, int ply, PVLine& pv) {
    pv.clear();

    if (shouldStop || checkTime()) {
        shouldStop = true;
        return 0;
    }

    nodes++;

    // Update selective depth
    if (ply > selDepth) {
        selDepth = ply;
    }

    // Check for terminal state
    GameResult result = game.getResult();
    if (result != GameResult::ONGOING) {
        if (result == GameResult::DRAW_STALEMATE) {
            return 0;  // Stalemate
        }
        // Game is over - the opponent just made a winning move
        // In negamax, we return score from side-to-move's perspective
        // Since the game ended, the side to move has lost
        return -MATE_SCORE + ply;
    }

    // Probe transposition table
    uint64_t hash = game.getHash();
    Move ttMove;
    TTEntry* ttEntry = probeTT(hash);

    if (ttEntry && ttEntry->isValid(hash, depth)) {
        int ttScore = ttEntry->score;
        // Adjust mate scores
        if (ttScore > MATE_SCORE - 1000) ttScore -= ply;
        if (ttScore < -MATE_SCORE + 1000) ttScore += ply;

        if (ttEntry->flag == TT_EXACT) {
            pv.moves.push_back(ttEntry->bestMove);
            pv.score = ttScore;
            return ttScore;
        }
        if (ttEntry->flag == TT_BETA && ttScore >= beta) {
            return ttScore;
        }
        if (ttEntry->flag == TT_ALPHA && ttScore <= alpha) {
            return ttScore;
        }
    }
    if (ttEntry) {
        ttMove = ttEntry->bestMove;
    }

    // Leaf node - go to quiescence
    if (depth <= 0) {
        return quiescence(game, alpha, beta, ply);
    }

    // Generate moves
    auto moves = game.generateLegalMoves();
    if (moves.empty()) {
        return 0;  // Stalemate (shouldn't happen if game not over)
    }

    // Order moves
    orderMoves(moves, game, ttMove, ply);

    Move bestMove;
    int bestScore = -INFINITY_SCORE;
    TTFlag ttFlag = TT_ALPHA;
    PVLine childPV;

    for (size_t i = 0; i < moves.size(); i++) {
        const Move& move = moves[i];

        // Check time/stop more frequently
        if (shouldStop || (i % 4 == 0 && checkTime())) {
            shouldStop = true;
            return 0;
        }

        game.makeMove(move);
        int score = -alphaBeta(game, depth - 1, -beta, -alpha, ply + 1, childPV);
        game.unmakeMove();

        if (shouldStop) return 0;

        if (score > bestScore) {
            bestScore = score;
            bestMove = move;

            if (score > alpha) {
                alpha = score;
                ttFlag = TT_EXACT;

                // Update PV
                pv.moves.clear();
                pv.moves.push_back(move);
                for (const Move& m : childPV.moves) {
                    pv.moves.push_back(m);
                }
                pv.score = score;

                if (score >= beta) {
                    ttFlag = TT_BETA;

                    // Update killer moves
                    if (!move.isCapture() && ply < 128) {
                        if (killers[ply][0] != move) {
                            killers[ply][1] = killers[ply][0];
                            killers[ply][0] = move;
                        }
                    }

                    // Update history
                    if (!move.isCapture()) {
                        history[move.from()][move.to()] += depth * depth;
                    }

                    break;  // Beta cutoff
                }
            }
        }
    }

    // Store in TT
    int storeScore = bestScore;
    if (storeScore > MATE_SCORE - 1000) storeScore += ply;
    if (storeScore < -MATE_SCORE + 1000) storeScore -= ply;
    storeTT(hash, storeScore, depth, ttFlag, bestMove);

    return bestScore;
}

SearchInfo AI::search(Game& game) {
    searching = true;
    shouldStop = false;
    nodes = 0;
    ttHits = 0;
    selDepth = 0;
    ttAge++;

    startTime = std::chrono::steady_clock::now();

    SearchInfo info;
    info.depth = 0;
    info.selDepth = 0;
    info.score = 0;
    info.nodes = 0;
    info.nps = 0;
    info.timeMs = 0;
    info.pvLines.clear();

    auto rootMoves = game.generateLegalMoves();
    if (rootMoves.empty()) {
        searching = false;
        return info;
    }

    // Initialize PV lines for MultiPV
    std::vector<PVLine> pvLines(std::min(multiPV, (int)rootMoves.size()));

    // Iterative deepening
    for (int depth = 1; depth <= maxDepth && !shouldStop; depth++) {
        selDepth = 0;

        // For MultiPV, we need to search each root move separately
        std::vector<std::pair<int, Move>> rootScores;

        // First pass: get scores for all root moves
        PVLine tempPV;
        int alpha = -INFINITY_SCORE;
        int beta = INFINITY_SCORE;

        // Order root moves based on previous iteration
        orderMoves(rootMoves, game, (pvLines[0].moves.empty() ? Move() : pvLines[0].moves[0]), 0);

        for (size_t i = 0; i < rootMoves.size() && !shouldStop; i++) {
            const Move& move = rootMoves[i];

            game.makeMove(move);
            int score = -alphaBeta(game, depth - 1, -beta, -alpha, 1, tempPV);
            game.unmakeMove();

            if (!shouldStop) {
                rootScores.push_back({score, move});

                if (score > alpha) {
                    alpha = score;
                    bestMoveFound = move;
                }
            }
        }

        if (shouldStop && depth > 1) {
            break;
        }

        // Sort root moves by score
        std::sort(rootScores.begin(), rootScores.end(),
                  [](const auto& a, const auto& b) { return a.first > b.first; });

        // Build MultiPV lines
        pvLines.clear();
        for (size_t i = 0; i < std::min((size_t)multiPV, rootScores.size()); i++) {
            Move rootMove = rootScores[i].second;

            // Skip invalid moves
            if (!rootMove.isValid()) {
                continue;
            }

            PVLine line;
            line.score = rootScores[i].first;
            line.depth = depth;
            line.moves.push_back(rootMove);

            // Get continuation from TT
            Game tempGame = game;
            if (!tempGame.makeMove(rootMove)) {
                continue;  // Skip if move fails
            }

            // Follow TT to build PV
            for (int j = 0; j < depth - 1 && !tempGame.isGameOver(); j++) {
                TTEntry* entry = probeTT(tempGame.getHash());
                if (entry && entry->bestMove.isValid()) {
                    if (tempGame.isLegalMove(entry->bestMove)) {
                        line.moves.push_back(entry->bestMove);
                        tempGame.makeMove(entry->bestMove);
                    } else {
                        break;
                    }
                } else {
                    break;
                }
            }

            pvLines.push_back(line);
        }

        // Skip update if we have no results
        if (pvLines.empty() || pvLines[0].moves.empty()) {
            continue;
        }

        // Update info
        auto now = std::chrono::steady_clock::now();
        auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(now - startTime).count();

        info.depth = depth;
        info.selDepth = selDepth;
        info.score = game.getSideToMove() == WHITE ? pvLines[0].score : -pvLines[0].score;
        info.nodes = nodes;
        info.timeMs = elapsed;
        info.nps = elapsed > 0 ? (nodes * 1000) / elapsed : nodes;
        info.pvLines = pvLines;

        // Adjust scores for display (from White's perspective)
        for (auto& pv : info.pvLines) {
            if (game.getSideToMove() == BLACK) {
                pv.score = -pv.score;
            }
        }

        bestMoveFound = pvLines[0].moves.empty() ? rootMoves[0] : pvLines[0].moves[0];

        // Call callback
        if (callback) {
            callback(info);
        }

        // Check for forced mate found
        if (info.score > MATE_SCORE - 1000 || info.score < -MATE_SCORE + 1000) {
            // We found a mate, could stop early but continue for better accuracy
            if (depth >= 10 && info.isMate()) {
                // Found mate and searched deep enough
                break;
            }
        }
    }

    searching = false;
    return info;
}

} // namespace PigsAndFarmers
