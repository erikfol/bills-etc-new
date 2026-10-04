"""Category settings and merchant rules from config.json, shared by the scripts and the GUI
(docs/js/categories.js, docs/js/merchants.js).

config.json may contain:
  "categories":       ["Groceries", "Dining Out", ...]   your category list
  "category_renames": {"Dining Out": "Restaurants"}     old name -> new name
  "merchant_rules":   [{"name": "Amazon", "match": ["amazon"], "bank_text": ["amazon"], "category": "Shopping"}]
                      name and category are each optional (a rule may only rename, or only set a category)
All are managed on the GUI's Config page; when absent, the scripts' built-in list is used.
"""
import json
import os
import re

CONFIG_FILE = "config.json"


def renamed(renames, category):
    """Follow renames (a -> b -> c) to the current name."""
    for _ in range(20):
        if category not in renames:
            break
        category = renames[category]
    return category


def _load_config():
    if not os.path.exists(CONFIG_FILE):
        return {}
    try:
        with open(CONFIG_FILE, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def category_settings(defaults):
    """(category_list, renames) from config.json, falling back to `defaults`."""
    cfg = _load_config()
    cats = [c.strip() for c in cfg.get('categories', []) if isinstance(c, str) and c.strip() and not c.startswith('_')]
    renames = {k: v for k, v in (cfg.get('category_renames') or {}).items()
               if not k.startswith('_') and isinstance(v, str) and v.strip()}
    cats = cats or list(defaults)
    for must in ('Income', renamed(renames, 'Miscellaneous')):
        if must not in cats:
            cats.append(must)
    return cats, renames


# ── Merchant rules (keep identical to docs/js/merchants.js) ───────────────────

def merchant_name_key(name):
    """"AMAZON.COM*2K4 #1234" -> "amazon": lower-case letters only, without www./.com/.net/.org."""
    s = str(name).lower()
    s = s.replace('www.', ' ')
    s = re.sub(r'\.(com|net|org)\b', ' ', s)
    s = re.sub(r'[^a-z]+', ' ', s)
    return ' '.join(s.split())


def compact_text(s):
    """Bank text as letters only: "STRAIGHTTALK*P 800-299 FL" -> "straighttalkpfl"."""
    return re.sub(r'[^a-z]+', '', str(s).lower())


MIN_BANK_TEXT = 3


def merchant_rules():
    """Your rules from config.json: {name or None, match: [spellings], bank: [compact text], category or None}."""
    rules = []
    for r in _load_config().get('merchant_rules') or []:
        if not isinstance(r, dict):
            continue
        name = r['name'].strip() if isinstance(r.get('name'), str) and r['name'].strip() else None
        match = [k for k in (r.get('match') or []) if isinstance(k, str) and k]
        bank = [compact_text(b) for b in (r.get('bank_text') or []) if isinstance(b, str)]
        bank = [b for b in bank if len(b) >= MIN_BANK_TEXT]
        cat = r['category'] if isinstance(r.get('category'), str) and r['category'] else None
        if (name or cat) and (match or bank):
            rules.append({'name': name, 'match': match, 'bank': bank, 'category': cat})
    return rules


def _by_bank_text(rules, d, field):
    best, size = None, 0
    for r in rules:
        if r[field]:
            for b in r['bank']:
                if len(b) > size and b in d:
                    best, size = r, len(b)
    return best


def apply_merchant_rules(rules, renames, merchant, category, description):
    """(merchant, category) after your merchant rules. Name and category are settled separately: a rule
    listing this exact spelling (of the merchant or the whole description) wins; otherwise the rule with
    the longest bank_text found in the description. Spellings must match exactly, never as a prefix."""
    m_key, d_key, d = merchant_name_key(merchant), merchant_name_key(description), compact_text(description)
    exact = next((r for r in rules if m_key in r['match'] or d_key in r['match']), None)
    name_rule = exact if exact and exact['name'] else _by_bank_text(rules, d, 'name')
    cat_rule = exact if exact and exact['category'] else _by_bank_text(rules, d, 'category')
    return (name_rule['name'] if name_rule else merchant,
            renamed(renames, cat_rule['category']) if cat_rule else category)


def rules_only(rules, renames, description):
    """(merchant, category) when your rules alone settle both from the bank text, else (None, None)."""
    merchant, category = apply_merchant_rules(rules, renames, '', '', description)
    return (merchant, category) if merchant and category else (None, None)


def tx_type_merchant(tx_type, merchant):
    """ATM / CHECK / TRANSFER from the bank's Transaction Type column, else the merchant."""
    t = str(tx_type or '').lower()
    if 'atm' in t:
        return 'ATM'
    if 'check' in t:
        return 'CHECK'
    if 'transfer' in t:
        return 'TRANSFER'
    return merchant
