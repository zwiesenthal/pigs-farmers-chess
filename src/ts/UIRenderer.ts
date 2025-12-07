import { WorkerGameController } from './WorkerGameController';
import {
  BoardState,
  GameResult,
  Move,
  SearchInfo,
  fileOf,
  rankOf,
  makeSquare,
  squareToAlgebraic,
  FILES,
  RANKS
} from './types';

export class UIRenderer {
  private controller: WorkerGameController;
  private boardElement: HTMLElement;
  private evalBarElement: HTMLElement;
  private analysisPanel: HTMLElement;
  private moveListElement: HTMLElement;
  private statusElement: HTMLElement;

  private isFlipped = false;
  private selectedSquare: number | null = null;
  private legalMovesFromSelected: Move[] = [];
  private lastMove: Move | null = null;
  private bestMoveArrow: Move | null = null;
  private isDragging = false;
  private dragPiece: HTMLElement | null = null;
  private dragStartSquare: number | null = null;

  private isPlayingComputer = false;
  private computerSide: number = 1; // 1 = Black (Farmer)
  private isAnalyzing = false;
  private analysisDepth = 0;
  private analysisMaxDepth = 0;
  private memoryUpdateInterval: number | null = null;
  private analysisStartTime: number = 0;

  constructor(controller: WorkerGameController) {
    this.controller = controller;

    // Get DOM elements
    this.boardElement = document.getElementById('board')!;
    this.evalBarElement = document.getElementById('eval-bar')!;
    this.analysisPanel = document.getElementById('analysis-panel')!;
    this.moveListElement = document.getElementById('move-list')!;
    this.statusElement = document.getElementById('status')!;

    this.setupEventListeners();
    this.setupCallbacks();
  }

  private setupCallbacks(): void {
    this.controller.setStateChangeCallback((state) => {
      this.render(state);
      this.updateMoveList();

      // Auto-play computer if enabled
      if (this.isPlayingComputer && !this.controller.isGameOver()) {
        if (state.sideToMove === this.computerSide) {
          this.playComputerMove();
        }
      }
    });

    this.controller.setSearchCallback((info) => {
      this.updateAnalysisPanel(info);
    });
  }

  private setupEventListeners(): void {
    // Board click handling
    this.boardElement.addEventListener('mousedown', (e) => this.handleMouseDown(e));
    document.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    document.addEventListener('mouseup', (e) => this.handleMouseUp(e));

    // Touch support
    this.boardElement.addEventListener('touchstart', (e) => this.handleTouchStart(e));
    document.addEventListener('touchmove', (e) => this.handleTouchMove(e));
    document.addEventListener('touchend', (e) => this.handleTouchEnd(e));

    // Control buttons
    document.getElementById('btn-flip')?.addEventListener('click', () => this.flipBoard());
    document.getElementById('btn-undo')?.addEventListener('click', () => this.controller.undoMove());
    document.getElementById('btn-redo')?.addEventListener('click', () => this.controller.redoMove());
    document.getElementById('btn-reset')?.addEventListener('click', () => this.resetGame());
    document.getElementById('btn-analyze')?.addEventListener('click', () => this.analyze());
    document.getElementById('btn-play-computer')?.addEventListener('click', () => this.togglePlayComputer());
    document.getElementById('btn-first')?.addEventListener('click', () => this.controller.goToMove(-1));
    document.getElementById('btn-last')?.addEventListener('click', () =>
      this.controller.goToMove(this.controller.getMoveHistory().length - 1));

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') this.controller.undoMove();
      if (e.key === 'ArrowRight') this.controller.redoMove();
      if (e.key === 'f') this.flipBoard();
    });
  }

  private getSquareFromCoords(clientX: number, clientY: number): number | null {
    const rect = this.boardElement.getBoundingClientRect();
    const squareSize = rect.width / 8;

    let file = Math.floor((clientX - rect.left) / squareSize);
    let rank = 7 - Math.floor((clientY - rect.top) / squareSize);

    if (this.isFlipped) {
      file = 7 - file;
      rank = 7 - rank;
    }

    if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
    return makeSquare(file, rank);
  }

  private handleMouseDown(e: MouseEvent): void {
    const square = this.getSquareFromCoords(e.clientX, e.clientY);
    if (square === null) return;

    this.handleSquareClick(square, e.clientX, e.clientY);
  }

  private handleMouseMove(e: MouseEvent): void {
    if (!this.isDragging || !this.dragPiece) return;

    const rect = this.boardElement.getBoundingClientRect();
    const squareSize = rect.width / 8;

    this.dragPiece.style.left = `${e.clientX - rect.left - squareSize / 2}px`;
    this.dragPiece.style.top = `${e.clientY - rect.top - squareSize / 2}px`;
  }

  private handleMouseUp(e: MouseEvent): void {
    if (!this.isDragging) return;

    const square = this.getSquareFromCoords(e.clientX, e.clientY);
    this.finishDrag(square);
  }

  private handleTouchStart(e: TouchEvent): void {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    const square = this.getSquareFromCoords(touch.clientX, touch.clientY);
    if (square === null) return;

    e.preventDefault();
    this.handleSquareClick(square, touch.clientX, touch.clientY);
  }

  private handleTouchMove(e: TouchEvent): void {
    if (!this.isDragging || !this.dragPiece || e.touches.length !== 1) return;
    e.preventDefault();

    const touch = e.touches[0];
    const rect = this.boardElement.getBoundingClientRect();
    const squareSize = rect.width / 8;

    this.dragPiece.style.left = `${touch.clientX - rect.left - squareSize / 2}px`;
    this.dragPiece.style.top = `${touch.clientY - rect.top - squareSize / 2}px`;
  }

  private handleTouchEnd(e: TouchEvent): void {
    if (!this.isDragging) return;
    e.preventDefault();

    const touch = e.changedTouches[0];
    const square = this.getSquareFromCoords(touch.clientX, touch.clientY);
    this.finishDrag(square);
  }

  private async handleSquareClick(square: number, clientX: number, clientY: number): Promise<void> {
    const state = this.controller.getBoardStateSync();
    const hasPiece = state.pawns.includes(square) ||
                     (state.queen === square && state.queen !== -1);

    // Check if we can select this piece (it's our turn)
    const canSelect = (state.sideToMove === 0 && state.pawns.includes(square)) ||
                      (state.sideToMove === 1 && state.queen === square);

    if (this.selectedSquare !== null) {
      // Try to make a move
      const move = this.legalMovesFromSelected.find(m => m.to === square);
      if (move) {
        // Stop analysis if running
        if (this.isAnalyzing) {
          await this.controller.stopSearch();
          this.isAnalyzing = false;
          this.updateAnalyzeButton();
        }

        await this.controller.makeMove(move.from, move.to);
        this.lastMove = move;
        this.selectedSquare = null;
        this.legalMovesFromSelected = [];
        this.bestMoveArrow = null;
        this.render(this.controller.getBoardStateSync());
        return;
      }
    }

    // Select new piece
    if (canSelect) {
      this.selectedSquare = square;
      this.legalMovesFromSelected = await this.controller.getLegalMovesFrom(square);
      this.startDrag(square, clientX, clientY);
    } else {
      this.selectedSquare = null;
      this.legalMovesFromSelected = [];
    }

    this.render(state);
  }

  private startDrag(square: number, clientX: number, clientY: number): void {
    this.isDragging = true;
    this.dragStartSquare = square;

    const state = this.controller.getBoardStateSync();
    const isPawn = state.pawns.includes(square);

    // Create drag piece
    this.dragPiece = document.createElement('div');
    this.dragPiece.className = 'piece dragging';
    this.dragPiece.innerHTML = isPawn ? this.getPawnSVG() : this.getQueenSVG();

    const rect = this.boardElement.getBoundingClientRect();
    const squareSize = rect.width / 8;

    this.dragPiece.style.width = `${squareSize}px`;
    this.dragPiece.style.height = `${squareSize}px`;
    this.dragPiece.style.left = `${clientX - rect.left - squareSize / 2}px`;
    this.dragPiece.style.top = `${clientY - rect.top - squareSize / 2}px`;

    this.boardElement.appendChild(this.dragPiece);
  }

  private async finishDrag(targetSquare: number | null): Promise<void> {
    if (this.dragPiece) {
      this.dragPiece.remove();
      this.dragPiece = null;
    }

    if (targetSquare !== null && this.dragStartSquare !== null) {
      const move = this.legalMovesFromSelected.find(m =>
        m.from === this.dragStartSquare && m.to === targetSquare
      );

      if (move) {
        // Stop analysis if running
        if (this.isAnalyzing) {
          await this.controller.stopSearch();
          this.isAnalyzing = false;
          this.updateAnalyzeButton();
        }

        await this.controller.makeMove(move.from, move.to);
        this.lastMove = move;
        this.bestMoveArrow = null;
      }
    }

    this.isDragging = false;
    this.dragStartSquare = null;
    this.selectedSquare = null;
    this.legalMovesFromSelected = [];
    this.render(this.controller.getBoardStateSync());
  }

  flipBoard(): void {
    this.isFlipped = !this.isFlipped;
    this.render(this.controller.getBoardStateSync());
  }

  async resetGame(): Promise<void> {
    // Stop any ongoing analysis
    if (this.isAnalyzing) {
      await this.controller.stopSearch();
      this.isAnalyzing = false;
      this.updateAnalyzeButton();
    }

    await this.controller.resetGame();
    this.lastMove = null;
    this.bestMoveArrow = null;
    this.selectedSquare = null;
    this.legalMovesFromSelected = [];
    this.isPlayingComputer = false;
    this.updatePlayComputerButton();
    this.clearAnalysis();
    this.render(this.controller.getBoardStateSync());
  }

  async analyze(): Promise<void> {
    // Toggle analysis
    if (this.isAnalyzing) {
      // Stop analysis - this will terminate and reinitialize the worker
      this.setStatus('Stopping analysis...');
      await this.controller.stopSearch();
      this.isAnalyzing = false;
      this.updateAnalyzeButton();
      this.stopMemoryMonitoring();
      this.hideAnalysisSpinner();
      this.setStatus('Analysis stopped');
      return;
    }

    // Start analysis
    this.isAnalyzing = true;
    this.analysisDepth = 0;
    this.analysisMaxDepth = parseInt((document.getElementById('depth-input') as HTMLInputElement)?.value || '30');
    const timeMs = parseInt((document.getElementById('time-input') as HTMLInputElement)?.value || '60') * 1000;

    this.analysisStartTime = Date.now();
    this.updateAnalyzeButton();
    this.showAnalyzingState();
    this.setStatus('Analyzing...');
    this.startMemoryMonitoring();

    const result = await this.controller.search(this.analysisMaxDepth, timeMs, 3);

    this.isAnalyzing = false;
    this.updateAnalyzeButton();
    this.stopMemoryMonitoring();
    this.hideAnalysisSpinner();

    if (result && result.bestMove) {
      this.bestMoveArrow = result.bestMove;
      this.render(this.controller.getBoardStateSync());
      this.setStatus('Analysis complete');
    } else {
      this.setStatus('Analysis stopped');
    }
  }

  private updateAnalyzeButton(): void {
    const btn = document.getElementById('btn-analyze');
    if (btn) {
      btn.textContent = this.isAnalyzing ? 'Stop Analysis' : 'Analyze';
      btn.classList.toggle('active', this.isAnalyzing);
    }
  }

  private showAnalyzingState(): void {
    const memInfo = this.getMemoryInfo();
    const html = `
      <div class="analyzing-state">
        <div class="analysis-spinner"></div>
        <div class="analysis-status">
          <p>Starting analysis...</p>
          <p class="analysis-depth">Depth 0/${this.analysisMaxDepth}</p>
          ${memInfo ? `<p class="memory-info">${memInfo}</p>` : ''}
        </div>
      </div>
    `;
    this.analysisPanel.innerHTML = html;
  }

  private getMemoryInfo(): string | null {
    if ('memory' in performance && (performance as any).memory) {
      const mem = (performance as any).memory;
      const usedMB = (mem.usedJSHeapSize / 1048576).toFixed(1);
      const totalMB = (mem.jsHeapSizeLimit / 1048576).toFixed(0);
      return `Memory: ${usedMB}/${totalMB} MB`;
    }
    return null;
  }

  private startMemoryMonitoring(): void {
    this.updateMemoryDisplay();
    this.memoryUpdateInterval = window.setInterval(() => {
      this.updateMemoryDisplay();
    }, 1000);
  }

  private stopMemoryMonitoring(): void {
    if (this.memoryUpdateInterval !== null) {
      clearInterval(this.memoryUpdateInterval);
      this.memoryUpdateInterval = null;
    }
  }

  private updateMemoryDisplay(): void {
    const memInfo = this.getMemoryInfo();
    const memElement = this.analysisPanel.querySelector('.memory-info');
    if (memElement && memInfo) {
      memElement.textContent = memInfo;
    }

    // Update elapsed time
    const elapsed = Math.floor((Date.now() - this.analysisStartTime) / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

    const timeElement = this.analysisPanel.querySelector('.elapsed-time');
    if (timeElement) {
      timeElement.textContent = `Time: ${timeStr}`;
    }
  }

  togglePlayComputer(): void {
    this.isPlayingComputer = !this.isPlayingComputer;
    this.updatePlayComputerButton();

    if (this.isPlayingComputer) {
      const state = this.controller.getBoardStateSync();
      if (state.sideToMove === this.computerSide) {
        this.playComputerMove();
      }
    }
  }

  private updatePlayComputerButton(): void {
    const btn = document.getElementById('btn-play-computer');
    if (btn) {
      btn.textContent = this.isPlayingComputer ? 'Stop Computer' : 'Play vs Computer';
      btn.classList.toggle('active', this.isPlayingComputer);
    }
  }

  private async playComputerMove(): Promise<void> {
    if (!this.isPlayingComputer || this.controller.isGameOver()) return;

    // Don't interfere with manual analysis
    if (this.isAnalyzing) {
      setTimeout(() => this.playComputerMove(), 500);
      return;
    }

    this.setStatus('Computer thinking...');
    const result = await this.controller.search(15, 3000, 1);

    if (result && result.bestMove && this.isPlayingComputer) {
      this.controller.makeMove(result.bestMove.from, result.bestMove.to);
      this.lastMove = result.bestMove;
      this.bestMoveArrow = null;
    }

    this.setStatus('');
  }

  private setStatus(text: string): void {
    if (this.statusElement) {
      this.statusElement.textContent = text;
    }
  }

  private clearAnalysis(): void {
    this.analysisPanel.innerHTML = '';
    this.updateEvalBar(0);
  }

  private hideAnalysisSpinner(): void {
    const spinner = this.analysisPanel.querySelector('.analysis-spinner');
    if (spinner) {
      spinner.remove();
    }
  }

  private updateAnalysisPanel(info: SearchInfo): void {
    this.analysisDepth = info.depth;
    const scoreStr = this.controller.formatScore(info);
    const memInfo = this.getMemoryInfo();

    let html = '';

    // Show spinner if still analyzing
    if (this.isAnalyzing) {
      html += '<div class="analysis-spinner"></div>';
    }

    // Calculate elapsed time
    const elapsed = Math.floor((Date.now() - this.analysisStartTime) / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

    html += `
      <div class="analysis-header">
        <span class="eval-score">${scoreStr}</span>
        <span class="depth-info">Depth ${info.depth}/${this.isAnalyzing ? this.analysisMaxDepth : info.selDepth}</span>
        <span class="nps-info">${(info.nps / 1000).toFixed(0)}k n/s</span>
        ${memInfo ? `<span class="memory-info">${memInfo}</span>` : ''}
        <span class="elapsed-time">Time: ${timeStr}</span>
      </div>
    `;

    // Filter out invalid PV lines
    const validLines = (info.pvLines || []).filter(pv =>
      pv.moves && pv.moves.length > 0 &&
      pv.moves[0] && typeof pv.moves[0].from === 'number' &&
      pv.moves[0].from !== pv.moves[0].to  // Filter out invalid moves like a1a1
    );

    // Show best moves if available
    if (validLines.length > 0) {
      html += '<div class="pv-lines">';
      const state = this.controller.getBoardStateSync();

      const linesToShow = Math.min(3, validLines.length);
      for (let i = 0; i < linesToShow; i++) {
        const pv = validLines[i];
        const pvScoreStr = this.formatPVScore(pv.score, info);
        const pvMoves = this.controller.formatPVLine(pv.moves, state.ply);
        html += `
          <div class="pv-line ${i === 0 ? 'best' : ''}">
            <span class="pv-score">${pvScoreStr}</span>
            <span class="pv-moves">${pvMoves}</span>
          </div>
        `;
      }
      html += '</div>';
    } else if (this.isAnalyzing) {
      html += '<div class="pv-lines"><div class="pv-line"><span class="pv-moves">Calculating best moves...</span></div></div>';
    }

    this.analysisPanel.innerHTML = html;

    // Update eval bar
    this.updateEvalBar(info.score);

    // Update best move arrow - use the first valid move
    if (validLines.length > 0 && validLines[0].moves.length > 0) {
      const bestMove = validLines[0].moves[0];
      this.bestMoveArrow = bestMove;
      if (!this.isDragging) {
        this.render(this.controller.getBoardStateSync());
      }
    }
  }

  private formatPVScore(score: number, info: SearchInfo): string {
    if (Math.abs(score) > 90000) {
      const mateIn = score > 0
        ? Math.ceil((100000 - score) / 2)
        : -Math.ceil((100000 + score) / 2);
      return `M${mateIn > 0 ? '+' : ''}${mateIn}`;
    }
    const s = score / 100;
    return `${s >= 0 ? '+' : ''}${s.toFixed(2)}`;
  }

  private updateEvalBar(score: number): void {
    // Clamp score to reasonable range for display
    const clampedScore = Math.max(-1000, Math.min(1000, score));

    // Convert to percentage (0 = -10, 50 = 0, 100 = +10)
    let percentage = 50 + (clampedScore / 20);

    if (Math.abs(score) > 90000) {
      // Mate score
      percentage = score > 0 ? 95 : 5;
    }

    percentage = Math.max(5, Math.min(95, percentage));

    const whitePart = this.evalBarElement.querySelector('.eval-white') as HTMLElement;
    if (whitePart) {
      whitePart.style.height = `${percentage}%`;
    }

    // Update score display
    const scoreDisplay = this.evalBarElement.querySelector('.eval-score-display') as HTMLElement;
    if (scoreDisplay) {
      if (Math.abs(score) > 90000) {
        const mateIn = score > 0
          ? Math.ceil((100000 - score) / 2)
          : -Math.ceil((100000 + score) / 2);
        scoreDisplay.textContent = `M${mateIn}`;
      } else {
        const s = score / 100;
        scoreDisplay.textContent = `${s >= 0 ? '+' : ''}${s.toFixed(1)}`;
      }
    }
  }

  private updateMoveList(): void {
    const moves = this.controller.getMoveHistory();
    const currentIndex = this.controller.getCurrentMoveIndex();

    let html = '';
    for (let i = 0; i < moves.length; i += 2) {
      const moveNum = Math.floor(i / 2) + 1;
      const whiteMove = moves[i];
      const blackMove = moves[i + 1];

      html += `<div class="move-row">`;
      html += `<span class="move-number">${moveNum}.</span>`;
      html += `<span class="move ${i === currentIndex ? 'current' : ''}" data-index="${i}">${whiteMove}</span>`;
      if (blackMove) {
        html += `<span class="move ${i + 1 === currentIndex ? 'current' : ''}" data-index="${i + 1}">${blackMove}</span>`;
      }
      html += `</div>`;
    }

    this.moveListElement.innerHTML = html;

    // Add click handlers
    this.moveListElement.querySelectorAll('.move').forEach(el => {
      el.addEventListener('click', () => {
        const index = parseInt(el.getAttribute('data-index') || '-1');
        if (index >= 0) {
          this.controller.goToMove(index);
        }
      });
    });

    // Scroll to current move
    const currentMoveEl = this.moveListElement.querySelector('.move.current');
    if (currentMoveEl) {
      currentMoveEl.scrollIntoView({ block: 'nearest' });
    }
  }

  render(state: BoardState): void {
    this.boardElement.innerHTML = '';

    // Create squares and pieces
    for (let rank = 7; rank >= 0; rank--) {
      for (let file = 0; file < 8; file++) {
        const displayFile = this.isFlipped ? 7 - file : file;
        const displayRank = this.isFlipped ? 7 - rank : rank;
        const sq = makeSquare(file, rank);

        const squareEl = document.createElement('div');
        squareEl.className = `square ${this.controller.getSquareColor(file, rank)}`;
        squareEl.dataset.square = sq.toString();

        // Positioning
        squareEl.style.gridColumn = `${displayFile + 1}`;
        squareEl.style.gridRow = `${8 - displayRank}`;

        // Highlights
        if (this.selectedSquare === sq) {
          squareEl.classList.add('selected');
        }

        if (this.lastMove && (this.lastMove.from === sq || this.lastMove.to === sq)) {
          squareEl.classList.add('last-move');
        }

        if (this.legalMovesFromSelected.some(m => m.to === sq)) {
          squareEl.classList.add('legal-target');
          const dot = document.createElement('div');
          dot.className = 'legal-dot';
          if (state.pawns.includes(sq) || state.queen === sq) {
            dot.classList.add('capture');
          }
          squareEl.appendChild(dot);
        }

        // File/rank labels
        if (displayRank === 0) {
          const fileLabel = document.createElement('span');
          fileLabel.className = 'coord file-label';
          fileLabel.textContent = FILES[file];
          squareEl.appendChild(fileLabel);
        }

        if (displayFile === 0) {
          const rankLabel = document.createElement('span');
          rankLabel.className = 'coord rank-label';
          rankLabel.textContent = RANKS[rank];
          squareEl.appendChild(rankLabel);
        }

        // Add pieces
        if (state.pawns.includes(sq) && !(this.isDragging && this.dragStartSquare === sq)) {
          const piece = document.createElement('div');
          piece.className = 'piece pawn';
          piece.innerHTML = this.getPawnSVG();
          squareEl.appendChild(piece);
        }

        if (state.queen === sq && sq !== -1 && !(this.isDragging && this.dragStartSquare === sq)) {
          const piece = document.createElement('div');
          piece.className = 'piece queen';
          piece.innerHTML = this.getQueenSVG();
          squareEl.appendChild(piece);
        }

        this.boardElement.appendChild(squareEl);
      }
    }

    // Draw best move arrow
    if (this.bestMoveArrow) {
      this.drawArrow(this.bestMoveArrow.from, this.bestMoveArrow.to);
    }

    // Update status
    if (state.result !== GameResult.ONGOING) {
      this.setStatus(this.controller.getResultString());
    } else if (!this.isPlayingComputer) {
      this.setStatus(`${this.controller.getSideToMoveString()} to move`);
    }
  }

  private drawArrow(from: number, to: number): void {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('arrow-layer');
    svg.setAttribute('viewBox', '0 0 100 100');

    const fromFile = this.isFlipped ? 7 - fileOf(from) : fileOf(from);
    const fromRank = this.isFlipped ? rankOf(from) : 7 - rankOf(from);
    const toFile = this.isFlipped ? 7 - fileOf(to) : fileOf(to);
    const toRank = this.isFlipped ? rankOf(to) : 7 - rankOf(to);

    const x1 = fromFile * 12.5 + 6.25;
    const y1 = fromRank * 12.5 + 6.25;
    const x2 = toFile * 12.5 + 6.25;
    const y2 = toRank * 12.5 + 6.25;

    // Arrow line
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x1.toString());
    line.setAttribute('y1', y1.toString());
    line.setAttribute('x2', x2.toString());
    line.setAttribute('y2', y2.toString());
    line.setAttribute('stroke', '#15781B');
    line.setAttribute('stroke-width', '2.5');
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('marker-end', 'url(#arrowhead)');
    line.setAttribute('opacity', '0.8');

    // Arrow head marker
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    marker.setAttribute('id', 'arrowhead');
    marker.setAttribute('markerWidth', '4');
    marker.setAttribute('markerHeight', '4');
    marker.setAttribute('refX', '3');
    marker.setAttribute('refY', '2');
    marker.setAttribute('orient', 'auto');

    const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    polygon.setAttribute('points', '0 0, 4 2, 0 4');
    polygon.setAttribute('fill', '#15781B');

    marker.appendChild(polygon);
    defs.appendChild(marker);
    svg.appendChild(defs);
    svg.appendChild(line);

    this.boardElement.appendChild(svg);
  }

  private getPawnSVG(): string {
    return `<svg viewBox="0 0 45 45" class="piece-svg">
      <path d="M22.5 9c-2.21 0-4 1.79-4 4 0 .89.29 1.71.78 2.38C17.33 16.5 16 18.59 16 21c0 2.03.94 3.84 2.41 5.03-3 1.06-7.41 5.55-7.41 13.47h23c0-7.92-4.41-12.41-7.41-13.47 1.47-1.19 2.41-3 2.41-5.03 0-2.41-1.33-4.5-3.28-5.62.49-.67.78-1.49.78-2.38 0-2.21-1.79-4-4-4z"
        fill="#fff" stroke="#000" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`;
  }

  private getQueenSVG(): string {
    return `<svg viewBox="0 0 45 45" class="piece-svg">
      <g fill="#000" fill-rule="evenodd" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="6" cy="12" r="2.75"/>
        <circle cx="14" cy="9" r="2.75"/>
        <circle cx="22.5" cy="8" r="2.75"/>
        <circle cx="31" cy="9" r="2.75"/>
        <circle cx="39" cy="12" r="2.75"/>
        <path d="M9 26c8.5-1.5 21-1.5 27 0l2.5-12.5L31 25l-.3-14.1-5.2 13.6-3-14.5-3 14.5-5.2-13.6L14 25 6.5 13.5 9 26z"
          stroke-linecap="butt"/>
        <path d="M9 26c0 2 1.5 2 2.5 4 1 1.5 1 1 .5 3.5-1.5 1-1.5 2.5-1.5 2.5-1.5 1.5.5 2.5.5 2.5 6.5 1 16.5 1 23 0 0 0 1.5-1 0-2.5 0 0 .5-1.5-1-2.5-.5-2.5-.5-2 .5-3.5 1-2 2.5-2 2.5-4-8.5-1.5-18.5-1.5-27 0z"
          stroke-linecap="butt"/>
        <path d="M11 38.5a35 35 1 0 0 23 0" fill="none" stroke-linecap="butt"/>
        <path d="M11 29a35 35 1 0 1 23 0" fill="none" stroke="#ececec"/>
        <path d="M12.5 31.5h20" fill="none" stroke="#ececec"/>
        <path d="M11.5 34.5a35 35 1 0 0 22 0" fill="none" stroke="#ececec"/>
        <path d="M10.5 37.5a35 35 1 0 0 24 0" fill="none" stroke="#ececec"/>
      </g>
    </svg>`;
  }
}
