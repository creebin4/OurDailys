import { useState } from "react";
import "./App.css";
import WordleGame from "./WordleGame";
import SudokuGame from "./SudokuGame";

type GameMode = "wordle" | "sudoku";

function App() {
  const [mode, setMode] = useState<GameMode>("wordle");

  return (
    <div className="h-screen w-screen overflow-hidden bg-gradient-to-b from-slate-800 to-slate-950 flex flex-col items-center justify-between p-[3vh] text-slate-50">
      {mode === "wordle" ? (
        <WordleGame onModeSwitch={() => setMode("sudoku")} />
      ) : (
        <SudokuGame onModeSwitch={() => setMode("wordle")} />
      )}
    </div>
  );
}

export default App;
