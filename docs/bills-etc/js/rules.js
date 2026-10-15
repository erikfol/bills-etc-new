// Category list, renames, and turning a free-text category (from the AI) into one of yours.
// Merchant names and forced categories come from your merchant rules (merchants.js / config.json).

export const DEFAULT_CATEGORIES = ['Groceries', 'Dining Out', 'Utilities', 'Rent/Mortgage',
    'Entertainment', 'Shopping', 'Transport', 'Gas', 'Income',
    'Savings', 'Miscellaneous', 'Credit Card'];

// The user's category list and renames come from config.json (see data.js syncCategories).
// Renames map old → new names so the rules below keep producing the new name.
let categories = [...DEFAULT_CATEGORIES];
let renames = {};

export const getCategories = () => categories;

export function setCategorySettings(settings) {
    categories = settings.categories;
    renames = settings.renames;
}

/** Follow renames (a → b → c) to the current name. */
export function renamed(cat) {
    for (let i = 0; i < 20 && Object.hasOwn(renames, cat); i++) cat = renames[cat];
    return cat;
}

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

export function normalizeCategory(cat) {
    cat = renamed(String(cat ?? '').trim());
    const exact = categories.find(c => c.toLowerCase() === cat.toLowerCase());
    if (exact) return exact;
    for (const word of cat.toLowerCase().replace(/\//g, ' ').replace(/-/g, ' ').split(/\s+/)) {
        if (CATEGORY_MAP[word]) return renamed(CATEGORY_MAP[word]);
    }
    return renamed('Miscellaneous');
}

/** Fallback without AI: the bank text as the name, a category guessed from its words. Merchant rules apply on top. */
export function categorizeByRules(description) {
    return { merchant: String(description ?? ''), category: normalizeCategory(description) };
}
