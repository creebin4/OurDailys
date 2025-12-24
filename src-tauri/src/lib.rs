use log::{error, info, warn};
use scraper::{ElementRef, Html, Selector};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WordleData {
    pub date: String,
    pub word: String,
    pub puzzle: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SudokuData {
    pub display_date: String,
    pub print_date: String,
    pub difficulty: String,
    pub puzzle: Vec<Vec<u8>>,
    pub solution: Vec<Vec<u8>>,
}

fn collect_compact_text(element: &ElementRef<'_>) -> String {
    element
        .text()
        .flat_map(|fragment| fragment.split_whitespace())
        .collect::<Vec<_>>()
        .join(" ")
}

fn extract_hidden_word(span: &ElementRef<'_>) -> Option<String> {
    let raw: String = span.text().collect();
    let normalized: String = raw
        .chars()
        .filter(|c| c.is_ascii_alphabetic())
        .collect();
    let word = normalized.trim().to_uppercase();
    if word.len() == 5 {
        Some(word)
    } else {
        None
    }
}

fn format_puzzle_label(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return "Wordle".to_string();
    }

    let lower = trimmed.to_ascii_lowercase();
    if lower.contains("wordle") {
        return trimmed.to_string();
    }

    if trimmed.starts_with('#') {
        return format!("Wordle {}", trimmed);
    }

    format!("Wordle #{}", trimmed)
}

async fn get_wordle_answer_impl() -> Result<WordleData, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;
    let response = client
        .get("https://wordfinder.yourdictionary.com/wordle/answers/")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch page: {}", e))?;

    if !response.status().is_success() {
        let status_msg = format!("Wordfinder responded with HTTP {}", response.status());
        error!("{}", status_msg);
        return Err(status_msg);
    }

    let html = response.text().await.map_err(|e| format!("Failed to read response: {}", e))?;
    let document = Html::parse_document(&html);

    let row_selector = Selector::parse("table tbody tr").map_err(|_| "Failed to parse row selector")?;
    let cell_selector = Selector::parse("td").map_err(|_| "Failed to parse cell selector")?;
    let span_selector = Selector::parse("span[style*=\"display:none\"]").map_err(|_| "Failed to parse hidden span selector")?;

    for row in document.select(&row_selector) {
        let mut cells = row.select(&cell_selector);
        let date_cell = cells.next().map(|cell| collect_compact_text(&cell)).unwrap_or_default();
        let puzzle_cell = cells
            .next()
            .map(|cell| collect_compact_text(&cell))
            .unwrap_or_default();
        if let Some(answer_cell) = cells.next() {
            if let Some(word) = answer_cell
                .select(&span_selector)
                .find_map(|span| extract_hidden_word(&span))
            {
                let today = chrono::Local::now().format("%Y-%m-%d").to_string();
                let puzzle = format_puzzle_label(&puzzle_cell);
                let date_label = if date_cell.to_ascii_lowercase().contains("today") {
                    today
                } else {
                    today
                };

                return Ok(WordleData {
                    date: date_label,
                    word,
                    puzzle,
                });
            }
        }
    }

    warn!("Wordfinder page parsed but no hidden span containing today's answer was found");
    Err("Could not find Wordle answer on page".to_string())
}

fn extract_game_data_blob(html: &str) -> Result<String, String> {
    const MARKER: &str = "window.gameData = ";
    let start = html
        .find(MARKER)
        .ok_or_else(|| "window.gameData marker not found".to_string())?;
    let after_marker = &html[start + MARKER.len()..];
    let end = after_marker
        .find("</script>")
        .ok_or_else(|| "Unable to find </script> following window.gameData".to_string())?;
    let raw_block = after_marker[..end].trim();
    Ok(raw_block.trim_end_matches(';').trim().to_string())
}

fn board_from_json(value: &Value, label: &str) -> Result<Vec<Vec<u8>>, String> {
    let cells = value
        .as_array()
        .ok_or_else(|| format!("Sudoku {label} data is not an array"))?;
    if cells.len() != 81 {
        return Err(format!(
            "Sudoku {label} expected 81 entries but found {}",
            cells.len()
        ));
    }

    let mut flat: Vec<u8> = Vec::with_capacity(81);
    for cell in cells {
        let number = cell
            .as_i64()
            .ok_or_else(|| format!("Encountered non-numeric value in {label}"))?;
        if !(0..=9).contains(&number) {
            return Err(format!("Invalid Sudoku digit {number} in {label}"));
        }
        flat.push(number as u8);
    }

    Ok(flat
        .chunks(9)
        .map(|chunk| chunk.to_vec())
        .collect::<Vec<_>>())
}

async fn fetch_sudoku_puzzle_impl() -> Result<SudokuData, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;
    info!("Fetching latest Sudoku puzzle from NYT");

    let response = client
        .get("https://www.nytimes.com/puzzles/sudoku/hard")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch Sudoku page: {e}"))?;
    info!("Fetching latest Wordle answer from Wordfinder");

    if !response.status().is_success() {
        let status_msg = format!("NYT Sudoku responded with HTTP {}", response.status());
        error!("{status_msg}");
        return Err(status_msg);
    }

    let html = response
        .text()
        .await
        .map_err(|e| format!("Failed to read Sudoku response: {e}"))?;
    info!("Fetched latest Sudoku puzzle from NYT");
    let json_blob = extract_game_data_blob(&html)?;
    let root: Value = serde_json::from_str(&json_blob)
        .map_err(|e| format!("Failed to parse gameData JSON: {e}"))?;

    let display_date = root
        .get("displayDate")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let hard = root
        .get("hard")
        .ok_or_else(|| "Missing hard puzzle block".to_string())?;
    let difficulty = hard
        .get("difficulty")
        .and_then(|v| v.as_str())
        .unwrap_or("Hard")
        .to_string();
    let print_date = hard
        .get("print_date")
        .and_then(|v| v.as_str())
        .unwrap_or(&display_date)
        .to_string();
    let puzzle_data = hard
        .get("puzzle_data")
        .ok_or_else(|| "Missing puzzle_data block".to_string())?;

    let puzzle = board_from_json(
        puzzle_data
            .get("puzzle")
            .ok_or_else(|| "Missing puzzle array".to_string())?,
        "puzzle",
    )?;
    let solution = board_from_json(
        puzzle_data
            .get("solution")
            .ok_or_else(|| "Missing solution array".to_string())?,
        "solution",
    )?;

    Ok(SudokuData {
        display_date,
        print_date,
        difficulty,
        puzzle,
        solution,
    })
}

#[tauri::command]
async fn fetch_wordle_answer() -> Result<WordleData, String> {
    info!("Fetching latest Wordle answer from Wordfinder");
    get_wordle_answer_impl().await
}

#[tauri::command]
async fn fetch_sudoku_puzzle() -> Result<SudokuData, String> {
    info!("Fetching NYT hard Sudoku puzzle");
    fetch_sudoku_puzzle_impl().await
}


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![fetch_wordle_answer, fetch_sudoku_puzzle])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
