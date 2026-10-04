// Talks to the user's local Ollama straight from the browser. Requires OLLAMA_ORIGINS to allow this page.
import { applyOverrides, applyMerchantCatOverrides, cleanupMerchant, normalizeCategory } from './rules.js';

const DEFAULTS = { base: 'http://localhost:11434', model: 'qwen2.5:3b' };

function load(key) {
    try { return localStorage.getItem('billsetc.ollama.' + key) || DEFAULTS[key]; } catch { return DEFAULTS[key]; }
}

export const ollamaSettings = {
    get base() { return load('base').replace(/\/+$/, ''); },
    get model() { return load('model'); },
    save(base, model) {
        try {
            localStorage.setItem('billsetc.ollama.base', base);
            localStorage.setItem('billsetc.ollama.model', model);
        } catch { /* storage blocked — settings last for this session only */ }
    },
};

/** AI features are off unless turned on in Setup; while off, nothing contacts Ollama. */
export function aiEnabled() {
    try { return localStorage.getItem('billsetc.ai') === 'on'; } catch { return false; }
}
export function setAiEnabled(on) {
    try { localStorage.setItem('billsetc.ai', on ? 'on' : 'off'); } catch { /* session only */ }
}

/** Returns {ok, models, hasModel, error}. */
export async function pingOllama() {
    try {
        const res = await fetch(ollamaSettings.base + '/api/tags', { signal: AbortSignal.timeout(4000) });
        if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
        const models = ((await res.json()).models || []).map(m => m.name);
        return { ok: true, models, hasModel: models.includes(ollamaSettings.model) };
    } catch (e) {
        return { ok: false, error: e.name === 'TimeoutError' ? 'timed out' : 'not reachable (is it running, and is OLLAMA_ORIGINS set?)' };
    }
}

export async function generate(prompt, signal) {
    const res = await fetch(ollamaSettings.base + '/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: ollamaSettings.model, prompt, stream: false }),
        signal,
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()).response;
}

function categorizePrompt(description, amount, known = []) {
    return `
You are a precise bank transaction categorizer. Analyze this transaction: "${description}" ($${amount})

Respond ONLY in this exact format, nothing else:
Merchant: [clean name] | Category: [category]
${known.length ? `
MERCHANT NAME: if this transaction is from one of these merchants, copy its name exactly as written here
(same spelling, spacing and capitals). Otherwise give a short, clean name with no store numbers, cities or symbols.
${known.join('; ')}
` : ''}
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
`;
}

/**
 * Ask the local model for {merchant, category}, then apply the hardcoded overrides.
 * Network/abort errors are rethrown so a run stops instead of filling the master with fallbacks;
 * an unparseable answer falls back to the override rules, like the scripts do.
 */
export async function aiCategorize(description, amount, signal, known = []) {
    // A merchant+category override always wins, so don't spend a model call on it.
    const mc = applyMerchantCatOverrides(description);
    if (mc) return { ...mc, parsed: true };
    const text = (await generate(categorizePrompt(description, amount, known), signal)).trim();
    const parts = text.split('|');
    if (parts.length < 2) {
        return { merchant: cleanupMerchant(description, null, description), category: applyOverrides(description, 'Miscellaneous'), parsed: false, raw: text };
    }
    const merchant = cleanupMerchant(description, null, parts[0].replace('Merchant:', '').trim());
    const category = applyOverrides(description, normalizeCategory(parts[1].replace('Category:', '').trim()));
    return { merchant, category, parsed: true };
}

export function insightsPrompt(summaryText) {
    return `
    You are a high-end personal financial planner and data analyst.
    Review the following historical spending summary calculated from the user's master file:

    ${summaryText}

    Provide a sharp, bulleted executive brief covering:
    1. Lifestyle Creep/Trends: Highlight any categories where spending is steadily increasing month-over-month.
    2. Red Flags & Anomalies: Point out any massive spikes or unexpected deviations.
    3. Actionable Advice: Give 2-3 highly specific tactical recommendations for next month based strictly on this data to optimize savings.

    Keep your tone professional, encouraging, and direct. Do not mention that you are an AI or repeat the numbers unnecessarily.
    `;
}
