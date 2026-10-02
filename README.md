# Bills Etc

Personal spending tracker. Exports Come Citizens Bank transaction CSV, categorizes each line with a local Ollama LLM (100% offline), keeps a master history, and generates HTML budget reports.

## Requirements

- Python 3 with `pandas`
- [Ollama](https://ollama.com) running locally with a pulled model matching `MODEL_NAME` in the scripts (currently `qwen2.5:14b`)

## Workflow

### End of month — add a full month of history

1. Export the month's data from CitizensBank.com to CSV and move it to `inputs/past_months/`.
2. Run `python 1_backfill_prev_months_to_master.py`
   - Cleans merchants and categories via the local AI, applies hardcoded override rules, saves to `output_master_data/all_time_finances.csv`.
   - Skips transactions already in the master (dedupe on date + description + amount), and drops sensitive columns (account numbers, balance, etc.).
3. Fix any mis-categorized rows directly in the master.
4. Run `python 2_process_master_data_plus_report.py` to view the data —
   writes a styled HTML report (cash flow, category breakdowns, trends, transaction tabs, AI analysis) to `reports/<latest_month>_report.html` and opens it.

### Mid-month — how are we doing?

1. Export the current month's data to CSV and move it to `inputs/current_month/` (exactly one file).
2. Run `python 3_process_current_month.py --ai` to categorize any new transactions with AI (results are cached).
3. Open `output_master_data/processed_current_month.csv` and fix any categories by hand.
4. Run `python 3_process_current_month.py` again (no `--ai`) to regenerate the projection:
   - Expected income vs. fixed expenses (from `config.json`).
   - Variable categories projected to the full month by scaling current pace: `(spent / days_elapsed) * days_in_month`.
   - Comparison against historical averages from the master.
   - Writes `reports/<YYYY_MM>_projection.html` and opens it.

### Close the month

1. After confirming the processed data, run `python 4_close_month.py`.
   - Appends new transactions to the master, archives the raw bank CSV to `inputs/past_months/<YYYY_MM>_closed.csv`, archives the processed file, and clears `inputs/current_month/`.

## Configuration — `config.json`

| Key | Purpose |
|---|---|
| `monthly_income_*` | Expected monthly take-home pay; summed by script 3 |
| `fixed_expenses` | Bills that hit every month (~same amount) |
| `variable_categories` | Categories that are day-scaled to project the full month |

Keys starting with `_` are ignored. See the notes in the file itself.

## Data and folders

| Path | Contents |
|---|---|
| `inputs/past_months/` | Bank CSVs for history to backfill |
| `inputs/current_month/` | Bank CSV for the current month (one file) |
| `output_master_data/all_time_finances.csv` | Master history of all transactions |
| `output_master_data/processed_current_month.csv` | Current month's categorized rows (edit here) |
| `output_master_data/categorized_cache.csv` | AI categorization cache for the current month |
| `reports/` | Generated HTML reports |

## Categories

`Groceries, Dining Out, Utilities, Rent/Mortgage, Entertainment, Shopping, Transport, Gas, Income, Savings, Credit Card, Miscellaneous`

Categorization order: manual edits in the processed file → cache → AI (with `--ai`) → override/keyword rules. Known merchants that the AI gets wrong are pinned in each script's `CATEGORY_OVERRIDES` / `MERCHANT_CATEGORY_OVERRIDES` lists — add entries there for anything else it keeps miscategorizing.

## Notes

- Requires Citizens Bank CSV columns; adjust `DESCRIPTION_COL` / `AMOUNT_COL` in script 1 if your bank's export differs.
- Sensitive columns are stripped automatically on import.