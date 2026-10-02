"""Category settings and merchant rules from config.json, shared by the scripts and the GUI
(docs/js/categories.js, docs/js/merchants.js).

config.json may contain:
  "categories":       ["Groceries", "Dining Out", ...]   your category list
  "category_renames": {"Dining Out": "Restaurants"}     old name -> new name
  "merchant_rules":   [{"name": "Amazon", "match": ["amazon"], "category": "Shopping"}]
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


def merchant_rules():
    rules = []
    for r in _load_config().get('merchant_rules') or []:
        if isinstance(r, dict) and isinstance(r.get('name'), str) and r['name'].strip() and isinstance(r.get('match'), list):
            cat = r.get('category') if isinstance(r.get('category'), str) and r.get('category') else None
            rules.append({'name': r['name'].strip(), 'match': [k for k in r['match'] if isinstance(k, str) and k], 'category': cat})
    return rules


def apply_merchant_rules(rules, renames, merchant, category, description):
    """(merchant, category) after your merchant rules. A rule matches only when the merchant's (or the
    whole description's) cleaned-up name is exactly one of its spellings -- never a prefix."""
    m_key, d_key = merchant_name_key(merchant), merchant_name_key(description)
    for r in rules:
        if m_key in r['match'] or d_key in r['match']:
            return r['name'], (renamed(renames, r['category']) if r['category'] else category)
    return merchant, category
