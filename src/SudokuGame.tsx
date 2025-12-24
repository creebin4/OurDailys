import { useCallback, useEffect, useRef, useState } from "react";
import { fetchSudokuPuzzle } from "./sudokuApi";

// Types
type InputMode = "value" | "possible" | "pointing";

interface Cell {
  value: number | null;
  isGiven: boolean;
  possibleNotes: Set<number>;
  pointingNotes: Set<number>;
}

type Board = Cell[][];

interface SudokuGameProps {
  onModeSwitch: () => void;
}

// Sample puzzle (0 = empty)
const SAMPLE_PUZZLE = [
  [5, 3, 0, 0, 7, 0, 0, 0, 0],
  [6, 0, 0, 1, 9, 5, 0, 0, 0],
  [0, 9, 8, 0, 0, 0, 0, 6, 0],
  [8, 0, 0, 0, 6, 0, 0, 0, 3],
  [4, 0, 0, 8, 0, 3, 0, 0, 1],
  [7, 0, 0, 0, 2, 0, 0, 0, 6],
  [0, 6, 0, 0, 0, 0, 2, 8, 0],
  [0, 0, 0, 4, 1, 9, 0, 0, 5],
  [0, 0, 0, 0, 8, 0, 0, 7, 9],
];

const computePuzzleKey = (grid: number[][]): string =>
  grid.map((row) => row.join(""))
    .join("|");

const createBoard = (puzzle: number[][]): Board => {
  return puzzle.map((row) =>
    row.map((val) => ({
      value: val === 0 ? null : val,
      isGiven: val !== 0,
      possibleNotes: new Set<number>(),
      pointingNotes: new Set<number>(),
    }))
  );
};

// Format time as MM:SS
const formatTime = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
};

// Parse cell key to row/col
const parseKey = (key: string): { row: number; col: number } => {
  const [row, col] = key.split("-").map(Number);
  return { row, col };
};

// Mode cycle order
const MODE_ORDER: InputMode[] = ["value", "possible", "pointing"];

const SYNC_INTERVAL_MS = 12 * 60 * 60 * 1000;

export default function SudokuGame({ onModeSwitch }: SudokuGameProps) {
  const [board, setBoard] = useState<Board>(() => createBoard(SAMPLE_PUZZLE));
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set());
  const [selectedNumber, setSelectedNumber] = useState<number | null>(null);
  const [inputMode, setInputMode] = useState<InputMode>("value");
  const [isDragging, setIsDragging] = useState(false);
  const [puzzleInfo, setPuzzleInfo] = useState<{ displayDate: string; difficulty: string } | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [solutionGrid, setSolutionGrid] = useState<number[][] | null>(null);
  const [isCompleted, setIsCompleted] = useState(false);

  // Timer state
  const [elapsedTime, setElapsedTime] = useState(0);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const syncInFlightRef = useRef(false);
  const puzzleKeyRef = useRef<string | null>(null);

  // Timer effect
  useEffect(() => {
    if (isTimerRunning) {
      timerRef.current = setInterval(() => {
        setElapsedTime((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [isTimerRunning]);

  // Global mouseup to end dragging
  useEffect(() => {
    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, []);

  const toggleTimer = () => {
    if (isCompleted) return;
    setIsTimerRunning((prev) => !prev);
  };

  const syncSudoku = useCallback(async () => {
    if (syncInFlightRef.current) return;
    syncInFlightRef.current = true;
    setIsSyncing(true);
    setSyncError(null);

    try {
      const data = await fetchSudokuPuzzle();
      const nextPuzzleKey = computePuzzleKey(data.puzzle);
      const isNewPuzzle = puzzleKeyRef.current !== nextPuzzleKey;

      setPuzzleInfo({
        displayDate: data.displayDate || data.printDate,
        difficulty: data.difficulty,
      });
      setSolutionGrid(data.solution);
      puzzleKeyRef.current = nextPuzzleKey;

      if (isNewPuzzle) {
        setBoard(createBoard(data.puzzle));
        setSelectedCells(new Set());
        setSelectedNumber(null);
        setIsTimerRunning(false);
        setElapsedTime(0);
        setIsCompleted(false);
      }

      const now = new Date();
      setLastSyncTime(
        now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "string"
          ? error
          : "Failed to sync Sudoku puzzle.";
      setSyncError(message);
      console.error("Sudoku sync failed:", error);
    } finally {
      syncInFlightRef.current = false;
      setIsSyncing(false);
    }
  }, []);

  useEffect(() => {
    void syncSudoku();
    const interval = setInterval(() => {
      void syncSudoku();
    }, SYNC_INTERVAL_MS);

    return () => {
      clearInterval(interval);
    };
  }, [syncSudoku]);

  const handleRetrySync = useCallback(() => {
    void syncSudoku();
  }, [syncSudoku]);

  // Cycle input mode
  const cycleInputMode = useCallback(() => {
    setInputMode((prev) => {
      const currentIndex = MODE_ORDER.indexOf(prev);
      return MODE_ORDER[(currentIndex + 1) % MODE_ORDER.length];
    });
  }, []);

  // Get all invalid cells (cells with conflicts)
  const getInvalidCells = useCallback((): Set<string> => {
    const invalidCells = new Set<string>();

    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 9; col++) {
        const value = board[row][col].value;
        if (value === null) continue;

        // Check row for duplicates
        for (let c = 0; c < 9; c++) {
          if (c !== col && board[row][c].value === value) {
            invalidCells.add(`${row}-${col}`);
            invalidCells.add(`${row}-${c}`);
          }
        }

        // Check column for duplicates
        for (let r = 0; r < 9; r++) {
          if (r !== row && board[r][col].value === value) {
            invalidCells.add(`${row}-${col}`);
            invalidCells.add(`${r}-${col}`);
          }
        }

        // Check box for duplicates
        const boxStartRow = Math.floor(row / 3) * 3;
        const boxStartCol = Math.floor(col / 3) * 3;
        for (let r = boxStartRow; r < boxStartRow + 3; r++) {
          for (let c = boxStartCol; c < boxStartCol + 3; c++) {
            if ((r !== row || c !== col) && board[r][c].value === value) {
              invalidCells.add(`${row}-${col}`);
              invalidCells.add(`${r}-${c}`);
            }
          }
        }
      }
    }

    return invalidCells;
  }, [board]);

  const invalidCells = getInvalidCells();

  useEffect(() => {
    if (!solutionGrid || isCompleted) {
      return;
    }

    const solved = board.every((row, rowIndex) =>
      row.every((cell, colIndex) => cell.value !== null && cell.value === solutionGrid[rowIndex][colIndex])
    );

    if (solved) {
      setIsCompleted(true);
      setIsTimerRunning(false);
    }
  }, [board, solutionGrid, isCompleted]);

  // Get the "primary" selected cell (first one, for highlighting row/col/box)
  const primaryCell = selectedCells.size > 0 ? parseKey([...selectedCells][0]) : null;

  // Get all cells that should be highlighted
  const getHighlightInfo = useCallback(() => {
    const highlightedCells = new Set<string>();
    const sameNumberCells = new Set<string>();

    if (primaryCell) {
      const { row, col } = primaryCell;
      const boxStartRow = Math.floor(row / 3) * 3;
      const boxStartCol = Math.floor(col / 3) * 3;

      // Highlight row
      for (let c = 0; c < 9; c++) {
        highlightedCells.add(`${row}-${c}`);
      }
      // Highlight column
      for (let r = 0; r < 9; r++) {
        highlightedCells.add(`${r}-${col}`);
      }
      // Highlight 3x3 box
      for (let r = boxStartRow; r < boxStartRow + 3; r++) {
        for (let c = boxStartCol; c < boxStartCol + 3; c++) {
          highlightedCells.add(`${r}-${c}`);
        }
      }

      // Highlight same number
      const cellValue = board[row][col].value;
      if (cellValue !== null) {
        for (let r = 0; r < 9; r++) {
          for (let c = 0; c < 9; c++) {
            if (board[r][c].value === cellValue) {
              sameNumberCells.add(`${r}-${c}`);
            }
          }
        }
      }
    }

    // Also highlight by selected number from numpad
    if (selectedNumber !== null) {
      for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
          if (board[r][c].value === selectedNumber) {
            sameNumberCells.add(`${r}-${c}`);
          }
        }
      }
    }

    return { highlightedCells, sameNumberCells };
  }, [primaryCell, selectedNumber, board]);

  const { highlightedCells, sameNumberCells } = getHighlightInfo();

  // Handle cell input for all selected cells
  const handleCellInput = useCallback(
    (num: number) => {
      if (selectedCells.size === 0) return;

      // If multiple cells selected and in value mode, treat as possible note mode
      const effectiveMode = (selectedCells.size > 1 && inputMode === "value") 
        ? "possible" 
        : inputMode;

      setBoard((prev) => {
        const newBoard = prev.map((r) =>
          r.map((cell) => ({
            ...cell,
            possibleNotes: new Set(cell.possibleNotes),
            pointingNotes: new Set(cell.pointingNotes),
          }))
        );

        selectedCells.forEach((key) => {
          const { row, col } = parseKey(key);
          if (newBoard[row][col].isGiven) return;

          const cell = newBoard[row][col];

          if (effectiveMode === "value") {
            // Setting a value - preserve notes (they'll show again if value is deleted)
            const wasNull = cell.value === null;
            cell.value = cell.value === num ? null : num;
            // Don't clear notes - preserve them for when value is removed
            
            // If we just placed a value, remove pointing notes of that number from row/col/box
            if (wasNull && cell.value !== null) {
              const placedNum = cell.value;
              const boxStartRow = Math.floor(row / 3) * 3;
              const boxStartCol = Math.floor(col / 3) * 3;
              
              // Remove from same row
              for (let c = 0; c < 9; c++) {
                if (c !== col) {
                  newBoard[row][c].pointingNotes.delete(placedNum);
                }
              }
              
              // Remove from same column
              for (let r = 0; r < 9; r++) {
                if (r !== row) {
                  newBoard[r][col].pointingNotes.delete(placedNum);
                }
              }
              
              // Remove from same 3x3 box
              for (let r = boxStartRow; r < boxStartRow + 3; r++) {
                for (let c = boxStartCol; c < boxStartCol + 3; c++) {
                  if (r !== row || c !== col) {
                    newBoard[r][c].pointingNotes.delete(placedNum);
                  }
                }
              }
            }
          } else if (effectiveMode === "possible") {
            // Toggle possible note - converts from pointing if it exists there
            if (cell.value === null) {
              if (cell.possibleNotes.has(num)) {
                // Already a possible note, remove it
                cell.possibleNotes.delete(num);
              } else {
                // Add as possible note, remove from pointing if present
                cell.possibleNotes.add(num);
                cell.pointingNotes.delete(num);
              }
            }
          } else if (effectiveMode === "pointing") {
            // Toggle pointing note - converts from possible if it exists there
            if (cell.value === null) {
              if (cell.pointingNotes.has(num)) {
                // Already a pointing note, remove it
                cell.pointingNotes.delete(num);
              } else {
                // Add as pointing note, remove from possible if present
                cell.pointingNotes.add(num);
                cell.possibleNotes.delete(num);
              }
            }
          }
        });

        return newBoard;
      });
    },
    [selectedCells, inputMode]
  );

  // Handle number pad click
  const handleNumberClick = (num: number) => {
    setSelectedNumber(num === selectedNumber ? null : num);
    if (selectedCells.size > 0) {
      handleCellInput(num);
    }
  };

  // Mouse handlers for drag selection
  const handleMouseDown = (row: number, col: number, e: React.MouseEvent) => {
    e.preventDefault();
    const key = `${row}-${col}`;
    
    if (e.shiftKey && selectedCells.size > 0) {
      // Shift+click: extend selection
      const newSelection = new Set(selectedCells);
      newSelection.add(key);
      setSelectedCells(newSelection);
    } else if (e.ctrlKey || e.metaKey) {
      // Ctrl/Cmd+click: toggle cell in selection
      const newSelection = new Set(selectedCells);
      if (newSelection.has(key)) {
        newSelection.delete(key);
      } else {
        newSelection.add(key);
      }
      setSelectedCells(newSelection);
    } else {
      // Regular click: if clicking the only selected cell, deselect it
      if (selectedCells.size === 1 && selectedCells.has(key)) {
        setSelectedCells(new Set());
      } else {
        // Otherwise start new selection
        setSelectedCells(new Set([key]));
      }
    }
    setIsDragging(true);
  };

  const handleMouseEnter = (row: number, col: number) => {
    if (!isDragging) return;
    const key = `${row}-${col}`;
    setSelectedCells((prev) => {
      const newSelection = new Set(prev);
      newSelection.add(key);
      return newSelection;
    });
  };

  // Keyboard support
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Spacebar to cycle input mode (works anytime timer is running)
      if (e.key === " " && isTimerRunning) {
        e.preventDefault();
        cycleInputMode();
        return;
      }

      if (selectedCells.size === 0) return;

      // Get primary cell for navigation
      const primary = parseKey([...selectedCells][0]);

      // Number keys
      if (e.key >= "1" && e.key <= "9") {
        e.preventDefault();
        handleCellInput(parseInt(e.key));
        return;
      }

      // Delete/Backspace to clear value from selected cells (preserves notes)
      if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        setBoard((prev) => {
          const newBoard = prev.map((r) =>
            r.map((cell) => ({
              ...cell,
              possibleNotes: new Set(cell.possibleNotes),
              pointingNotes: new Set(cell.pointingNotes),
            }))
          );
          selectedCells.forEach((key) => {
            const { row, col } = parseKey(key);
            if (!newBoard[row][col].isGiven) {
              // Only clear the value, preserve notes
              newBoard[row][col].value = null;
            }
          });
          return newBoard;
        });
        return;
      }

      // Arrow keys for navigation (moves primary selection)
      let newRow = primary.row;
      let newCol = primary.col;

      if (e.key === "ArrowUp" && primary.row > 0) {
        e.preventDefault();
        newRow = primary.row - 1;
      } else if (e.key === "ArrowDown" && primary.row < 8) {
        e.preventDefault();
        newRow = primary.row + 1;
      } else if (e.key === "ArrowLeft" && primary.col > 0) {
        e.preventDefault();
        newCol = primary.col - 1;
      } else if (e.key === "ArrowRight" && primary.col < 8) {
        e.preventDefault();
        newCol = primary.col + 1;
      }

      if (newRow !== primary.row || newCol !== primary.col) {
        const newKey = `${newRow}-${newCol}`;
        if (e.shiftKey) {
          // Shift+arrow: extend selection
          setSelectedCells((prev) => {
            const newSelection = new Set(prev);
            newSelection.add(newKey);
            return newSelection;
          });
        } else {
          // Regular arrow: move selection
          setSelectedCells(new Set([newKey]));
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedCells, handleCellInput, isTimerRunning, cycleInputMode]);

  // Check if a note number conflicts with any value in the same row/col/box
  const isNoteConflicting = (row: number, col: number, num: number): boolean => {
    // Check row
    for (let c = 0; c < 9; c++) {
      if (c !== col && board[row][c].value === num) return true;
    }
    // Check column
    for (let r = 0; r < 9; r++) {
      if (r !== row && board[r][col].value === num) return true;
    }
    // Check 3x3 box
    const boxStartRow = Math.floor(row / 3) * 3;
    const boxStartCol = Math.floor(col / 3) * 3;
    for (let r = boxStartRow; r < boxStartRow + 3; r++) {
      for (let c = boxStartCol; c < boxStartCol + 3; c++) {
        if ((r !== row || c !== col) && board[r][c].value === num) return true;
      }
    }
    return false;
  };

  // Render notes inside a cell
  const renderNotes = (cell: Cell, row: number, col: number) => {
    const hasPossible = cell.possibleNotes.size > 0;
    const hasPointing = cell.pointingNotes.size > 0;

    if (!hasPossible && !hasPointing) return null;

    // Combine both note types - pointing takes visual priority
    const allNotes = new Set([...cell.possibleNotes, ...cell.pointingNotes]);

    return (
      <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 p-[4%]">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => {
          const isPointing = cell.pointingNotes.has(num);
          const shouldShow = allNotes.has(num);
          
          if (!shouldShow) {
            return <div key={num} className="flex items-center justify-center" />;
          }

          // Check if this note conflicts with a placed value
          const isConflict = isNoteConflicting(row, col, num);

          // Red if conflicting, amber if pointing, blue if possible
          let colorClass: string;
          if (isConflict) {
            colorClass = "text-red-500 font-bold";
          } else if (isPointing) {
            colorClass = "text-amber-400 font-bold";
          } else {
            colorClass = "text-blue-400";
          }

          return (
            <div
              key={num}
              className="flex items-center justify-center text-[clamp(0.6rem,2vh,1.1rem)] leading-none"
            >
              <span className={colorClass}>{num}</span>
            </div>
          );
        })}
      </div>
    );
  };

  // Render mode button as a sudoku-style cell
  const renderModeButton = (mode: InputMode, label: string) => {
    const isActive = inputMode === mode;
    
    // Base cell styling to match sudoku cells
    const baseStyle = "relative flex items-center justify-center transition-all duration-150 cursor-pointer";
    const cellSize = "w-[clamp(2.5rem,6vh,4rem)] h-[clamp(2.5rem,6vh,4rem)]";
    const border = "border-2 border-slate-500";
    const bg = isActive ? "bg-yellow-600/50" : "bg-slate-800 hover:bg-slate-700";
    
    return (
      <button
        key={mode}
        onClick={() => setInputMode(mode)}
        className={`${baseStyle} ${cellSize} ${border} ${bg} rounded-sm`}
      >
        {mode === "value" ? (
          // Show as a value (large centered number)
          <span className={`text-[clamp(1rem,2.5vh,1.5rem)] font-bold ${isActive ? "text-white" : "text-slate-300"}`}>
            {label.charAt(0).toUpperCase()}
          </span>
        ) : (
          // Show as notes (3x3 mini grid)
          <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 p-[8%]">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
              <div
                key={num}
                className="flex items-center justify-center text-[clamp(0.35rem,0.9vh,0.55rem)] leading-none"
              >
                <span className={`${
                  mode === "possible" 
                    ? isActive ? "text-blue-300" : "text-blue-400/60"
                    : isActive ? "text-amber-300 font-bold" : "text-amber-400/60 font-bold"
                }`}>
                  {num}
                </span>
              </div>
            ))}
          </div>
        )}
      </button>
    );
  };

  const syncStatusMessage = isSyncing
    ? "Syncing latest hard puzzle..."
    : syncError
    ? `Sync failed: ${syncError}`
    : lastSyncTime
    ? `Last sync ${lastSyncTime}`
    : "Waiting for first sync...";

  return (
    <>
      <header className="text-center shrink-0 flex flex-col items-center gap-[1vh]">
        <h1 className="text-[clamp(1.25rem,4vh,2.5rem)] font-bold tracking-wide">Sudoku</h1>
        <p className="text-slate-300 text-[clamp(0.75rem,2vh,1rem)] font-semibold">
          {puzzleInfo ? `${puzzleInfo.difficulty} • ${puzzleInfo.displayDate}` : "Sample hard puzzle"}
        </p>
        <div className="flex items-center gap-3 text-[clamp(0.55rem,1.4vh,0.75rem)] text-slate-400">
          <span className="text-center max-w-[55vw]">{syncStatusMessage}</span>
          {syncError && (
            <button
              onClick={handleRetrySync}
              disabled={isSyncing}
              className="underline text-slate-200 disabled:opacity-50 disabled:no-underline"
            >
              Retry
            </button>
          )}
        </div>
        
        {/* Timer */}
        <div className="flex items-center gap-[1.5vw]">
          <span className="text-[clamp(1rem,3vh,1.75rem)] font-mono font-semibold text-slate-200 min-w-[4em] text-center">
            {formatTime(elapsedTime)}
          </span>
          <button
            onClick={toggleTimer}
            type="button"
            disabled={isCompleted}
            className={`px-[1.5vw] py-[0.5vh] rounded-lg font-semibold text-[clamp(0.65rem,1.5vh,0.85rem)] transition-all duration-150 ${
              isTimerRunning
                ? "bg-amber-600 hover:bg-amber-500 text-white"
                : "bg-green-600 hover:bg-green-500 text-white"
            } ${isCompleted ? "opacity-60 cursor-not-allowed" : ""}`}
          >
            {isCompleted ? "Completed" : isTimerRunning ? "Pause" : "Start"}
          </button>
        </div>
      </header>

      {/* Game area */}
      <section className="flex-1 flex items-center justify-center w-full min-h-0 relative">
        {/* Sudoku Board - centered */}
        <div className="h-full max-h-[82vh] aspect-square select-none relative">
          <div 
            className="h-full w-full grid grid-cols-9 grid-rows-9"
            style={{ 
              border: "3px solid #64748b",
              backgroundColor: "#1e293b"
            }}
          >
            {board.map((row, rowIndex) =>
              row.map((cell, colIndex) => {
                const cellKey = `${rowIndex}-${colIndex}`;
                const isSelected = selectedCells.has(cellKey);
                const isHighlighted = highlightedCells.has(cellKey);
                const isSameNumber = sameNumberCells.has(cellKey);
                const isInvalid = invalidCells.has(cellKey);

                // Thicker borders for 3x3 boxes
                const borderRight = colIndex % 3 === 2 && colIndex !== 8 
                  ? "3px solid #64748b" 
                  : "2px solid #475569";
                const borderBottom = rowIndex % 3 === 2 && rowIndex !== 8 
                  ? "3px solid #64748b" 
                  : "2px solid #475569";

                // Background color logic with yellow highlighting
                let bgColor = "#1e293b"; // Default dark background
                
                // Given cells have grayish background
                if (cell.isGiven) {
                  bgColor = "#374151"; // Gray for given cells
                }

                // Yellow highlighting layers (priority order)
                if (isInvalid && !cell.isGiven) {
                  bgColor = "#7f1d1d"; // Red for invalid
                } else if (isSelected) {
                  bgColor = "#a16207"; // Brightest yellow - selected cell
                } else if (isSameNumber) {
                  bgColor = "#854d0e"; // Medium yellow - same number
                } else if (isHighlighted) {
                  bgColor = cell.isGiven ? "#4a4528" : "#3f3a1d"; // Subtle yellow - row/col/box
                }

                return (
                  <div
                    key={cellKey}
                    className="relative flex items-center justify-center cursor-pointer transition-colors duration-100"
                    style={{ 
                      backgroundColor: bgColor,
                      borderRight,
                      borderBottom,
                    }}
                    onMouseDown={(e) => isTimerRunning && handleMouseDown(rowIndex, colIndex, e)}
                    onMouseEnter={() => isTimerRunning && handleMouseEnter(rowIndex, colIndex)}
                  >
                    {cell.value !== null ? (
                      <span
                        className="text-[clamp(1.5rem,5vh,3rem)] font-bold"
                        style={{
                          color: isInvalid ? "#f87171" : "#e2e8f0"
                        }}
                      >
                        {cell.value}
                      </span>
                    ) : (
                      renderNotes(cell, rowIndex, colIndex)
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Pause/Start overlay */}
          {(!isTimerRunning || isCompleted) && (
            <div 
              className="absolute inset-0 backdrop-blur-sm flex flex-col items-center justify-center gap-[3vh] rounded-lg"
              style={{ backgroundColor: "rgba(30, 41, 59, 0.95)" }}
            >
              {isCompleted ? (
                <>
                  <div className="text-[clamp(1.5rem,5vh,3rem)] font-bold text-slate-200">🏁</div>
                  <p className="text-[clamp(0.9rem,2.5vh,1.25rem)] text-slate-100 font-semibold">
                    Finished in {formatTime(elapsedTime)}
                  </p>
                  <p className="text-[clamp(0.8rem,2vh,1.1rem)] text-slate-400">
                    Waiting for the next puzzle...
                  </p>
                </>
              ) : (
                <>
                  <div className="text-[clamp(1.5rem,5vh,3rem)] font-bold text-slate-200">
                    {elapsedTime === 0 ? "🧩" : "⏸️"}
                  </div>
                  <p className="text-[clamp(0.9rem,2.5vh,1.25rem)] text-slate-300 font-medium">
                    {elapsedTime === 0 ? "Press Start to begin" : "Game Paused"}
                  </p>
                  <button
                    onClick={toggleTimer}
                    className="px-[4vw] py-[1.5vh] rounded-xl bg-green-600 hover:bg-green-500 active:scale-95 font-bold text-white text-[clamp(0.9rem,2vh,1.1rem)] shadow-lg transition-all duration-150"
                  >
                    {elapsedTime === 0 ? "Start Game" : "Resume"}
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Controls Panel - positioned to the right */}
        <div className="absolute right-[2vw] top-1/2 -translate-y-1/2 flex flex-col gap-[2vh] items-center">
          {/* Number Pad */}
          <div 
            className="grid grid-cols-3 gap-0"
            style={{ border: "3px solid #64748b" }}
          >
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
              <button
                key={num}
                onClick={() => handleNumberClick(num)}
                className="relative flex items-center justify-center transition-all duration-150"
                style={{
                  width: "clamp(2.5rem,6vh,4rem)",
                  height: "clamp(2.5rem,6vh,4rem)",
                  backgroundColor: selectedNumber === num ? "#a16207" : "#1e293b",
                  borderRight: num % 3 !== 0 ? "2px solid #475569" : "none",
                  borderBottom: num <= 6 ? "2px solid #475569" : "none",
                }}
              >
                <span className={`text-[clamp(1rem,2.5vh,1.5rem)] font-bold ${
                  selectedNumber === num ? "text-white" : "text-slate-200"
                }`}>
                  {num}
                </span>
              </button>
            ))}
          </div>

          {/* Input Mode Toggle - styled as sudoku cells */}
          <div className="flex flex-col gap-[0.5vh] items-center">
            <span className="text-[clamp(0.55rem,1.3vh,0.7rem)] text-slate-400 text-center">
              Mode (Space)
            </span>
            <div className="flex gap-[0.5vh]">
              {renderModeButton("value", "V")}
              {renderModeButton("possible", "N")}
              {renderModeButton("pointing", "P")}
            </div>
            <span className="text-[clamp(0.45rem,1vh,0.6rem)] text-slate-500">
              {inputMode === "value" ? "Value" : inputMode === "possible" ? "Notes" : "Pointing"}
            </span>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col gap-[1vh] w-full">
            <button
              onClick={onModeSwitch}
              className="w-full px-[2vw] py-[0.8vh] rounded-lg bg-violet-600 hover:bg-violet-500 active:scale-95 font-semibold text-white text-[clamp(0.6rem,1.3vh,0.8rem)] transition-all duration-150"
            >
              Play Wordle
            </button>
          </div>
        </div>
      </section>

      {/* Instructions */}
      <div className="text-center shrink-0">
        <p className="text-slate-400 text-[clamp(0.55rem,1.3vh,0.75rem)]">
          Click & drag to select • Shift+click to extend • Space to switch mode • Arrow keys to navigate
        </p>
      </div>
    </>
  );
}
