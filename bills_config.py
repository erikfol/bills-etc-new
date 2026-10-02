"""Category settings from config.json, shared by the scripts and the GUI (docs/js/categories.js).

config.json may contain:
  "categories":       ["Groceries", "Dining Out", ...]   your category list
  "category_renames": {"Dining Out": "Restaurants"}     old name -> new name
Both are managed on the GUI's Config page; when absent, the scripts' built-in list is used.
"""
import json
import os

CONFIG_FILE = "config.json"


def renamed(renames, category):
    """Follow renames (a -> b -> c) to the current name."""
    for _ in range(20):
        if category not in renames:
            break
        category = renames[category]
    return category


def category_settings(defaults):
    """(category_list, renames) from config.json, falling back to `defaults`."""
    cfg = {}
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, encoding='utf-8') as f:
                cfg = json.load(f)
        except (OSError, ValueError):
            cfg = {}
    cats = [c.strip() for c in cfg.get('categories', []) if isinstance(c, str) and c.strip() and not c.startswith('_')]
    renames = {k: v for k, v in (cfg.get('category_renames') or {}).items()
               if not k.startswith('_') and isinstance(v, str) and v.strip()}
    cats = cats or list(defaults)
    for must in ('Income', renamed(renames, 'Miscellaneous')):
        if must not in cats:
            cats.append(must)
    return cats, renames
