import pandas as pd
import ollama
import os
from bills_config import category_settings, renamed, merchant_rules, apply_merchant_rules, rules_only, tx_type_merchant
from history_lookup import merchant_key, load_history

# --- CONFIGURATION ---
INPUT_FOLDER = "inputs/past_months"      # The folder where you drop bank CSVs
OUTPUT_FILE = "output_master_data/all_time_finances.csv" # The master file it appends to
MODEL_NAME = "qwen2.5:3b"                  # Your local Ollama model

# Tell the AI exactly what categories you want to track
ALLOWED_CATEGORIES = "Groceries, Dining Out, Utilities, Rent/Mortgage, Entertainment, Shopping, Transport, Gas, Income, Savings, Miscellaneous"
ALLOWED_CATEGORIES += ", Credit Card"
ALLOWED_CATEGORIES_LIST = [c.strip() for c in ALLOWED_CATEGORIES.split(',')]

# Your categories and renames from config.json (managed on the GUI's Config page)
ALLOWED_CATEGORIES_LIST, CATEGORY_RENAMES = category_settings(ALLOWED_CATEGORIES_LIST)
MERCHANT_RULES = merchant_rules()

CATEGORY_MAP = {
    'grocery': 'Groceries', 'groceries': 'Groceries',
    'mortgage': 'Rent/Mortgage', 'rent': 'Rent/Mortgage',
    'dining': 'Dining Out', 'restaurant': 'Dining Out', 'food': 'Dining Out',
    'entertainment': 'Entertainment', 'streaming': 'Entertainment',
    'utility': 'Utilities', 'utilities': 'Utilities', 'internet': 'Utilities', 'cable': 'Utilities', 'phone': 'Utilities',
    'shopping': 'Shopping', 'shop': 'Shopping', 'retail': 'Shopping', 'electronics': 'Shopping',
    'transport': 'Transport', 'transportation': 'Transport', 'gas': 'Gas', 'fuel': 'Gas',
    'income': 'Income', 'payroll': 'Income', 'salary': 'Income',
    'savings': 'Savings', 'saving': 'Savings',
    'miscellaneous': 'Miscellaneous', 'misc': 'Miscellaneous', 'other': 'Miscellaneous',
}

def normalize_category(cat):
    cat = renamed(CATEGORY_RENAMES, str(cat).strip())
    if cat in ALLOWED_CATEGORIES_LIST:
        return cat
    for word in cat.lower().replace('/', ' ').replace('-', ' ').split():
        if word in CATEGORY_MAP:
            return renamed(CATEGORY_RENAMES, CATEGORY_MAP[word])
    return renamed(CATEGORY_RENAMES, 'Miscellaneous')

# Merchant names and forced categories come from your merchant rules in config.json
# (GUI: Config > Merchants), applied by bills_config.apply_merchant_rules.

def lookup_history(history, description):
    """(merchant, category) from your history; (None, None) if the merchant is new or ambiguous."""
    hit = history.get(merchant_key(description))
    if not hit:
        return None, None
    category, merchant = hit
    return (merchant or str(description)), category

def ask_local_ai(description, amount):
    """Sends the transaction description to Ollama for a clean name and category."""
    
    prompt = f"""
You are a precise bank transaction categorizer. Analyze this transaction: "{description}" (${amount})

Respond ONLY in this exact format, nothing else:
Merchant: [clean name] | Category: [category]

CATEGORY DEFINITIONS — pick the single best match:
- Groceries: Supermarkets, grocery stores (Hannaford, Price Chopper, Walmart groceries)
- Dining Out: Restaurants, fast food, cafes, bars, coffee shops (McDonald's, TST*, SQ* food)
- Utilities: Electric, gas, water, internet, cable, phone bills, AND energy-related loans (CLEAN ENERGY LOAN)
- Rent/Mortgage: Primary home mortgage or rent payment ONLY (e.g. Rocket Mortgage). NOT property tax, NOT other loans, NOT vacation rentals.
- Entertainment: Streaming (Netflix, Hulu, Spotify, Disney+, YouTube), vacation rentals (Vacasa, Vrbo, Airbnb), movies, theme parks, concerts
- Shopping: Retail stores, Amazon, clothing, electronics, home goods (Target, Sierra, Home Depot)
- Gas: Gas stations and fuel purchases (Irving Oil, Jiffy Mart, any fuel/petrol charge)
- Transport: Auto loans, parking, tolls (NH Turnpike), rideshare — NOT fuel
- Income: Payroll direct deposits, tax refunds, deposits received
- Savings: Transfers TO a savings account
- Credit Card: Credit card payments (Capital One, Citizens Bank, Best Buy card, Amazon store card — anything ending in CRCARDPMT, CARD PYMT, or similar)
- Miscellaneous: Bank fees, non-mortgage loan repayments (MORI Loan, personal loans), property tax (Real Estate), exchange fees, anything else

IMPORTANT RULES:
- Credit card payments like "CAPITAL ONE CRCARDPMT" or "CITIZENSBANK NA CARD PYMT" -> always Credit Card
- Vacation rental sites like Vacasa or Vrbo -> Entertainment, not Rent/Mortgage
- Recurring non-mortgage loans like "MORI Loan Re" -> Miscellaneous
- "TOWN OF ENFIELD REAL ESTAT" (property tax) -> Miscellaneous
- Transfers "TO SAVINGS" -> Savings; transfers "TO CHECKING" or "FROM SAVINGS" -> Miscellaneous
"""
    
    try:
        response = ollama.generate(model=MODEL_NAME, prompt=prompt)
        result = response['response'].strip()
        
        # Simple parser to extract the AI's structured response
        # Expected format: "Merchant: Joe's Coffee | Category: Dining Out"
        parts = result.split('|')
        merchant = parts[0].replace("Merchant:", "").strip()
        category = normalize_category(parts[1].replace("Category:", "").strip())
        return merchant, category
    except Exception as e:
        print(f"Error processing '{description}': {e}")
        return str(description), renamed(CATEGORY_RENAMES, 'Miscellaneous')

def _norm_key(date_val, desc_val, amt_val):
    """Normalize a dedup key: date → DD-Mmm-YY, amount → float 2dp string."""
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

def load_existing_keys(output_file):
    """Returns the set of normalized (Date, Description, Amount) tuples already in the master."""
    if not os.path.exists(output_file):
        return set()
    try:
        existing = pd.read_csv(output_file)
        existing.columns = existing.columns.str.strip()
        return {_norm_key(r['Date'], r['Description'], r['Amount']) for _, r in existing.iterrows()}
    except Exception:
        return set()

def main():
    # Make sure the folders exist
    os.makedirs(INPUT_FOLDER, exist_ok=True)
    os.makedirs("output_master_data", exist_ok=True)

    # Get all CSV files in the inputs folder
    csv_files = [f for f in os.listdir(INPUT_FOLDER) if f.endswith('.csv')]

    if not csv_files:
        print(f"No CSV files found in '{INPUT_FOLDER}/'. Drop your bank statements there first!")
        return

    # --- ADJUST THESE COLUMN NAMES TO MATCH YOUR BANK'S CSV ---
    DESCRIPTION_COL = "Description"
    AMOUNT_COL = "Amount"

    # Load what's already in the master so we can skip duplicates
    existing_keys = load_existing_keys(OUTPUT_FILE)
    if existing_keys:
        print(f"Master file has {len(existing_keys)} existing transactions. Duplicates will be skipped.")
    history = load_history(OUTPUT_FILE)
    print(f"History knows {len(history)} merchant(s); only new merchants go to the AI.")

    # Loop through every file you dropped in
    for file_name in csv_files:
        file_path = os.path.join(INPUT_FOLDER, file_name)
        print(f"\n--- Processing File: {file_name} ---")

        df = pd.read_csv(file_path)

        # Normalize dates to DD-Mmm-YY before dedup and before saving
        if 'Date' in df.columns:
            df['Date'] = pd.to_datetime(df['Date'], format='mixed', errors='coerce').dt.strftime('%d-%b-%y')

        # --- SAFETY / SANITIZATION STEP ---
        sensitive_words = ['account', 'routing', 'balance', 'card number', 'ssn', 'address']
        columns_to_drop = [col for col in df.columns if any(word in col.lower() for word in sensitive_words)]
        if columns_to_drop:
            print(f"Dropping potentially sensitive columns for safety: {columns_to_drop}")
            df.drop(columns=columns_to_drop, inplace=True)

        # --- DEDUPLICATION: skip rows already in the master ---
        def make_key(row):
            return _norm_key(row['Date'], row[DESCRIPTION_COL], row[AMOUNT_COL])

        is_new = ~df.apply(make_key, axis=1).isin(existing_keys)
        skipped = (~is_new).sum()
        df = df[is_new].copy()

        if skipped:
            print(f"  Skipping {skipped} transactions already in master.")
        if df.empty:
            print(f"  Nothing new in {file_name}. Skipping.")
            continue

        ai_merchants = []
        ai_categories = []

        print(f"Processing {len(df)} new transactions (history first, then local AI)...")
        from_history = 0
        from_rules = 0
        for index, row in df.iterrows():
            desc = row[DESCRIPTION_COL]
            amt = row[AMOUNT_COL]

            clean_merchant, category = lookup_history(history, desc)
            if clean_merchant is not None:
                from_history += 1
            elif rules_only(MERCHANT_RULES, CATEGORY_RENAMES, desc)[0] is not None:
                # Your merchant rules settle both name and category: no need to ask the AI
                clean_merchant, category = rules_only(MERCHANT_RULES, CATEGORY_RENAMES, desc)
                from_rules += 1
            else:
                print(f" [AI] Analyzing: {desc} (${amt})")
                clean_merchant, category = ask_local_ai(desc, amt)
                # Remember it so repeats of this new merchant skip the model
                if merchant_key(desc):
                    history[merchant_key(desc)] = (category, clean_merchant)
            # Your merchant rules from config.json (clean name, and category if the rule has one)
            clean_merchant, category = apply_merchant_rules(MERCHANT_RULES, CATEGORY_RENAMES, clean_merchant, category, desc)
            if 'Transaction Type' in df.columns:
                clean_merchant = tx_type_merchant(row.get('Transaction Type', ''), clean_merchant)

            ai_merchants.append(clean_merchant)
            ai_categories.append(category)

        print(f"  {from_history} from history, {from_rules} by your merchant rules, {len(df) - from_history - from_rules} by AI.")

        # Append the smart local AI data back into this specific file's dataframe
        df['Cleaned Merchant'] = ai_merchants
        df['AI Category'] = ai_categories
        df['Notes'] = ''

        # Save/Append to master history file
        file_exists = os.path.exists(OUTPUT_FILE)
        df.to_csv(OUTPUT_FILE, mode='a', index=False, header=not file_exists)
        print(f"Successfully added {len(df)} new transactions from {file_name} to master history!")

    # Older masters may lack the Notes column the GUI uses.
    if os.path.exists(OUTPUT_FILE):
        master = pd.read_csv(OUTPUT_FILE)
        master.columns = master.columns.str.strip()
        if 'Notes' not in master.columns:
            master['Notes'] = ''
            master.to_csv(OUTPUT_FILE, index=False)

if __name__ == "__main__":
    main()