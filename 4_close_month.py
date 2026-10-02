import pandas as pd
import os
import shutil
from datetime import datetime

PROCESSED_FILE = "output_master_data/processed_current_month.csv"
MASTER_FILE    = "output_master_data/all_time_finances.csv"
INPUT_FOLDER   = "inputs/current_month"
ARCHIVE_FOLDER = "inputs/past_months"

MASTER_COLS = ['Transaction Type', 'Date', 'Description', 'Amount',
               'Reference No.', 'Credits', 'Debits', 'Cleaned Merchant', 'AI Category', 'Notes']

# ── Key normalization (mirrors scripts 1 & 3) ─────────────────────────────────

def _norm_key(date_val, desc_val, amt_val):
    try:
        date_str = pd.to_datetime(str(date_val), format='mixed', errors='coerce').strftime('%d-%b-%y')
        if date_str == 'NaT':
            date_str = str(date_val).strip()
    except Exception:
        date_str = str(date_val).strip()
    try:
        amt_str = f"{float(str(amt_val).replace('$', '').replace(',', '').strip()):.2f}"
    except Exception:
        amt_str = str(amt_val).strip()
    desc_str = str(desc_val).strip().strip('"')
    return (date_str, desc_str, amt_str)

def load_existing_keys(master_file):
    if not os.path.exists(master_file):
        return set()
    try:
        df = pd.read_csv(master_file)
        df.columns = df.columns.str.strip()
        return {_norm_key(r['Date'], r['Description'], r['Amount']) for _, r in df.iterrows()}
    except Exception:
        return set()

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    # 1. Check processed file exists and has data
    if not os.path.exists(PROCESSED_FILE):
        print(f"[!] {PROCESSED_FILE} not found. Run script 3 first to generate it.")
        return

    proc_df = pd.read_csv(PROCESSED_FILE)
    proc_df.columns = proc_df.columns.str.strip()

    if proc_df.empty:
        print("[!] processed_current_month.csv is empty. Nothing to close.")
        return

    # 2. Detect the month from the data
    dates = pd.to_datetime(proc_df['Date'], format='mixed', errors='coerce').dropna()
    if dates.empty:
        print("[!] Could not parse any dates in processed file.")
        return
    month_period = dates.dt.to_period('M').mode()[0]
    month_label  = month_period.strftime('%B %Y')       # e.g. "June 2026"
    month_slug   = str(month_period).replace('-', '_')  # e.g. "2026_06"

    print(f"\n{'='*52}")
    print(f"  CLOSE MONTH — {month_label}")
    print(f"{'='*52}")

    # 3. Deduplicate against master
    print(f"\n[*] Checking for duplicates against {MASTER_FILE} ...")
    existing_keys = load_existing_keys(MASTER_FILE)
    if existing_keys:
        print(f"[*] Master has {len(existing_keys)} existing transactions.")

    def make_key(row):
        return _norm_key(row['Date'], row['Description'], row['Amount'])

    is_new   = ~proc_df.apply(make_key, axis=1).isin(existing_keys)
    new_rows = proc_df[is_new].copy()
    skipped  = int((~is_new).sum())

    if skipped:
        print(f"[*] {skipped} row(s) already in master — will be skipped.")

    # 4. Show summary of what will be added
    if new_rows.empty:
        print("[!] All transactions are already in the master. Nothing new to append.")
    else:
        print(f"\n[*] {len(new_rows)} new transaction(s) to add:\n")
        if 'AI Category' in new_rows.columns:
            exp = new_rows[new_rows['Amount'].astype(float) < 0]
            inc = new_rows[new_rows['Amount'].astype(float) > 0]
            summary = new_rows.groupby('AI Category').agg(
                count=('Amount', 'count'),
                total=('Amount', 'sum')
            )
            print(f"  {'Category':<22} {'Txns':>5}   {'Total':>10}")
            print(f"  {'-'*42}")
            for cat, row in summary.iterrows():
                sign = '+' if row['total'] > 0 else '-'
                print(f"  {cat:<22} {int(row['count']):>5}   {sign}${abs(row['total']):>8,.2f}")
            print(f"  {'-'*42}")
            total_exp = float(exp['Amount'].sum())
            total_inc = float(inc['Amount'].sum())
            net = total_inc + total_exp
            print(f"  {'Net':<22} {'':>5}   {'+' if net >= 0 else '-'}${abs(net):>8,.2f}")

    # 5. Check for bank CSV in current_month folder to archive
    csv_files = [f for f in os.listdir(INPUT_FOLDER) if f.lower().endswith('.csv')] if os.path.exists(INPUT_FOLDER) else []
    archive_csv_name = f"{month_slug}_closed.csv"

    print(f"\n[*] After confirmation, this script will:")
    if not new_rows.empty:
        print(f"    • Append {len(new_rows)} transaction(s) to {MASTER_FILE}")
    if csv_files:
        print(f"    • Archive {csv_files[0]} → {ARCHIVE_FOLDER}/{archive_csv_name}")
    archive_proc_name = f"output_master_data/processed_{month_slug}.csv"
    print(f"    • Archive processed file → {archive_proc_name}")
    print(f"    • Clear inputs/current_month/ for next month")

    # 6. Confirm
    print()
    confirm = input("Proceed? [y/N] ").strip().lower()
    if confirm != 'y':
        print("Aborted — no changes made.")
        return

    # 7. Append new rows to master
    if not new_rows.empty:
        for col in MASTER_COLS:
            if col not in new_rows.columns:
                new_rows[col] = ''
        # Ensure dates are in DD-Mmm-YY format
        new_rows['Date'] = pd.to_datetime(new_rows['Date'], format='mixed', errors='coerce').dt.strftime('%d-%b-%y')
        file_exists = os.path.exists(MASTER_FILE)
        new_rows[MASTER_COLS].to_csv(MASTER_FILE, mode='a', index=False, header=not file_exists)
        print(f"\n[*] {len(new_rows)} transaction(s) appended to {MASTER_FILE}")

    # 8. Archive raw bank CSV
    os.makedirs(ARCHIVE_FOLDER, exist_ok=True)
    for csv_file in csv_files:
        src = os.path.join(INPUT_FOLDER, csv_file)
        dst = os.path.join(ARCHIVE_FOLDER, archive_csv_name)
        shutil.move(src, dst)
        print(f"[*] Archived bank CSV → {dst}")

    # 9. Archive processed_current_month.csv
    if os.path.exists(PROCESSED_FILE):
        shutil.copy(PROCESSED_FILE, archive_proc_name)
        os.remove(PROCESSED_FILE)
        print(f"[*] Archived processed file → {archive_proc_name}")

    print(f"\n{'='*52}")
    print(f"  {month_label} closed successfully!")
    print(f"  Drop next month's bank CSV into '{INPUT_FOLDER}/' when ready.")
    print(f"{'='*52}\n")

if __name__ == '__main__':
    main()
