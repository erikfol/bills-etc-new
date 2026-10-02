import pandas as pd
import json
import os
import argparse
from history_lookup import merchant_key, load_history
import calendar
from datetime import datetime, date

CONFIG_FILE      = "config.json"
MASTER_FILE      = "output_master_data/all_time_finances.csv"
INPUT_FOLDER     = "inputs/current_month"
CACHE_FILE       = "output_master_data/categorized_cache.csv"
PROCESSED_FILE   = "output_master_data/processed_current_month.csv"
REPORTS_FOLDER   = "reports"
MODEL_NAME       = "qwen2.5:3b"

# ── Category helpers (mirrors scripts 01/02) ────────────────────────────────

ALLOWED_CATEGORIES_LIST = ["Groceries", "Dining Out", "Utilities", "Rent/Mortgage",
                            "Entertainment", "Shopping", "Transport", "Gas", "Income",
                            "Savings", "Miscellaneous", "Credit Card"]

CATEGORY_MAP = {
    'grocery': 'Groceries', 'groceries': 'Groceries',
    'mortgage': 'Rent/Mortgage', 'rent': 'Rent/Mortgage',
    'dining': 'Dining Out', 'restaurant': 'Dining Out', 'food': 'Dining Out',
    'entertainment': 'Entertainment', 'streaming': 'Entertainment',
    'utility': 'Utilities', 'utilities': 'Utilities', 'internet': 'Utilities',
    'cable': 'Utilities', 'phone': 'Utilities',
    'shopping': 'Shopping', 'shop': 'Shopping', 'retail': 'Shopping', 'electronics': 'Shopping',
    'transport': 'Transport', 'transportation': 'Transport', 'gas': 'Gas', 'fuel': 'Gas',
    'income': 'Income', 'payroll': 'Income', 'salary': 'Income',
    'savings': 'Savings', 'saving': 'Savings',
    'miscellaneous': 'Miscellaneous', 'misc': 'Miscellaneous', 'other': 'Miscellaneous',
}

CATEGORY_OVERRIDES = [
    ('ROCKET MORTGAGE',       'Rent/Mortgage'),
    ('NSM DBAMR',             'Rent/Mortgage'),
    ('CRCARDPMT',             'Credit Card'),
    ('CARD PYMT',             'Credit Card'),
    ('BEST BUY AUTO PYMT',    'Credit Card'),
    ('AMZ_STORECRD_PMT',      'Credit Card'),
    ('MORI LOAN',             'Miscellaneous'),
    ('EXCHANGE FEE',          'Miscellaneous'),
    ('OVERDRAFT',             'Miscellaneous'),
    ('ATM FEE',               'Miscellaneous'),
    ('IC FEE',                'Miscellaneous'),
    ('PEACE OF MIND REBATE',  'Miscellaneous'),
    ('PASSPORTSERVICES',      'Miscellaneous'),
    ('REAL ESTAT',            'Miscellaneous'),
    ('T.O.H.',                'Miscellaneous'),
    ('TO SAVINGS',            'Savings'),
    ('TO CHECKING',           'Miscellaneous'),
    ('FROM SAVINGS',          'Miscellaneous'),
    ('SCHEDULED TRANSFER',    'Miscellaneous'),
    ('CLEAN ENERGY LOAN',     'Utilities'),
    ('COMCAST',               'Utilities'),
    ('XFINITY',               'Utilities'),
    ('LIBERTY UTILITIE',      'Utilities'),
    ('STRAIGHTTALK',          'Utilities'),
    ('IRVING OIL',            'Gas'),
    ('NH TURNPIKE',           'Transport'),
    ('VACASA',                'Entertainment'),
    ('VRBO',                  'Entertainment'),
    ('PAYROLL',               'Income'),
    ('IRS TREAS',             'Income'),
]

def normalize_category(cat):
    cat = str(cat).strip()
    if cat in ALLOWED_CATEGORIES_LIST:
        return cat
    for word in cat.lower().replace('/', ' ').replace('-', ' ').split():
        if word in CATEGORY_MAP:
            return CATEGORY_MAP[word]
    return 'Miscellaneous'

def apply_overrides(description, category):
    desc_upper = str(description).upper()
    for keyword, forced in CATEGORY_OVERRIDES:
        if keyword.upper() in desc_upper:
            return forced
    return category

# Overrides that force BOTH merchant name AND category
MERCHANT_CATEGORY_OVERRIDES = [
    # (substring, merchant_name, category)
    ('AWS',                 'Amazon AWS',   'Utilities'),
    ('AMAZON WEB',          'Amazon AWS',   'Utilities'),
    ('EXCHANGE FEE',        'Exchange Fee', 'Miscellaneous'),
    ('DISNEY MOUNTAIN VIEW','Disney Plus',          'Entertainment'),
    ('TRAVELERS',           'Travelers Insurance',  'Transport'),
    ('DUNKIN',              'Dunkin',               'Dining Out'),
]

def apply_merchant_cat_overrides(description):
    """If description matches a merchant+category pattern, return (merchant, category); else (None, None)."""
    desc_upper = str(description).upper()
    for keyword, merchant, category in MERCHANT_CATEGORY_OVERRIDES:
        if keyword in desc_upper:
            return merchant, category
    return None, None

def lookup_history(history, description):
    """(merchant, category) from merchant overrides or your history; (None, None) if the merchant is new."""
    mc_merchant, mc_category = apply_merchant_cat_overrides(description)
    if mc_merchant:
        return mc_merchant, mc_category
    hit = history.get(merchant_key(description))
    if not hit:
        return None, None
    category, merchant = hit
    return (merchant or str(description)), apply_overrides(description, category)

# ── AI categorization ────────────────────────────────────────────────────────

def ask_local_ai(description, amount):
    import ollama
    prompt = f"""
You are a precise bank transaction categorizer. Analyze this transaction: "{description}" (${amount})

Respond ONLY in this exact format, nothing else:
Merchant: [clean name] | Category: [category]

CATEGORY DEFINITIONS — pick the single best match:
- Groceries: Supermarkets, grocery stores
- Dining Out: Restaurants, fast food, cafes, bars, coffee shops
- Utilities: Electric, gas, water, internet, cable, phone bills, energy-related loans
- Rent/Mortgage: Primary home mortgage or rent payment ONLY
- Entertainment: Streaming (Netflix, Hulu, Spotify, Disney+), vacation rentals, movies, concerts
- Shopping: Retail stores, Amazon, clothing, electronics, home goods
- Gas: Gas stations and fuel purchases (Irving Oil, Jiffy Mart, any fuel/petrol charge)
- Transport: Auto loans, parking, tolls, rideshare — NOT fuel
- Income: Payroll direct deposits, tax refunds
- Savings: Transfers TO a savings account
- Credit Card: Credit card payments (Capital One, Citizens Bank, Best Buy card, Amazon store card — CRCARDPMT, CARD PYMT, etc.)
- Miscellaneous: Bank fees, loan repayments, property tax, anything else
"""
    try:
        response = ollama.generate(model=MODEL_NAME, prompt=prompt)
        parts    = response['response'].strip().split('|')
        merchant = parts[0].replace("Merchant:", "").strip()
        category = apply_overrides(description,
                                   normalize_category(parts[1].replace("Category:", "").strip()))
        desc_lower = description.lower()
        if 'onlyfans'              in desc_lower: merchant = 'OF'
        elif 'to savings'          in desc_lower: merchant = 'TO SAVINGS'
        elif 'tomtom' in desc_lower or 'tom tom' in desc_lower: merchant = 'TOMTOM'
        elif 'irving'              in desc_lower: merchant = 'Irving Gas'
        elif 'mori'                in desc_lower: merchant = 'Marriott Loan'
        mc_merchant, mc_category = apply_merchant_cat_overrides(description)
        if mc_merchant:
            return mc_merchant, mc_category
        return merchant, category
    except Exception as e:
        print(f"  [AI error] {description}: {e}")
        mc_merchant, mc_category = apply_merchant_cat_overrides(description)
        if mc_merchant:
            return mc_merchant, mc_category
        return description, apply_overrides(description, 'Miscellaneous')

# ── Cache helpers ────────────────────────────────────────────────────────────

def load_cache():
    if not os.path.exists(CACHE_FILE):
        return pd.DataFrame(columns=['Date', 'Description', 'Amount', 'AI Category', 'Cleaned Merchant'])
    df = pd.read_csv(CACHE_FILE)
    df.columns = df.columns.str.strip()
    return df

def save_cache(new_rows, existing_cache):
    if not new_rows:
        return
    new_df = pd.DataFrame(new_rows)
    combined = pd.concat([existing_cache, new_df], ignore_index=True)
    combined.to_csv(CACHE_FILE, index=False)
    print(f"[*] Cache updated: {len(new_rows)} new transaction(s) saved to {CACHE_FILE}")

# ── Config loader ────────────────────────────────────────────────────────────

def load_config():
    with open(CONFIG_FILE, encoding='utf-8') as f:
        cfg = json.load(f)

    monthly_income = sum(
        v for k, v in cfg.items()
        if k.startswith('monthly_income') and not k.startswith('_') and isinstance(v, (int, float))
    )

    fixed = {
        k: v for k, v in cfg.get('fixed_expenses', {}).items()
        if not k.startswith('_') and isinstance(v, (int, float))
    }

    variable_cats = [
        c for c in cfg.get('variable_categories', [])
        if isinstance(c, str) and not c.startswith('_')
    ]

    return monthly_income, fixed, variable_cats

# ── Historical averages ──────────────────────────────────────────────────────

def get_historical_averages(variable_cats):
    """Returns (avg_dict, n_months). Current month is excluded so partial data doesn't skew the baseline."""
    if not os.path.exists(MASTER_FILE):
        return {c: 0.0 for c in variable_cats}, 0
    df = pd.read_csv(MASTER_FILE)
    df.columns = df.columns.str.strip()
    df['Date'] = pd.to_datetime(df['Date'], format='mixed', errors='coerce')
    df['YearMonth'] = df['Date'].dt.to_period('M')
    current_ym = pd.Period(date.today(), 'M')
    df = df[df['YearMonth'] != current_ym]
    exp = df[df['AI Category'] != 'Income']
    monthly = exp.groupby(['YearMonth', 'AI Category'])['Amount'].sum().abs().unstack(fill_value=0)
    n_months = len(monthly)
    avgs = {cat: round(float(monthly[cat].mean()), 2) if cat in monthly.columns else 0.0
            for cat in variable_cats}
    return avgs, n_months

# ── HTML report ──────────────────────────────────────────────────────────────

def generate_html(monthly_income, fixed, variable_cats, variable_spent,
                  projected_variable, hist_avgs, hist_months, today, days_elapsed, days_in_month, df):

    total_fixed            = sum(fixed.values())
    total_proj_variable    = sum(projected_variable.values())
    total_projected        = total_fixed + total_proj_variable
    surplus_deficit        = monthly_income - total_projected
    sd_color               = '#27ae60' if surplus_deficit >= 0 else '#e74c3c'
    sd_label               = 'Projected Surplus' if surplus_deficit >= 0 else 'Projected Deficit'
    pct_month              = round(days_elapsed / days_in_month * 100)
    generated              = datetime.now().strftime('%B %d, %Y at %I:%M %p')
    month_label            = today.strftime('%B %Y')

    # Fixed expenses rows
    fixed_rows = ''
    for name, amt in fixed.items():
        display = name.replace('_', ' ')
        fixed_rows += f'<tr><td>{display}</td><td class="amt">${amt:,.2f}</td></tr>'
    fixed_rows += f'<tr class="total-row"><td><strong>Total Fixed</strong></td><td class="amt"><strong>${total_fixed:,.2f}</strong></td></tr>'

    # Variable spending rows
    def status_badge(proj, hist):
        if hist == 0:
            return '<span class="badge badge-neutral">No history</span>'
        ratio = proj / hist
        if ratio <= 1.10:
            return '<span class="badge badge-ok">On track</span>'
        elif ratio <= 1.40:
            return '<span class="badge badge-warn">Watch</span>'
        else:
            return '<span class="badge badge-over">Over</span>'

    var_rows = ''
    for cat in variable_cats:
        spent = variable_spent.get(cat, 0)
        proj  = projected_variable.get(cat, 0)
        hist  = hist_avgs.get(cat, 0)
        badge = status_badge(proj, hist)
        hist_str = f'${hist:,.2f}' if hist > 0 else '—'
        if hist > 0:
            delta = proj - hist
            delta_str  = f'{"+" if delta >= 0 else ""}${delta:,.2f}'
            delta_color = '#e74c3c' if delta > 0 else '#27ae60'
            delta_html  = f'<span style="color:{delta_color};font-family:monospace">{delta_str}</span>'
        else:
            delta_html = '<span class="muted">—</span>'
        var_rows += f'''<tr>
            <td>{cat}</td>
            <td class="amt">${spent:,.2f}</td>
            <td class="amt"><strong>${proj:,.2f}</strong></td>
            <td class="amt muted">{hist_str}</td>
            <td class="amt">{delta_html}</td>
            <td>{badge}</td>
        </tr>'''
    var_rows += f'<tr class="total-row"><td><strong>Total Variable (projected)</strong></td><td></td><td class="amt"><strong>${total_proj_variable:,.2f}</strong></td><td></td><td></td><td></td></tr>'

    sd_fmt = f'{"+" if surplus_deficit >= 0 else "-"}${abs(surplus_deficit):,.2f}'

    # Transaction data rows
    tx_rows = ''
    use_cleaned = 'Cleaned Merchant' in df.columns
    for _, row in df.sort_values('Date').iterrows():
        amt       = row['Amount']
        amt_class = 'income-amt' if amt > 0 else 'expense-amt'
        amt_fmt   = f'+${amt:,.2f}' if amt > 0 else f'-${abs(amt):,.2f}'
        merchant  = row['Cleaned Merchant'] if use_cleaned else row['Description']
        cat       = str(row.get('AI Category', ''))
        source    = str(row.get('_source', ''))
        cat_extra = ''
        if cat == 'Credit Card': cat_extra = ' credit-card'
        elif cat == 'Income':    cat_extra = ' income'
        src_tag = ''
        if source == 'edited':     src_tag = '<span class="source-tag source-edited">edited</span>'
        elif source == 'history':  src_tag = '<span class="source-tag source-history">history</span>'
        elif source == 'cache':    src_tag = '<span class="source-tag source-cache">cache</span>'
        elif source == 'ai':       src_tag = '<span class="source-tag source-ai">AI</span>'
        elif source == 'rules':    src_tag = '<span class="source-tag source-rules">rules</span>'
        tx_rows += f'''<tr>
            <td>{row["Date"]}</td>
            <td>{row["Description"]}</td>
            <td>{merchant}</td>
            <td class="{amt_class}">{amt_fmt}</td>
            <td><span class="cat-badge{cat_extra}">{cat}</span></td>
            <td>{src_tag}</td>
        </tr>'''
    tx_count = len(df)

    html = f'''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Current Month Projection — {month_label}</title>
    <style>
        * {{ box-sizing: border-box; margin: 0; padding: 0; }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 900px; margin: 40px auto; padding: 0 24px 60px;
            color: #2d2d2d; background: #f5f7fa;
        }}
        .header {{
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            color: white; padding: 28px 32px; border-radius: 12px; margin-bottom: 24px;
        }}
        .header h1 {{ font-size: 1.6em; font-weight: 700; }}
        .header p {{ color: #aab4c8; margin-top: 6px; font-size: 0.88em; }}
        .cards {{
            display: grid; grid-template-columns: repeat(3, 1fr);
            gap: 14px; margin-bottom: 24px;
        }}
        .card {{
            background: white; border-radius: 10px; padding: 18px 22px;
            box-shadow: 0 1px 4px rgba(0,0,0,0.08);
        }}
        .card .label {{ font-size: 0.78em; text-transform: uppercase; letter-spacing: 0.5px; color: #888; }}
        .card .value {{ font-size: 1.55em; font-weight: 700; margin-top: 6px; }}
        .card .sub {{ font-size: 0.78em; color: #aaa; margin-top: 4px; }}
        section {{
            background: white; border-radius: 10px; padding: 22px 26px;
            margin-bottom: 18px; box-shadow: 0 1px 4px rgba(0,0,0,0.08);
        }}
        section h2 {{
            font-size: 1.0em; text-transform: uppercase; letter-spacing: 0.5px;
            color: #555; margin-bottom: 14px; padding-bottom: 10px;
            border-bottom: 2px solid #f0f0f0;
        }}
        .progress-wrap {{ margin-bottom: 22px; }}
        .progress-label {{
            display: flex; justify-content: space-between;
            font-size: 0.82em; color: #777; margin-bottom: 6px;
        }}
        .progress-bar {{
            height: 10px; background: #eee; border-radius: 10px; overflow: hidden;
        }}
        .progress-fill {{
            height: 100%; border-radius: 10px;
            background: linear-gradient(90deg, #4a90d9, #5ba3e8);
            width: {pct_month}%;
        }}
        table {{ border-collapse: collapse; width: 100%; font-size: 0.92em; }}
        th {{
            background: #f0f4ff; color: #444; padding: 9px 13px;
            text-align: left; font-weight: 600; border-bottom: 2px solid #dde3f0;
        }}
        td {{ padding: 8px 13px; border-bottom: 1px solid #f4f4f4; }}
        tr:last-child td {{ border-bottom: none; }}
        tr:hover td {{ background: #fafbff; }}
        tr.total-row td {{ background: #f8faff; border-top: 2px solid #dde3f0; }}
        .amt {{ text-align: right; font-family: monospace; }}
        .muted {{ color: #aaa; }}
        .badge {{
            display: inline-block; padding: 2px 9px; border-radius: 12px;
            font-size: 0.78em; font-weight: 600;
        }}
        .badge-ok      {{ background: #e8f8ef; color: #27ae60; }}
        .badge-warn    {{ background: #fff8e1; color: #e67e22; }}
        .badge-over    {{ background: #fdecea; color: #e74c3c; }}
        .badge-neutral {{ background: #f0f0f0; color: #999; }}
        .footer {{ text-align: center; color: #aaa; font-size: 0.78em; margin-top: 28px; }}
        .note {{ font-size: 0.82em; color: #999; margin-top: 10px; font-style: italic; }}
        .income-amt {{ color: #27ae60; font-weight: 600; font-family: monospace; }}
        .expense-amt {{ color: #e74c3c; font-family: monospace; }}
        .cat-badge {{
            background: #f0f4ff; color: #3a5ca8; border-radius: 4px;
            padding: 2px 8px; font-size: 0.8em; font-weight: 500; white-space: nowrap;
        }}
        .cat-badge.credit-card {{ background: #fff0f6; color: #c0392b; }}
        .cat-badge.income      {{ background: #e8f8ef; color: #27ae60; }}
        .source-tag {{ font-size: 0.75em; padding: 1px 6px; border-radius: 10px; font-weight: 500; }}
        .source-edited {{ background: #f3e8ff; color: #7b2ff7; font-weight: 600; }}
        .source-ai     {{ background: #e8f0fe; color: #3a5ca8; }}
        .source-history {{ background: #e6f7f7; color: #138d8d; }}
        .source-cache  {{ background: #e8f8ef; color: #27ae60; }}
        .source-rules  {{ background: #fff8e1; color: #e67e22; }}
    </style>
</head>
<body>
    <div class="header">
        <h1>Current Month Projection — {month_label}</h1>
        <p>Day {days_elapsed} of {days_in_month} &nbsp;·&nbsp; {pct_month}% through the month &nbsp;·&nbsp; Generated {generated}</p>
    </div>

    <div class="cards">
        <div class="card">
            <div class="label">Expected Income</div>
            <div class="value" style="color:#2980b9">${monthly_income:,.2f}</div>
            <div class="sub">per month</div>
        </div>
        <div class="card">
            <div class="label">Total Projected Spend</div>
            <div class="value" style="color:#e74c3c">${total_projected:,.2f}</div>
            <div class="sub">fixed + variable projection</div>
        </div>
        <div class="card">
            <div class="label">{sd_label}</div>
            <div class="value" style="color:{sd_color}">{sd_fmt}</div>
            <div class="sub">end-of-month estimate</div>
        </div>
    </div>

    <section>
        <h2>Month Progress</h2>
        <div class="progress-wrap">
            <div class="progress-label">
                <span>Day {days_elapsed} of {days_in_month}</span>
                <span>{pct_month}% elapsed</span>
            </div>
            <div class="progress-bar"><div class="progress-fill"></div></div>
        </div>
        <p class="note">Variable spending is projected by scaling your current pace to the full month:
        (spent ÷ {days_elapsed} days) × {days_in_month} days.</p>
    </section>

    <section>
        <h2>Fixed Expenses <span style="font-weight:400;font-size:0.85em;color:#aaa;text-transform:none">(from config)</span></h2>
        <table>
            <thead><tr><th>Item</th><th style="text-align:right">Monthly Amount</th></tr></thead>
            <tbody>{fixed_rows}</tbody>
        </table>
    </section>

    <section>
        <h2>Variable Spending</h2>
        <table>
            <thead>
                <tr>
                    <th>Category</th>
                    <th style="text-align:right">Spent So Far</th>
                    <th style="text-align:right">Projected Full Month</th>
                    <th style="text-align:right">Hist Avg ({hist_months} mo)</th>
                    <th style="text-align:right">vs Avg</th>
                    <th>Status</th>
                </tr>
            </thead>
            <tbody>{var_rows}</tbody>
        </table>
        <p class="note">Projection = (spent ÷ {days_elapsed} days) × {days_in_month} days. Historical avg covers {hist_months} completed month(s); current month excluded to keep the baseline clean.</p>
    </section>

    <section>
        <h2>Transaction Data <span style="font-weight:400;font-size:0.85em;color:#aaa;text-transform:none">({tx_count} rows)</span></h2>
        <table>
            <thead>
                <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th>Merchant</th>
                    <th style="text-align:right">Amount</th>
                    <th>Category</th>
                    <th>Source</th>
                </tr>
            </thead>
            <tbody>{tx_rows}</tbody>
        </table>
        <p class="note">Source: <span class="source-tag source-edited">edited</span> = your manual edit &nbsp; <span class="source-tag source-history">history</span> = same category as this merchant in your history &nbsp; <span class="source-tag source-cache">cache</span> = AI-categorized on a previous run &nbsp; <span class="source-tag source-ai">AI</span> = AI-categorized this run &nbsp; <span class="source-tag source-rules">rules</span> = override/keyword rules only</p>
    </section>

    <div class="footer">BillsEtc 2.0 &mdash; 100% offline &mdash; {generated}</div>
</body>
</html>'''

    return html

# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='Project current month spending.')
    parser.add_argument('--ai', action='store_true',
                        help='Use Ollama AI to categorize uncached transactions (result is cached for future runs)')
    args = parser.parse_args()

    if not os.path.exists(CONFIG_FILE):
        print(f"Error: {CONFIG_FILE} not found. Run from the BillsEtc_2.0 directory.")
        return

    monthly_income, fixed, variable_cats = load_config()

    if monthly_income == 0:
        print("Warning: monthly_income is 0 in config.json. Update it before trusting the projection.")

    # Load current month CSV
    os.makedirs(INPUT_FOLDER, exist_ok=True)
    csv_files = [f for f in os.listdir(INPUT_FOLDER) if f.lower().endswith('.csv')]
    if not csv_files:
        print(f"No CSV found in '{INPUT_FOLDER}/'. Drop your current month bank export there and re-run.")
        return
    if len(csv_files) > 1:
        print(f"Multiple CSVs found in '{INPUT_FOLDER}/'. Please keep only one file there.")
        return

    file_path = os.path.join(INPUT_FOLDER, csv_files[0])
    print(f"[*] Loading {csv_files[0]} ...")
    df = pd.read_csv(file_path)
    df.columns = df.columns.str.strip()

    # Normalize dates to DD-Mmm-YY string (used as cache key + display)
    if 'Date' in df.columns:
        df['Date'] = pd.to_datetime(df['Date'], format='mixed', errors='coerce').dt.strftime('%d-%b-%y')

    # Drop sensitive columns
    sensitive = ['account', 'routing', 'balance', 'card number', 'ssn', 'address']
    df.drop(columns=[c for c in df.columns if any(s in c.lower() for s in sensitive)], inplace=True)

    # ── Categorization: processed file → history → cache → AI (if --ai) → rules ────────

    def make_key(date_val, desc_val, amt_val):
        """Normalize all three components so Excel reformatting doesn't break matches."""
        # Date → always DD-Mmm-YY
        try:
            date_str = pd.to_datetime(str(date_val), format='mixed', errors='coerce').strftime('%d-%b-%y')
        except Exception:
            date_str = str(date_val).strip()
        # Amount → strip currency symbols/commas, round to 2dp float string
        try:
            amt_str = f"{float(str(amt_val).replace('$','').replace(',','').strip()):.2f}"
        except Exception:
            amt_str = str(amt_val).strip()
        desc_str = str(desc_val).strip().strip('"')
        return (date_str, desc_str, amt_str)

    # Load processed CSV — user may have manually edited categories here
    processed_lookup = {}
    if os.path.exists(PROCESSED_FILE):
        proc_df = pd.read_csv(PROCESSED_FILE)
        proc_df.columns = proc_df.columns.str.strip()
        for _, prow in proc_df.iterrows():
            key = make_key(prow['Date'], prow['Description'], prow['Amount'])
            processed_lookup[key] = (str(prow['AI Category']).strip(), str(prow['Cleaned Merchant']).strip())
        print(f"[*] Loaded {len(processed_lookup)} row(s) from processed file (manual edits preserved).")

    # Load AI cache
    cache_df     = load_cache()
    cache_lookup = {}
    for _, crow in cache_df.iterrows():
        key = make_key(crow['Date'], crow['Description'], crow['Amount'])
        cache_lookup[key] = (str(crow['AI Category']), str(crow['Cleaned Merchant']))

    history = load_history(MASTER_FILE)

    categories     = []
    merchants      = []
    new_cache_rows = []
    sources        = []
    cached_hits    = 0
    edited_hits    = 0
    history_hits   = 0

    for _, row in df.iterrows():
        key = make_key(row['Date'], row['Description'], row['Amount'])
        if key in processed_lookup:
            cat, merchant = processed_lookup[key]
            edited_hits += 1
            sources.append('edited')
        elif lookup_history(history, row['Description'])[0] is not None:
            merchant, cat = lookup_history(history, row['Description'])
            history_hits += 1
            sources.append('history')
        elif key in cache_lookup:
            cat, merchant = cache_lookup[key]
            cached_hits += 1
            sources.append('cache')
        elif args.ai:
            print(f"  [AI] Categorizing: {row['Description']} (${row['Amount']})")
            merchant, cat = ask_local_ai(row['Description'], row['Amount'])
            if merchant_key(row['Description']):
                history[merchant_key(row['Description'])] = (cat, merchant)
            new_cache_rows.append({
                'Date': key[0], 'Description': key[1], 'Amount': key[2],
                'AI Category': cat, 'Cleaned Merchant': merchant,
            })
            sources.append('ai')
        else:
            mc_merchant, mc_category = apply_merchant_cat_overrides(row['Description'])
            if mc_merchant:
                cat, merchant = mc_category, mc_merchant
            else:
                cat      = apply_overrides(row['Description'],
                                           normalize_category(str(row.get('Description', ''))))
                merchant = str(row.get('Description', ''))
            sources.append('rules')
        categories.append(cat)
        merchants.append(merchant)

    df['AI Category']      = categories
    df['Cleaned Merchant'] = merchants
    df['_source']          = sources

    if edited_hits:
        print(f"[*] {edited_hits} transaction(s) loaded from processed file (including any manual edits).")
    if history_hits:
        print(f"[*] {history_hits} transaction(s) categorized from your history.")
    if cached_hits:
        print(f"[*] {cached_hits} transaction(s) served from AI cache.")
    if new_cache_rows:
        save_cache(new_cache_rows, cache_df)
    if not args.ai and (len(df) - edited_hits - history_hits - cached_hits) > 0:
        uncached = len(df) - edited_hits - history_hits - cached_hits
        print(f"[!] {uncached} transaction(s) used override-only categorization. Run with --ai to improve accuracy.")

    # ── Save processed CSV (same format as all_time_finances.csv) ─────────────
    master_cols = ['Transaction Type', 'Date', 'Description', 'Amount',
                   'Reference No.', 'Credits', 'Debits', 'Cleaned Merchant', 'AI Category', 'Notes']
    processed_out = df.copy()
    if 'Notes' not in processed_out.columns:
        processed_out['Notes'] = ''
    for col in master_cols:
        if col not in processed_out.columns:
            processed_out[col] = ''
    os.makedirs(os.path.dirname(PROCESSED_FILE), exist_ok=True)
    processed_out[master_cols].to_csv(PROCESSED_FILE, index=False)
    print(f"[*] Processed data saved: {PROCESSED_FILE}  ← edit categories here, then re-run")

    # Date math
    today         = date.today()
    days_in_month = calendar.monthrange(today.year, today.month)[1]
    days_elapsed  = today.day

    print(f"[*] Day {days_elapsed} of {days_in_month} ({round(days_elapsed/days_in_month*100)}% through {today.strftime('%B %Y')})")

    # Variable spending so far (expenses only)
    exp_df = df[(df['AI Category'] != 'Income') & (df['Amount'] < 0)]
    variable_spent = {
        cat: round(abs(float(exp_df[exp_df['AI Category'] == cat]['Amount'].sum())), 2)
        for cat in variable_cats
    }

    # Project to full month
    projected_variable = {
        cat: round((amt / days_elapsed) * days_in_month, 2)
        for cat, amt in variable_spent.items()
    }

    # Historical averages (current month excluded)
    print("[*] Pulling historical averages from master...")
    hist_avgs, hist_months = get_historical_averages(variable_cats)
    print(f"[*] Historical baseline: {hist_months} completed month(s) of data.")

    # Print summary to terminal
    total_fixed         = sum(fixed.values())
    total_proj_variable = sum(projected_variable.values())
    total_projected     = total_fixed + total_proj_variable
    surplus_deficit     = monthly_income - total_projected

    print(f"\n{'='*52}")
    print(f"  CURRENT MONTH PROJECTION  —  {today.strftime('%B %Y')}")
    print(f"{'='*52}")
    print(f"  Expected Income   : ${monthly_income:>10,.2f}")
    print(f"  Fixed Expenses    : ${total_fixed:>10,.2f}")
    print(f"  Variable (proj.)  : ${total_proj_variable:>10,.2f}")
    print(f"  Total Projected   : ${total_projected:>10,.2f}")
    print(f"  {'Surplus' if surplus_deficit >= 0 else 'Deficit'}            : ${surplus_deficit:>+10,.2f}")
    print(f"{'='*52}\n")

    # Generate and open HTML report
    html = generate_html(monthly_income, fixed, variable_cats, variable_spent,
                         projected_variable, hist_avgs, hist_months, today, days_elapsed, days_in_month, df)

    os.makedirs(REPORTS_FOLDER, exist_ok=True)
    out_path = os.path.join(REPORTS_FOLDER, f"{today.strftime('%Y_%m')}_projection.html")
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(html)
    print(f"[*] Projection report saved: {out_path}")

    import webbrowser
    webbrowser.open(os.path.abspath(out_path))

if __name__ == "__main__":
    main()
