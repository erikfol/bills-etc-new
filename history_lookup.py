"""History-first categorization: reuse the category you've already given a merchant.

Keep merchant_key() identical to merchantKey() in docs/js/history.js.
"""
import os
import re
from collections import Counter, defaultdict

import pandas as pd


def merchant_key(description):
    """"TST* JOES PIZZA 1234 HANOVER NH" -> "TST JOES PIZZA": letters only, first 3 words."""
    s = str(description).upper()
    s = re.sub(r'\d+', ' ', s)
    s = re.sub(r'[^A-Z ]', ' ', s)
    return ' '.join(s.split()[:3])


def build_history(df):
    """
    {merchant_key: (category, cleaned_merchant)} from categorized rows. A merchant is only
    included when one category holds a strict majority of its rows, so ambiguous ones still go to the AI.
    """
    cats = defaultdict(Counter)
    merchants = defaultdict(Counter)
    if df is None or 'AI Category' not in df.columns:
        return {}
    has_merchant = 'Cleaned Merchant' in df.columns
    for _, r in df.iterrows():
        key = merchant_key(r['Description'])
        cat = '' if pd.isna(r['AI Category']) else str(r['AI Category']).strip()
        if not key or not cat:
            continue
        cats[key][cat] += 1
        m = r['Cleaned Merchant'] if has_merchant and not pd.isna(r['Cleaned Merchant']) else ''
        merchants[(key, cat)][str(m).strip()] += 1

    lookup = {}
    for key, counter in cats.items():
        cat, n = counter.most_common(1)[0]
        if n * 2 <= sum(counter.values()):
            continue
        lookup[key] = (cat, merchants[(key, cat)].most_common(1)[0][0])
    return lookup


def load_history(master_file):
    if not os.path.exists(master_file):
        return {}
    df = pd.read_csv(master_file)
    df.columns = df.columns.str.strip()
    return build_history(df)
