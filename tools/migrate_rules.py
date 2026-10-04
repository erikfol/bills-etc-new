"""One-time move of the merchant/category rules that used to be hardcoded in the scripts and the GUI
(CATEGORY_OVERRIDES, MERCHANT_CATEGORY_OVERRIDES and the merchant-name clean-ups) into config.json
`merchant_rules`, where the GUI's Merchants page shows and edits them.

Rules that repeat one of yours are folded into it. Category-only rules are grouped one per category.
Writes a backup next to config.json first; does nothing if it already ran.

    python tools/migrate_rules.py               # migrate config.json in place
    python tools/migrate_rules.py in.json out.json
"""
from datetime import datetime
import json
import re
import shutil
import sys

# The lists exactly as they were in the scripts.
CATEGORY_OVERRIDES = [
    ("ROCKET MORTGAGE", "Rent/Mortgage"), ("NSM DBAMR", "Rent/Mortgage"),
    ("CRCARDPMT", "Credit Card"), ("CARD PYMT", "Credit Card"), ("BEST BUY AUTO PYMT", "Credit Card"), ("AMZ_STORECRD_PMT", "Credit Card"),
    ("MORI LOAN", "Miscellaneous"), ("EXCHANGE FEE", "Miscellaneous"), ("OVERDRAFT", "Miscellaneous"), ("ATM FEE", "Miscellaneous"),
    ("IC FEE", "Miscellaneous"), ("PEACE OF MIND REBATE", "Miscellaneous"), ("PASSPORTSERVICES", "Miscellaneous"),
    ("REAL ESTAT", "Miscellaneous"), ("T.O.H.", "Miscellaneous"),
    ("TO SAVINGS", "Savings"), ("TO CHECKING", "Miscellaneous"), ("FROM SAVINGS", "Miscellaneous"), ("SCHEDULED TRANSFER", "Miscellaneous"),
    ("CLEAN ENERGY LOAN", "Utilities"), ("COMCAST", "Utilities"), ("XFINITY", "Utilities"), ("LIBERTY UTILITIE", "Utilities"), ("STRAIGHTTALK", "Utilities"),
    ("IRVING OIL", "Gas"), ("NH TURNPIKE", "Transport"), ("VACASA", "Entertainment"), ("VRBO", "Entertainment"),
    ("PAYROLL", "Income"), ("IRS TREAS", "Income"),
]
MERCHANT_CATEGORY_OVERRIDES = [
    ("AWS", "Amazon AWS", "Utilities"), ("AMAZON WEB", "Amazon AWS", "Utilities"), ("EXCHANGE FEE", "Exchange Fee", "Miscellaneous"),
    ("DISNEY MOUNTAIN VIEW", "Disney Plus", "Entertainment"), ("TRAVELERS", "Travelers Insurance", "Transport"), ("DUNKIN", "Dunkin", "Dining Out"),
]
NAME_CLEANUPS = [("onlyfans", "OF"), ("to savings", "TO SAVINGS"), ("tomtom", "TOMTOM"), ("irving", "Irving Gas"), ("mori", "Marriott Loan")]

# Old pieces not carried over, and why.
DROPPED = {'AWS': 'also matched SHAWS (the grocery store); AMAZON WEB covers every real AWS charge'}

MARK = '_builtin_rules_moved'


def compact(s):
    return re.sub(r'[^a-z]+', '', str(s).lower())


def name_key(name):
    s = str(name).lower().replace('www.', ' ')
    s = re.sub(r'\.(com|net|org)\b', ' ', s)
    return ' '.join(re.sub(r'[^a-z]+', ' ', s).split())


def migrate(cfg):
    rules = cfg.setdefault('merchant_rules', [])
    log = []

    def named(name):
        return next((r for r in rules if r.get('name') and name_key(r['name']) == name_key(name)), None)

    def add_bank(rule, piece):
        bank = rule.setdefault('bank_text', [])
        if piece not in bank:
            bank.append(piece)

    def with_piece(piece):
        return [r for r in rules if piece in (r.get('bank_text') or [])]

    # Name + category.
    for kw, name, cat in MERCHANT_CATEGORY_OVERRIDES:
        if kw in DROPPED:
            log.append(f'{kw}: dropped ({DROPPED[kw]})')
            continue
        piece, r = compact(kw), named(name)
        if r:
            add_bank(r, piece)
            if not r.get('category'):
                r['category'] = cat
            log.append(f'{kw}: added to your rule "{r["name"]}"')
        else:
            rules.append({'name': name, 'bank_text': [piece], 'category': cat})
            log.append(f'{kw}: new rule "{name}" ({cat})')
    # Name only.
    for kw, name in NAME_CLEANUPS:
        piece, r = compact(kw), named(name)
        if r:
            add_bank(r, piece)
            log.append(f'{kw}: added to your rule "{r["name"]}"')
        else:
            rules.append({'name': name, 'bank_text': [piece], 'category': None})
            log.append(f'{kw}: new rule "{name}"')
    # Category only: skip if a rule already has this bank text with the same category; else one rule per category.
    by_cat = {}
    for kw, cat in CATEGORY_OVERRIDES:
        piece = compact(kw)
        same = [r for r in with_piece(piece) if r.get('category') == cat]
        if same:
            log.append(f'{kw}: already covered by "{same[0].get("name") or same[0]["category"]}"')
            continue
        if cat not in by_cat:
            by_cat[cat] = {'name': None, 'bank_text': [], 'category': cat}
            rules.append(by_cat[cat])
        add_bank(by_cat[cat], piece)
        log.append(f'{kw}: category rule {cat}')
    cfg[MARK] = datetime.now().strftime('%Y-%m-%d')
    return log


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else 'config.json'
    dst = sys.argv[2] if len(sys.argv) > 2 else src
    with open(src, encoding='utf-8') as f:
        cfg = json.load(f)
    if cfg.get(MARK):
        print(f'Already migrated on {cfg[MARK]}; nothing to do.')
        return
    log = migrate(cfg)
    if dst == src:
        backup = f'{src}.before-rules-{datetime.now():%Y%m%d%H%M%S}.bak'
        shutil.copyfile(src, backup)
        print(f'Backup: {backup}')
    with open(dst, 'w', encoding='utf-8') as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)
        f.write('\n')
    print('\n'.join(log))
    print(f'{len(cfg["merchant_rules"])} rules in {dst}')


if __name__ == '__main__':
    main()
