import { useState } from "react";
import "./App.css";
import WordleGame from "./WordleGame";
import SudokuGame from "./SudokuGame";

type GameMode = "wordle" | "sudoku";

function App() {
  const [mode, setMode] = useState<GameMode>("wordle");

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-gradient-to-b from-slate-800 to-slate-950 text-slate-50">
      <div
        className={`absolute inset-0 transition-opacity duration-200 ${
          mode === "wordle" ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      >
        <div className="h-full w-full flex flex-col items-center justify-between p-[3vh]">
          <WordleGame onModeSwitch={() => setMode("sudoku")} />
        </div>
      </div>
      <div
        className={`absolute inset-0 transition-opacity duration-200 ${
          mode === "sudoku" ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      >
        <div className="h-full w-full flex flex-col items-center justify-between p-[3vh]">
          <SudokuGame onModeSwitch={() => setMode("wordle")} />
        </div>
      </div>
    </div>
  );
}

export default App;
