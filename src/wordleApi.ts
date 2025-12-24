import { invoke } from "@tauri-apps/api/core";

export interface WordleData {
  date: string;
  word: string;
  puzzle: string;
}

export async function fetchWordleAnswer(): Promise<WordleData> {
  return invoke<WordleData>("fetch_wordle_answer");
}
