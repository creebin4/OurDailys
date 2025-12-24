import { useCallback, useEffect, useRef, useState } from "react";
import validWordsText from "./assets/valid-wordle-words.txt?raw";
import { fetchWordleAnswer, WordleData } from "./wordleApi";

const FALLBACK_WORD = "WHITE";
const NUM_ROWS = 6;
const NUM_COLS = 5;
type LetterStatus = "" | "absent" | "present" | "correct";
const DEFAULT_HELP_TEXT = "Type a five-letter guess, then press Enter.";

const createEmptyGrid = () =>
  Array.from({ length: NUM_ROWS }, () => Array(NUM_COLS).fill(""));

const createEmptyStatusGrid = () =>
  Array.from({ length: NUM_ROWS }, () => Array<LetterStatus>(NUM_COLS).fill(""));

const VALID_WORDS = new Set(
  validWordsText
    .split(/\r?\n/)
    .map((word) => word.trim().toUpperCase())
    .filter(Boolean)
);

const evaluateGuess = (guess: string, target: string): LetterStatus[] => {
  const status: LetterStatus[] = Array(NUM_COLS).fill("");
  const remainingLetters: Record<string, number> = {};

  for (let i = 0; i < NUM_COLS; i += 1) {
    if (guess[i] === target[i]) {
      status[i] = "correct";
    } else {
      remainingLetters[target[i]] = (remainingLetters[target[i]] ?? 0) + 1;
    }
  }

  for (let i = 0; i < NUM_COLS; i += 1) {
    if (status[i]) continue;
    const letter = guess[i];
    if (remainingLetters[letter] > 0) {
      status[i] = "present";
      remainingLetters[letter] -= 1;
    } else {
      status[i] = "absent";
    }
  }

  return status;
};

const statusColors: Record<LetterStatus, string> = {
  "": "bg-slate-900 border-slate-700",
  absent: "bg-zinc-800 border-zinc-800",
  present: "bg-amber-600 border-amber-600",
  correct: "bg-green-700 border-green-700",
};

interface WordleGameProps {
  onModeSwitch: () => void;
}

export default function WordleGame({ onModeSwitch }: WordleGameProps) {
  const [board, setBoard] = useState(createEmptyGrid);
  const [statuses, setStatuses] = useState(createEmptyStatusGrid);
  const [currentRow, setCurrentRow] = useState(0);
  const [currentCol, setCurrentCol] = useState(0);
  const [gameState, setGameState] = useState<"playing" | "won" | "lost">("playing");
  const [message, setMessage] = useState("");
  const [showMessage, setShowMessage] = useState(false);
  const [invalidRow, setInvalidRow] = useState<number | null>(null);
  const [revealedColumns, setRevealedColumns] = useState<number[]>(() =>
    Array(NUM_ROWS).fill(-1)
  );
  const [revealRow, setRevealRow] = useState<number | null>(null);
  const [revealStep, setRevealStep] = useState(0);
  const [isRevealingRow, setIsRevealingRow] = useState(false);
  const [targetWord, setTargetWord] = useState(FALLBACK_WORD.toUpperCase());
  const targetWordRef = useRef(targetWord);
  const [answerMeta, setAnswerMeta] = useState<WordleData | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  const messageTimeout = useRef<ReturnType<typeof window.setTimeout> | null>(null);

  const flashMessage = useCallback(
    (text: string) => {
      setMessage(text);
      setShowMessage(true);
      if (messageTimeout.current) {
        window.clearTimeout(messageTimeout.current);
      }
      messageTimeout.current = window.setTimeout(() => setShowMessage(false), 2000);
    },
    [setMessage, setShowMessage]
  );

  useEffect(() => {
    return () => {
      if (messageTimeout.current) {
        window.clearTimeout(messageTimeout.current);
      }
    };
  }, []);

  useEffect(() => {
    targetWordRef.current = targetWord;
  }, [targetWord]);

  const rebuildGameForWord = useCallback(
    (nextTarget: string, toast: string = DEFAULT_HELP_TEXT) => {
      const normalized = nextTarget.trim().toUpperCase();
      if (normalized.length !== NUM_COLS || /[^A-Z]/.test(normalized)) {
        return;
      }

      setBoard(createEmptyGrid());
      setStatuses(createEmptyStatusGrid());
      setCurrentRow(0);
      setCurrentCol(0);
      setGameState("playing");
      setInvalidRow(null);
      setRevealedColumns(Array(NUM_ROWS).fill(-1));
      setRevealRow(null);
      setRevealStep(0);
      setIsRevealingRow(false);
      setTargetWord((prev) => (prev === normalized ? prev : normalized));
      flashMessage(toast);
    },
    [flashMessage]
  );

  useEffect(() => {
    rebuildGameForWord(targetWordRef.current);
  }, [rebuildGameForWord]);

  const applyFetchedAnswer = useCallback(
    (data: WordleData) => {
      const normalized = data.word.trim().toUpperCase();
      if (!/^[A-Z]{5}$/.test(normalized)) {
        throw new Error("Received invalid Wordle answer");
      }

      setAnswerMeta(data);
      setLastSyncedAt(new Date());
      setSyncError(null);

      if (targetWordRef.current !== normalized) {
        rebuildGameForWord(normalized, "Today's Wordle synced!");
      }
    },
    [rebuildGameForWord]
  );

  const syncWord = useCallback(async () => {
    try {
      const data = await fetchWordleAnswer();
      applyFetchedAnswer(data);
    } catch (err) {
      const messageText =
        typeof err === "string"
          ? err
          : err instanceof Error
            ? err.message
            : "Failed to fetch Wordle answer";
      console.error("Failed to sync Wordle answer", err);
      setSyncError(messageText);
      flashMessage("Unable to sync today's Wordle right now.");
    }
  }, [applyFetchedAnswer, flashMessage]);

  useEffect(() => {
    void syncWord();
  }, [syncWord]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void syncWord();
    }, 12 * 60 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [syncWord]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (gameState !== "playing") {
        return;
      }

      if (isRevealingRow) {
        event.preventDefault();
        return;
      }

      const { key } = event;
      if (key === "Backspace") {
        event.preventDefault();
        if (currentCol === 0) return;
        setBoard((prev) => {
          const clone = prev.map((row) => [...row]);
          clone[currentRow][currentCol - 1] = "";
          return clone;
        });
        setCurrentCol((col) => Math.max(col - 1, 0));
        return;
      }

      if (key === "Enter") {
        event.preventDefault();
        if (currentCol < NUM_COLS) {
          flashMessage("Fill all 5 letters before submitting.");
          return;
        }

        const guess = board[currentRow].join("");
        const rowToReveal = currentRow;
        if (!VALID_WORDS.has(guess)) {
          flashMessage("That word is not in the allowed list.");
          setInvalidRow(currentRow);
          return;
        }
        const evaluation = evaluateGuess(guess, targetWordRef.current);
        setStatuses((prev) => {
          const clone = prev.map((row) => [...row]);
          clone[rowToReveal] = evaluation;
          return clone;
        });
        setRevealedColumns((prev) => {
          const clone = [...prev];
          clone[rowToReveal] = -1;
          return clone;
        });
        setRevealRow(rowToReveal);
        setRevealStep(0);
        setIsRevealingRow(true);

        if (guess === targetWordRef.current) {
          setGameState("won");
          flashMessage(`✨ You guessed ${targetWordRef.current}! ✨`);
          return;
        }

        if (currentRow === NUM_ROWS - 1) {
          setGameState("lost");
          flashMessage(`Out of guesses. The word was ${targetWordRef.current}.`);
          return;
        }

        setCurrentRow((row) => row + 1);
        setCurrentCol(0);
        flashMessage("Keep going!");
        return;
      }

      if (/^[a-zA-Z]$/.test(key)) {
        event.preventDefault();
        if (currentCol >= NUM_COLS) {
          return;
        }

        setBoard((prev) => {
          const clone = prev.map((row) => [...row]);
          clone[currentRow][currentCol] = key.toUpperCase();
          return clone;
        });
        setCurrentCol((col) => Math.min(col + 1, NUM_COLS));
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    board,
    currentCol,
    currentRow,
    gameState,
    targetWord,
    flashMessage,
    isRevealingRow,
  ]);

  useEffect(() => {
    if (invalidRow === null) {
      return undefined;
    }
    const timeout = window.setTimeout(() => setInvalidRow(null), 450);
    return () => window.clearTimeout(timeout);
  }, [invalidRow]);

  useEffect(() => {
    if (revealRow === null) {
      return undefined;
    }

    const FLIP_DURATION = 500;
    const STATUS_REVEAL_DELAY = 250;

    if (revealStep >= NUM_COLS) {
      const finishTimer = window.setTimeout(() => {
        setIsRevealingRow(false);
        setRevealRow(null);
        setRevealStep(0);
      }, FLIP_DURATION);
      return () => window.clearTimeout(finishTimer);
    }

    const statusTimer = window.setTimeout(() => {
      setRevealedColumns((prev) => {
        const clone = [...prev];
        if (revealRow !== null) {
          clone[revealRow] = revealStep;
        }
        return clone;
      });
    }, STATUS_REVEAL_DELAY);

    const advanceTimer = window.setTimeout(() => {
      setRevealStep((step) => step + 1);
    }, FLIP_DURATION);

    return () => {
      window.clearTimeout(statusTimer);
      window.clearTimeout(advanceTimer);
    };
  }, [revealRow, revealStep]);

  const puzzleDateLabel = answerMeta
    ? (() => {
        const parsed = new Date(answerMeta.date);
        return Number.isNaN(parsed.getTime())
          ? null
          : parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      })()
    : null;

  const lastSyncedLabel = lastSyncedAt
    ? lastSyncedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <>
      <header className="text-center shrink-0">
        <h1 className="text-[clamp(1.25rem,4vh,2.5rem)] font-bold tracking-wide">Mini Wordle</h1>
        {answerMeta && (
          <p className="text-slate-400 text-[clamp(0.75rem,2vh,1rem)] mt-1">
            {answerMeta.puzzle}
            {puzzleDateLabel && <span className="px-2 text-slate-600">•</span>}
            {puzzleDateLabel}
          </p>
        )}
      </header>

      {/* Message bubble */}
      <div
        className={`fixed top-[2vh] left-1/2 -translate-x-1/2 bg-slate-900/95 backdrop-blur-sm px-[2vw] py-[1vh] rounded-full font-semibold text-slate-200 shadow-xl z-10 transition-opacity duration-300 text-[clamp(0.75rem,2vh,1rem)] ${
          showMessage ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        role="status"
        aria-live="polite"
      >
        <p>{message}</p>
      </div>

      {/* Game board - aspect ratio 5:6 (5 cols x 6 rows) */}
      <section className="flex-1 flex items-center justify-center w-full min-h-0">
        <div className="h-full max-h-[60vh] aspect-[5/6] grid grid-rows-6 gap-[1vh]">
          {board.map((row, rowIndex) => (
            <div
              className={`grid grid-cols-5 gap-[1vh] ${
                invalidRow === rowIndex ? "animate-shake" : ""
              }`}
              key={`row-${rowIndex}`}
            >
              {row.map((letter, colIndex) => {
                const status = statuses[rowIndex][colIndex];
                const isRevealed = revealedColumns[rowIndex] >= colIndex;
                const isFlipping =
                  revealRow === rowIndex && revealStep === colIndex;
                const colorClass = isRevealed
                  ? statusColors[status]
                  : statusColors[""];

                return (
                  <div
                    className={`aspect-square flex items-center justify-center text-[clamp(1rem,4vh,2rem)] font-bold uppercase border-2 rounded-md transition-colors duration-150 ${colorClass} ${
                      isFlipping ? "animate-flip" : ""
                    }`}
                    key={`cell-${rowIndex}-${colIndex}`}
                  >
                    {letter}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </section>

      {/* Controls */}
      <div className="flex flex-col items-center gap-[1vh] shrink-0 w-full">
        <div className="flex flex-wrap justify-center gap-[1vw]">
          <button
            className="px-[3vw] py-[1vh] rounded-full bg-violet-600 hover:bg-violet-500 active:scale-95 font-semibold text-white shadow-lg transition-all duration-150 text-[clamp(0.75rem,2vh,1rem)]"
            type="button"
            onClick={onModeSwitch}
          >
            Play Sudoku
          </button>
        </div>
        <div className="flex flex-col items-center gap-1 text-slate-400 text-center text-[clamp(0.6rem,1.5vh,0.875rem)]">
          <p>Type letters, Backspace to delete, Enter to submit.</p>
          <div className="flex flex-col">
            {lastSyncedLabel && <span>Last synced at {lastSyncedLabel}</span>}
            {syncError && <span className="text-red-300">Sync error: {syncError}</span>}
          </div>
        </div>
      </div>
    </>
  );
}

