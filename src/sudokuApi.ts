import { invoke } from "@tauri-apps/api/core";

export interface SudokuData {
  displayDate: string;
  printDate: string;
  difficulty: string;
  puzzle: number[][];
  solution: number[][];
}

export async function fetchSudokuPuzzle(): Promise<SudokuData> {
  return invoke<SudokuData>("fetch_sudoku_puzzle");
}
