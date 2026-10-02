// Categorization rules — ported from the Python scripts. Keep these in sync with
// CATEGORY_OVERRIDES / MERCHANT_CATEGORY_OVERRIDES there when adding merchants.

export const ALLOWED_CATEGORIES = ['Groceries', 'Dining Out', 'Utilities', 'Rent/Mortgage',
    'Entertainment', 'Shopping', 'Transport', 'Gas', 'Income',
    'Savings', 'Miscellaneous', 'Credit Card'];

const CATEGORY_MAP = {
    grocery: 'Groceries', groceries: 'Groceries',
    mortgage: 'Rent/Mortgage', rent: 'Rent/Mortgage',
    dining: 'Dining Out', restaurant: 'Dining Out', food: 'Dining Out',
    entertainment: 'Entertainment', streaming: 'Entertainment',
    utility: 'Utilities', utilities: 'Utilities', internet: 'Utilities', cable: 'Utilities', phone: 'Utilities',
    shopping: 'Shopping', shop: 'Shopping', retail: 'Shopping', electronics: 'Shopping',
    transport: 'Transport', transportation: 'Transport', gas: 'Gas', fuel: 'Gas',
    income: 'Income', payroll: 'Income', salary: 'Income',
    savings: 'Savings', saving: 'Savings',
    miscellaneous: 'Miscellaneous', misc: 'Miscellaneous', other: 'Miscellaneous',
};

// Checked after AI runs, first match wins (case-insensitive).
const CATEGORY_OVERRIDES = [
    ['ROCKET MORTGAGE', 'Rent/Mortgage'],
    ['NSM DBAMR', 'Rent/Mortgage'],
    ['CRCARDPMT', 'Credit Card'],
    ['CARD PYMT', 'Credit Card'],
    ['BEST BUY AUTO PYMT', 'Credit Card'],
    ['AMZ_STORECRD_PMT', 'Credit Card'],
    ['MORI LOAN', 'Miscellaneous'],
    ['EXCHANGE FEE', 'Miscellaneous'],
    ['OVERDRAFT', 'Miscellaneous'],
    ['ATM FEE', 'Miscellaneous'],
    ['IC FEE', 'Miscellaneous'],
    ['PEACE OF MIND REBATE', 'Miscellaneous'],
    ['PASSPORTSERVICES', 'Miscellaneous'],
    ['REAL ESTAT', 'Miscellaneous'],
    ['T.O.H.', 'Miscellaneous'],
    ['TO SAVINGS', 'Savings'],
    ['TO CHECKING', 'Miscellaneous'],
    ['FROM SAVINGS', 'Miscellaneous'],
    ['SCHEDULED TRANSFER', 'Miscellaneous'],
    ['CLEAN ENERGY LOAN', 'Utilities'],
    ['COMCAST', 'Utilities'],
    ['XFINITY', 'Utilities'],
    ['LIBERTY UTILITIE', 'Utilities'],
    ['STRAIGHTTALK', 'Utilities'],
    ['IRVING OIL', 'Gas'],
    ['NH TURNPIKE', 'Transport'],
    ['VACASA', 'Entertainment'],
    ['VRBO', 'Entertainment'],
    ['PAYROLL', 'Income'],
    ['IRS TREAS', 'Income'],
];

// Force BOTH merchant name and category: [substring, merchant, category]
const MERCHANT_CATEGORY_OVERRIDES = [
    ['AWS', 'Amazon AWS', 'Utilities'],
    ['AMAZON WEB', 'Amazon AWS', 'Utilities'],
    ['EXCHANGE FEE', 'Exchange Fee', 'Miscellaneous'],
    ['DISNEY MOUNTAIN VIEW', 'Disney Plus', 'Entertainment'],
    ['TRAVELERS', 'Travelers Insurance', 'Transport'],
    ['DUNKIN', 'Dunkin', 'Dining Out'],
];

export function normalizeCategory(cat) {
    cat = String(cat ?? '').trim();
    if (ALLOWED_CATEGORIES.includes(cat)) return cat;
    for (const word of cat.toLowerCase().replace(/\//g, ' ').replace(/-/g, ' ').split(/\s+/)) {
        if (CATEGORY_MAP[word]) return CATEGORY_MAP[word];
    }
    return 'Miscellaneous';
}

export function applyOverrides(description, category) {
    const desc = String(description ?? '').toUpperCase();
    for (const [keyword, forced] of CATEGORY_OVERRIDES) {
        if (desc.includes(keyword.toUpperCase())) return forced;
    }
    return category;
}

/** Returns {merchant, category} or null. */
export function applyMerchantCatOverrides(description) {
    const desc = String(description ?? '').toUpperCase();
    for (const [keyword, merchant, category] of MERCHANT_CATEGORY_OVERRIDES) {
        if (desc.includes(keyword)) return { merchant, category };
    }
    return null;
}

/** Fixed merchant names applied across the master (later rules win, as in the scripts' cleanup pass). */
export function cleanupMerchant(description, txType, merchant) {
    const d = String(description ?? '').toLowerCase();
    if (d.includes('onlyfans')) merchant = 'OF';
    if (d.includes('to savings')) merchant = 'TO SAVINGS';
    if (d.includes('tomtom') || d.includes('tom tom')) merchant = 'TOMTOM';
    if (d.includes('irving')) merchant = 'Irving Gas';
    if (d.includes('mori')) merchant = 'Marriott Loan';
    if (txType != null) {
        const t = String(txType).toLowerCase();
        if (t.includes('atm')) merchant = 'ATM';
        if (t.includes('check')) merchant = 'CHECK';
        if (t.includes('transfer')) merchant = 'TRANSFER';
    }
    return merchant;
}

/** Override-only categorization (script 3 without --ai). */
export function categorizeByRules(description) {
    const mc = applyMerchantCatOverrides(description);
    if (mc) return mc;
    return {
        merchant: String(description ?? ''),
        category: applyOverrides(description, normalizeCategory(description)),
    };
}
