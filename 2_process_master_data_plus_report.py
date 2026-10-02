import pandas as pd
import ollama
import os
import re
import json
from datetime import datetime

MASTER_FILE = "output_master_data/all_time_finances.csv"
MODEL_NAME = "qwen2.5:3b"
REPORTS_FOLDER = "reports"

ALLOWED_CATEGORIES_LIST = ["Groceries", "Dining Out", "Utilities", "Rent/Mortgage",
                            "Entertainment", "Shopping", "Transport", "Gas", "Income",
                            "Savings", "Miscellaneous", "Credit Card"]

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
    cat = str(cat).strip()
    if cat in ALLOWED_CATEGORIES_LIST:
        return cat
    for word in cat.lower().replace('/', ' ').replace('-', ' ').split():
        if word in CATEGORY_MAP:
            return CATEGORY_MAP[word]
    return 'Miscellaneous'

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

def apply_overrides(description, category):
    desc_upper = str(description).upper()
    for keyword, forced in CATEGORY_OVERRIDES:
        if keyword.upper() in desc_upper:
            return forced
    return category

MERCHANT_CATEGORY_OVERRIDES = [
    ('AWS',                 'Amazon AWS',          'Utilities'),
    ('AMAZON WEB',          'Amazon AWS',          'Utilities'),
    ('EXCHANGE FEE',        'Exchange Fee',        'Miscellaneous'),
    ('DISNEY MOUNTAIN VIEW','Disney Plus',         'Entertainment'),
    ('TRAVELERS',           'Travelers Insurance', 'Transport'),
    ('DUNKIN',              'Dunkin',              'Dining Out'),
]

def apply_merchant_cat_overrides(description):
    desc_upper = str(description).upper()
    for keyword, merchant, category in MERCHANT_CATEGORY_OVERRIDES:
        if keyword in desc_upper:
            return merchant, category
    return None, None

def generate_ai_insights(summary_text):
    prompt = f"""
    You are a high-end personal financial planner and data analyst.
    Review the following historical spending summary calculated from the user's master file:

    {summary_text}

    Provide a sharp, bulleted executive brief covering:
    1. Lifestyle Creep/Trends: Highlight any categories where spending is steadily increasing month-over-month.
    2. Red Flags & Anomalies: Point out any massive spikes or unexpected deviations.
    3. Actionable Advice: Give 2-3 highly specific tactical recommendations for next month based strictly on this data to optimize savings.

    Keep your tone professional, encouraging, and direct. Do not mention that you are an AI or repeat the numbers unnecessarily.
    """
    print("[AI] Local AI is auditing your history and generating strategic insights...")
    response = ollama.generate(model=MODEL_NAME, prompt=prompt)
    return response['response']

def md_to_html(text):
    """Convert basic markdown formatting to HTML."""
    # Bold
    text = re.sub(r'\*\*(.*?)\*\*', r'<strong>\1</strong>', text)
    # Split into blocks and convert bullet lines to <ul><li>
    blocks = text.strip().split('\n\n')
    html_parts = []
    for block in blocks:
        lines = block.strip().split('\n')
        bullet_lines = [l for l in lines if re.match(r'^\s*[\*\-•]\s+', l)]
        if bullet_lines and len(bullet_lines) == len([l for l in lines if l.strip()]):
            items = [re.sub(r'^\s*[\*\-•]\s+', '', l) for l in lines if l.strip()]
            html_parts.append('<ul>' + ''.join(f'<li>{i}</li>' for i in items) + '</ul>')
        else:
            html_parts.append('<p>' + '<br>'.join(lines) + '</p>')
    return '\n'.join(html_parts)

def fmt_month_label(period_str):
    """'2025-12' -> 'Dec 2025'"""
    from calendar import month_abbr
    year, mon = period_str.split('-')
    return f"{month_abbr[int(mon)]} {year}"

def generate_html_report(monthly_data, category_trends, ai_report, output_path, df):
    """Write a styled HTML report to output_path."""
    generated = datetime.now().strftime('%B %d, %Y at %I:%M %p')

    # Chart data (injected into JS)
    cat_chart_height = max(200, len(category_trends.columns) * 36 + 50)
    cat_totals = {col: round(float(abs(category_trends[col].sum())), 2) for col in category_trends.columns}
    cat_totals_sorted = dict(sorted(cat_totals.items(), key=lambda x: x[1], reverse=True))
    cat_by_month = {
        fmt_month_label(str(period)): {
            col: round(float(abs(row[col])), 2) for col in category_trends.columns
        }
        for period, row in category_trends.iterrows()
    }
    chart_json = json.dumps({
        'months':          [fmt_month_label(m) for m, _, _, _ in monthly_data],
        'income':          [round(float(inc), 2) for _, inc, _, _ in monthly_data],
        'expenses':        [round(float(abs(exp)), 2) for _, _, exp, _ in monthly_data],
        'categories':      list(cat_totals_sorted.keys()),
        'categoryTotals':  list(cat_totals_sorted.values()),
        'categoryByMonth': cat_by_month,
    })

    # Cash flow table rows
    cf_rows = ''
    for month, inc, exp, net in monthly_data:
        net_class = 'positive' if net >= 0 else 'negative'
        net_fmt = f'${net:,.2f}' if net >= 0 else f'-${abs(net):,.2f}'
        cf_rows += f'''
            <tr>
                <td>{month}</td>
                <td>${inc:,.2f}</td>
                <td>${abs(exp):,.2f}</td>
                <td class="{net_class}">{net_fmt}</td>
            </tr>'''

    # Category breakdown table
    cat_headers = ''.join(f'<th>{col}</th>' for col in category_trends.columns)
    cat_rows = ''
    for month, row in category_trends.iterrows():
        cat_rows += f'<tr><td><strong>{month}</strong></td>'
        for val in row:
            cat_rows += f'<td>${abs(val):,.2f}</td>' if val != 0 else '<td class="zero">-</td>'
        cat_rows += '</tr>'

    # Monthly transaction tabs
    use_cleaned = 'Cleaned Merchant' in df.columns
    months = sorted(df['YearMonth'].dropna().unique(), key=str)
    first_tab_id = f"tab-{months[0]}"

    tab_buttons = ''
    tab_panels  = ''
    for i, month in enumerate(months):
        tab_id    = f"tab-{month}"
        label     = fmt_month_label(str(month))
        is_first  = 'active' if i == 0 else ''
        tab_buttons += f'<button class="tab-btn {is_first}" onclick="showTab(\'{tab_id}\', this)">{label}</button>\n'

        month_df = df[df['YearMonth'] == month].sort_values('Date')
        cats = sorted(month_df['AI Category'].dropna().unique()) if 'AI Category' in month_df.columns else []
        cat_options = '<option value="">All Categories</option>' + ''.join(
            f'<option value="{c}">{c}</option>' for c in cats)

        tx_rows = ''
        for _, row in month_df.iterrows():
            amt       = row['Amount']
            amt_class = 'income-amt' if amt > 0 else 'expense-amt'
            amt_fmt   = f'+${amt:,.2f}' if amt > 0 else f'-${abs(amt):,.2f}'
            merchant  = row['Cleaned Merchant'] if use_cleaned else row['Description']
            date_str  = row['Date'].strftime('%d-%b-%y') if hasattr(row['Date'], 'strftime') else str(row['Date'])
            cat       = row.get('AI Category', '')
            notes    = str(row.get('Notes', '') or '')
            notes_td = f'<span class="note-text">{notes}</span>' if notes.strip() else ''
            tx_rows  += f'<tr data-category="{cat}"><td>{date_str}</td><td>{merchant}</td><td class="{amt_class}" data-amount="{amt}">{amt_fmt}</td><td><span class="cat-badge">{cat}</span></td><td>{notes_td}</td></tr>'

        tab_panels += f'''<div id="{tab_id}" class="tab-panel {is_first}">
            <div class="tab-controls">
                <label>Filter: <select onchange="filterTable('{tab_id}', this.value)">{cat_options}</select></label>
                <span class="row-count" id="count-{tab_id}">{len(month_df)} transactions</span>
            </div>
            <table id="tbl-{tab_id}">
                <thead><tr>
                    <th class="sortable" onclick="sortTable('{tab_id}', 0, 'str')">Date <span class="sort-icon">↕</span></th>
                    <th class="sortable" onclick="sortTable('{tab_id}', 1, 'str')">Merchant <span class="sort-icon">↕</span></th>
                    <th class="sortable" onclick="sortTable('{tab_id}', 2, 'num')">Amount <span class="sort-icon">↕</span></th>
                    <th class="sortable" onclick="sortTable('{tab_id}', 3, 'str')">Category <span class="sort-icon">↕</span></th>
                    <th>Notes</th>
                </tr></thead>
                <tbody>{tx_rows}</tbody>
            </table>
        </div>\n'''

    ai_html = md_to_html(ai_report)

    html = f'''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Financial Audit Report</title>
    <style>
        * {{ box-sizing: border-box; margin: 0; padding: 0; }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 1100px;
            margin: 40px auto;
            padding: 0 24px 60px;
            color: #2d2d2d;
            background: #f5f7fa;
        }}
        .header {{
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            color: white;
            padding: 32px 36px;
            border-radius: 12px;
            margin-bottom: 28px;
        }}
        .header h1 {{ font-size: 1.8em; font-weight: 700; letter-spacing: -0.5px; }}
        .header p {{ color: #aab4c8; margin-top: 6px; font-size: 0.9em; }}
        section {{
            background: white;
            border-radius: 10px;
            padding: 24px 28px;
            margin-bottom: 20px;
            box-shadow: 0 1px 4px rgba(0,0,0,0.08);
        }}
        section h2 {{
            font-size: 1.1em;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: #555;
            margin-bottom: 16px;
            padding-bottom: 10px;
            border-bottom: 2px solid #f0f0f0;
        }}
        table {{ border-collapse: collapse; width: 100%; font-size: 0.93em; }}
        th {{
            background: #f0f4ff;
            color: #444;
            padding: 10px 14px;
            text-align: left;
            font-weight: 600;
            border-bottom: 2px solid #dde3f0;
        }}
        td {{ padding: 9px 14px; border-bottom: 1px solid #f0f0f0; }}
        tr:last-child td {{ border-bottom: none; }}
        tr:hover td {{ background: #fafbff; }}
        .positive {{ color: #27ae60; font-weight: 700; }}
        .negative {{ color: #e74c3c; font-weight: 700; }}
        .income-amt {{ color: #27ae60; font-weight: 600; font-family: monospace; }}
        .expense-amt {{ color: #e74c3c; font-family: monospace; }}
        .zero {{ color: #ccc; }}
        .cat-badge {{
            background: #f0f4ff;
            color: #3a5ca8;
            border-radius: 4px;
            padding: 2px 8px;
            font-size: 0.82em;
            font-weight: 500;
            white-space: nowrap;
        }}
        .ai-box {{ line-height: 1.7; color: #333; }}
        .ai-box p {{ margin-bottom: 12px; }}
        .ai-box ul {{ padding-left: 20px; margin-bottom: 12px; }}
        .ai-box li {{ margin-bottom: 6px; }}
        .ai-box strong {{ color: #1a1a2e; }}
        .footer {{ text-align: center; color: #aaa; font-size: 0.8em; margin-top: 32px; }}
        /* Tabs */
        .tab-nav {{
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            margin-bottom: 18px;
        }}
        .tab-btn {{
            background: #f0f4ff;
            border: 1px solid #dde3f0;
            border-radius: 6px;
            padding: 7px 16px;
            font-size: 0.88em;
            font-weight: 500;
            color: #555;
            cursor: pointer;
            transition: all 0.15s;
        }}
        .tab-btn:hover {{ background: #dde8ff; color: #333; }}
        .tab-btn.active {{
            background: #4a90d9;
            border-color: #4a90d9;
            color: white;
        }}
        .tab-panel {{ display: none; }}
        .tab-panel.active {{ display: block; }}
        .tab-controls {{
            display: flex;
            align-items: center;
            gap: 20px;
            margin-bottom: 14px;
        }}
        .tab-controls label {{ font-size: 0.88em; color: #555; }}
        .tab-controls select {{
            margin-left: 6px;
            padding: 5px 10px;
            border: 1px solid #dde3f0;
            border-radius: 6px;
            font-size: 0.88em;
            background: #f8faff;
            cursor: pointer;
        }}
        .row-count {{ font-size: 0.82em; color: #999; margin-left: auto; }}
        th.sortable {{ cursor: pointer; user-select: none; white-space: nowrap; }}
        th.sortable:hover {{ background: #dde8ff; }}
        .sort-icon {{ font-size: 0.75em; color: #bbb; margin-left: 4px; }}
        th.sort-asc .sort-icon, th.sort-desc .sort-icon {{ color: #4a90d9; }}
        .note-text {{ font-size: 0.85em; color: #888; font-style: italic; }}
        .chart-wrap {{ margin: 4px 0 22px; }}
        .chart-wrap canvas {{ display: block; width: 100%; }}
        .chart-legend {{ display: flex; gap: 20px; margin-bottom: 10px; font-size: 0.82em; color: #555; }}
        .chart-legend span {{ display: flex; align-items: center; gap: 6px; }}
        .legend-dot {{ width: 12px; height: 12px; border-radius: 2px; flex-shrink: 0; }}
        .legend-line {{ width: 18px; height: 2px; border-top: 2px dashed #27ae60; flex-shrink: 0; }}
        .cat-toggle {{
            display: inline-flex; align-items: center; gap: 6px;
            padding: 4px 12px; border-radius: 20px; border: 1px solid #dde3f0;
            background: #f0f4ff; color: #666; font-size: 0.82em;
            cursor: pointer; transition: all 0.15s; user-select: none;
        }}
        .cat-toggle .legend-dot {{ background: var(--cat-color); width: 9px; height: 9px; border-radius: 50%; }}
        .cat-toggle.active {{ background: var(--cat-color); border-color: var(--cat-color); color: #fff; font-weight: 500; }}
        .cat-toggle.active .legend-dot {{ background: rgba(255,255,255,0.7); }}
        .cat-toggle:not(.active) {{ opacity: 0.45; }}
        #catTrendLegend {{ gap: 8px 10px; flex-wrap: wrap; }}
    </style>
</head>
<body>
    <div class="header">
        <h1>Monthly Financial Audit Report</h1>
        <p>Generated on {generated}</p>
    </div>

    <section>
        <h2>Month-over-Month Cash Flow</h2>
        <div class="chart-wrap">
            <div class="chart-legend">
                <span><span class="legend-dot" style="background:#4a90d9"></span>Income</span>
                <span><span class="legend-dot" style="background:#e74c3c"></span>Expenses</span>
                <span><span class="legend-line"></span>Net</span>
            </div>
            <canvas id="cashFlowChart" style="height:260px;"></canvas>
        </div>
        <table>
            <thead>
                <tr><th>Month</th><th>Income</th><th>Expenses</th><th>Net</th></tr>
            </thead>
            <tbody>{cf_rows}</tbody>
        </table>
    </section>

    <section>
        <h2>Category Spending Breakdown</h2>
        <div class="chart-wrap">
            <div class="tab-controls" style="margin-bottom:10px;">
                <label style="font-size:0.88em;color:#555;">Month:
                    <select id="catMonthFilter" onchange="drawCategoryChart(this.value)" style="margin-left:6px;padding:5px 10px;border:1px solid #dde3f0;border-radius:6px;font-size:0.88em;background:#f8faff;cursor:pointer;">
                        <option value="all">All Months</option>
                    </select>
                </label>
            </div>
            <canvas id="categoryChart" style="height:{cat_chart_height}px;"></canvas>
        </div>
        <table>
            <thead>
                <tr><th>Month</th>{cat_headers}</tr>
            </thead>
            <tbody>{cat_rows}</tbody>
        </table>
    </section>

    <section>
        <h2>Category Trends</h2>
        <div class="chart-wrap">
            <div id="catTrendLegend" class="chart-legend" style="flex-wrap:wrap;gap:10px 20px;margin-bottom:12px;"></div>
            <canvas id="categoryTrendChart" style="height:300px;"></canvas>
        </div>
    </section>

    <section>
        <h2>Transaction Detail</h2>
        <div class="tab-nav">
            {tab_buttons}
        </div>
        {tab_panels}
    </section>

    <section>
        <h2>AI Strategic Analysis</h2>
        <div class="ai-box">{ai_html}</div>
    </section>

    <div class="footer">BillsEtc 2.0 &mdash; 100% offline &mdash; {generated}</div>

    <script>
        const CHART_DATA = {chart_json};
        const CHART_COLORS = ['#4a90d9','#e74c3c','#27ae60','#f39c12','#9b59b6','#1abc9c','#e67e22','#e91e63','#607d8b','#34495e'];
        const activeCats = new Set();

        function drawCashFlowChart() {{
            const canvas = document.getElementById('cashFlowChart');
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            const dpr = window.devicePixelRatio || 1;
            const W = canvas.clientWidth;
            const H = canvas.clientHeight;
            canvas.width = W * dpr;
            canvas.height = H * dpr;
            ctx.scale(dpr, dpr);

            const months = CHART_DATA.months;
            const income = CHART_DATA.income;
            const expenses = CHART_DATA.expenses;
            const n = months.length;
            if (n === 0) return;

            const pad = {{ top: 24, right: 20, bottom: 44, left: 72 }};
            const chartW = W - pad.left - pad.right;
            const chartH = H - pad.top - pad.bottom;
            const maxVal = Math.max(...income, ...expenses) * 1.15 || 1;

            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, W, H);

            // Grid lines + y-axis labels
            ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
            for (let i = 0; i <= 4; i++) {{
                const y = pad.top + chartH * (1 - i / 4);
                ctx.strokeStyle = '#f0f0f0';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(pad.left, y);
                ctx.lineTo(pad.left + chartW, y);
                ctx.stroke();
                ctx.fillStyle = '#aaa';
                ctx.textAlign = 'right';
                const v = maxVal * i / 4;
                ctx.fillText('$' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v.toFixed(0)), pad.left - 6, y + 4);
            }}

            // Bars
            const groupW = chartW / n;
            const barW = Math.min(groupW * 0.32, 42);
            const gap = Math.min(groupW * 0.05, 6);
            const gOff = (groupW - 2 * barW - gap) / 2;

            for (let i = 0; i < n; i++) {{
                const gx = pad.left + i * groupW + gOff;
                const incH = (income[i] / maxVal) * chartH;
                ctx.fillStyle = '#4a90d9';
                ctx.fillRect(gx, pad.top + chartH - incH, barW, incH);
                const expH = (expenses[i] / maxVal) * chartH;
                ctx.fillStyle = '#e74c3c';
                ctx.fillRect(gx + barW + gap, pad.top + chartH - expH, barW, expH);
                ctx.fillStyle = '#666';
                ctx.textAlign = 'center';
                ctx.fillText(months[i], pad.left + i * groupW + groupW / 2, pad.top + chartH + 18);
            }}

            // Net dashed line
            ctx.strokeStyle = '#27ae60';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 4]);
            ctx.beginPath();
            for (let i = 0; i < n; i++) {{
                const net = income[i] - expenses[i];
                const x = pad.left + i * groupW + groupW / 2;
                const y = pad.top + chartH - (Math.max(net, 0) / maxVal) * chartH;
                i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            }}
            ctx.stroke();
            ctx.setLineDash([]);

            // Dots on net line
            ctx.fillStyle = '#27ae60';
            for (let i = 0; i < n; i++) {{
                const net = income[i] - expenses[i];
                const x = pad.left + i * groupW + groupW / 2;
                const y = pad.top + chartH - (Math.max(net, 0) / maxVal) * chartH;
                ctx.beginPath();
                ctx.arc(x, y, 3.5, 0, 2 * Math.PI);
                ctx.fill();
            }}
        }}

        function drawCategoryChart(filter) {{
            filter = filter || 'all';
            const canvas = document.getElementById('categoryChart');
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            const dpr = window.devicePixelRatio || 1;
            const W = canvas.clientWidth;
            const H = canvas.clientHeight;
            canvas.width = W * dpr;
            canvas.height = H * dpr;
            ctx.scale(dpr, dpr);

            // Build sorted cat/value pairs for the selected period
            let pairs;
            if (filter === 'all') {{
                pairs = CHART_DATA.categories.map((c, i) => [c, CHART_DATA.categoryTotals[i]]);
            }} else {{
                const monthData = CHART_DATA.categoryByMonth[filter] || {{}};
                pairs = Object.entries(monthData).filter(([, v]) => v > 0);
                pairs.sort((a, b) => b[1] - a[1]);
            }}
            if (pairs.length === 0) return;

            const cats = pairs.map(p => p[0]);
            const totals = pairs.map(p => p[1]);
            const n = cats.length;

            const pad = {{ top: 14, right: 88, bottom: 14, left: 118 }};
            const chartW = W - pad.left - pad.right;
            const chartH = H - pad.top - pad.bottom;
            const rowH = chartH / n;
            const barH = Math.min(rowH * 0.55, 22);
            const maxVal = Math.max(...totals) * 1.05 || 1;

            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, W, H);

            ctx.strokeStyle = '#f0f0f0';
            ctx.lineWidth = 1;
            [0.25, 0.5, 0.75, 1].forEach(f => {{
                const x = pad.left + f * chartW;
                ctx.beginPath();
                ctx.moveTo(x, pad.top);
                ctx.lineTo(x, pad.top + chartH);
                ctx.stroke();
            }});

            ctx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif';
            for (let i = 0; i < n; i++) {{
                const y = pad.top + i * rowH;
                const barLen = (totals[i] / maxVal) * chartW;
                const barY = y + (rowH - barH) / 2;

                ctx.fillStyle = CHART_COLORS[i % CHART_COLORS.length];
                ctx.fillRect(pad.left, barY, barLen, barH);

                ctx.fillStyle = '#444';
                ctx.textAlign = 'right';
                ctx.fillText(cats[i], pad.left - 8, y + rowH / 2 + 4);

                ctx.fillStyle = '#555';
                ctx.textAlign = 'left';
                const fmt = totals[i] >= 1000 ? '$' + (totals[i] / 1000).toFixed(1) + 'k' : '$' + totals[i].toFixed(0);
                ctx.fillText(fmt, pad.left + barLen + 6, y + rowH / 2 + 4);
            }}
        }}

        function drawCategoryTrendChart() {{
            const canvas = document.getElementById('categoryTrendChart');
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            const dpr = window.devicePixelRatio || 1;
            const W = canvas.clientWidth;
            const H = canvas.clientHeight;
            canvas.width = W * dpr;
            canvas.height = H * dpr;
            ctx.scale(dpr, dpr);

            const months = CHART_DATA.months;
            const cats = CHART_DATA.categories;
            const n = months.length;
            if (n === 0 || cats.length === 0) return;

            const pad = {{ top: 24, right: 24, bottom: 36, left: 72 }};
            const chartW = W - pad.left - pad.right;
            const chartH = H - pad.top - pad.bottom;

            // Max value only over active categories
            let maxVal = 0;
            cats.forEach(cat => {{
                if (!activeCats.has(cat)) return;
                months.forEach(m => {{
                    maxVal = Math.max(maxVal, (CHART_DATA.categoryByMonth[m] || {{}})[cat] || 0);
                }});
            }});
            maxVal = maxVal * 1.15 || 1;

            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, W, H);

            // Grid lines + y-axis labels
            ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
            for (let i = 0; i <= 4; i++) {{
                const y = pad.top + chartH * (1 - i / 4);
                ctx.strokeStyle = '#f0f0f0';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(pad.left, y);
                ctx.lineTo(pad.left + chartW, y);
                ctx.stroke();
                ctx.fillStyle = '#aaa';
                ctx.textAlign = 'right';
                const v = maxVal * i / 4;
                ctx.fillText('$' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v.toFixed(0)), pad.left - 6, y + 4);
            }}

            // X-axis labels
            ctx.fillStyle = '#666';
            ctx.textAlign = 'center';
            months.forEach((m, i) => {{
                const x = pad.left + (n === 1 ? chartW / 2 : i * chartW / (n - 1));
                ctx.fillText(m, x, pad.top + chartH + 18);
            }});

            // One line per active category
            cats.forEach((cat, ci) => {{
                if (!activeCats.has(cat)) return;
                const color = CHART_COLORS[ci % CHART_COLORS.length];
                const points = months.map((m, i) => {{
                    const v = (CHART_DATA.categoryByMonth[m] || {{}})[cat] || 0;
                    return {{
                        x: pad.left + (n === 1 ? chartW / 2 : i * chartW / (n - 1)),
                        y: pad.top + chartH - (v / maxVal) * chartH,
                    }};
                }});

                ctx.strokeStyle = color;
                ctx.lineWidth = 2;
                ctx.beginPath();
                points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
                ctx.stroke();

                ctx.fillStyle = color;
                points.forEach(p => {{
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, 4, 0, 2 * Math.PI);
                    ctx.fill();
                }});
            }});
        }}

        function drawAllCharts() {{
            drawCashFlowChart();
            const sel = document.getElementById('catMonthFilter');
            drawCategoryChart(sel ? sel.value : 'all');
            drawCategoryTrendChart();
        }}

        window.addEventListener('load', () => {{
            // Populate month filter options
            const sel = document.getElementById('catMonthFilter');
            if (sel) {{
                CHART_DATA.months.forEach(m => {{
                    const opt = document.createElement('option');
                    opt.value = m;
                    opt.textContent = m;
                    sel.appendChild(opt);
                }});
            }}

            // Build category trend toggle legend
            const legend = document.getElementById('catTrendLegend');
            if (legend) {{
                CHART_DATA.categories.forEach((cat, ci) => {{
                    activeCats.add(cat);
                    const btn = document.createElement('button');
                    btn.className = 'cat-toggle active';
                    btn.style.setProperty('--cat-color', CHART_COLORS[ci % CHART_COLORS.length]);
                    btn.innerHTML = '<span class="legend-dot"></span>' + cat;
                    btn.addEventListener('click', () => {{
                        if (activeCats.has(cat)) {{
                            activeCats.delete(cat);
                            btn.classList.remove('active');
                        }} else {{
                            activeCats.add(cat);
                            btn.classList.add('active');
                        }}
                        drawCategoryTrendChart();
                    }});
                    legend.appendChild(btn);
                }});
            }}

            drawAllCharts();
        }});
        window.addEventListener('resize', drawAllCharts);

        function showTab(tabId, btn) {{
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.getElementById(tabId).classList.add('active');
            btn.classList.add('active');
        }}

        function filterTable(tabId, category) {{
            const tbody = document.querySelector('#tbl-' + tabId + ' tbody');
            let visible = 0;
            tbody.querySelectorAll('tr').forEach(row => {{
                const show = !category || row.dataset.category === category;
                row.style.display = show ? '' : 'none';
                if (show) visible++;
            }});
            const countEl = document.getElementById('count-' + tabId);
            if (countEl) countEl.textContent = visible + ' transaction' + (visible !== 1 ? 's' : '');
        }}

        function sortTable(tabId, colIndex, type) {{
            const table = document.getElementById('tbl-' + tabId);
            const tbody = table.querySelector('tbody');
            const ths = table.querySelectorAll('th.sortable');
            const th = ths[colIndex];
            const asc = !th.classList.contains('sort-asc');

            ths.forEach(h => {{ h.classList.remove('sort-asc', 'sort-desc'); h.querySelector('.sort-icon').textContent = '↕'; }});
            th.classList.add(asc ? 'sort-asc' : 'sort-desc');
            th.querySelector('.sort-icon').textContent = asc ? '↑' : '↓';

            const rows = Array.from(tbody.querySelectorAll('tr'));
            rows.sort((a, b) => {{
                let aVal, bVal;
                if (type === 'num') {{
                    aVal = parseFloat(a.cells[colIndex].dataset.amount || 0);
                    bVal = parseFloat(b.cells[colIndex].dataset.amount || 0);
                    return asc ? aVal - bVal : bVal - aVal;
                }} else {{
                    aVal = a.cells[colIndex].textContent.trim();
                    bVal = b.cells[colIndex].textContent.trim();
                    return asc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
                }}
            }});
            rows.forEach(r => tbody.appendChild(r));
        }}
    </script>
</body>
</html>'''

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(html)
    print(f"[*] HTML report saved: {output_path}")

def main():
    if not os.path.exists(MASTER_FILE):
        print(f"Error: Master file '{MASTER_FILE}' not found. Run 01_normalize.py first.")
        return

    # 1. Load and normalize master data
    df = pd.read_csv(MASTER_FILE)
    df.columns = df.columns.str.strip()

    if 'AI Category' in df.columns:
        df['AI Category'] = df['AI Category'].apply(normalize_category)
        df['AI Category'] = df.apply(lambda r: apply_overrides(r['Description'], r['AI Category']), axis=1)
        mc_results = df['Description'].apply(apply_merchant_cat_overrides)
        mc_mask = mc_results.apply(lambda x: x[0] is not None)
        if mc_mask.any():
            df.loc[mc_mask, 'Cleaned Merchant'] = mc_results[mc_mask].apply(lambda x: x[0])
            df.loc[mc_mask, 'AI Category']      = mc_results[mc_mask].apply(lambda x: x[1])

    if 'Cleaned Merchant' in df.columns and 'Description' in df.columns:
        df.loc[df['Description'].str.contains('onlyfans', case=False, na=False), 'Cleaned Merchant'] = 'OF'
        df.loc[df['Description'].str.contains('to savings', case=False, na=False), 'Cleaned Merchant'] = 'TO SAVINGS'
        df.loc[df['Description'].str.contains('tomtom|tom tom', case=False, na=False, regex=True), 'Cleaned Merchant'] = 'TOMTOM'
        df.loc[df['Description'].str.contains('irving', case=False, na=False), 'Cleaned Merchant'] = 'Irving Gas'
        df.loc[df['Description'].str.contains('mori', case=False, na=False), 'Cleaned Merchant'] = 'Marriott Loan'
        if 'Transaction Type' in df.columns:
            df.loc[df['Transaction Type'].str.contains('atm', case=False, na=False), 'Cleaned Merchant'] = 'ATM'
            df.loc[df['Transaction Type'].str.contains('check', case=False, na=False), 'Cleaned Merchant'] = 'CHECK'
            df.loc[df['Transaction Type'].str.contains('transfer', case=False, na=False), 'Cleaned Merchant'] = 'TRANSFER'

    df['Date'] = pd.to_datetime(df['Date'], format='mixed', errors='coerce')
    df['YearMonth'] = df['Date'].dt.to_period('M')

    print("[*] Python is calculating historical mathematical trends...")

    if 'AI Category' not in df.columns:
        print("\n[ERROR] Could not find 'AI Category' in your master file.")
        print(f"Available columns are: {list(df.columns)}")
        print("Please delete 'master/all_time_finances.csv' and run 01_normalize.py again.")
        return

    # 2. Separate income vs expenses
    expense_df = df[df['AI Category'] != 'Income']
    income_df  = df[df['AI Category'] == 'Income']

    # 3. Monthly cash flow math
    monthly_income   = income_df.groupby('YearMonth')['Amount'].sum()
    monthly_expenses = expense_df.groupby('YearMonth')['Amount'].sum()
    monthly_net      = monthly_income + monthly_expenses  # expenses are negative values

    # 4. Category breakdown
    category_trends = expense_df.groupby(['YearMonth', 'AI Category'])['Amount'].sum().unstack(fill_value=0)

    # 5. Build text summary for AI prompt
    summary_output = "=== FINANCIAL HISTORICAL SUMMARY ===\n\n"
    summary_output += "--- MONTH-OVER-MONTH CASH FLOW ---\n"
    monthly_data = []
    for month in monthly_expenses.index:
        inc = monthly_income.get(month, 0)
        exp = monthly_expenses.get(month, 0)
        net = monthly_net.get(month, 0)
        monthly_data.append((str(month), inc, exp, net))
        summary_output += f"Month: {month} | Income: ${inc:,.2f} | Total Expenses: ${abs(exp):,.2f} | Net: ${net:,.2f}\n"

    summary_output += "\n--- TOP CATEGORY SPENDING PER MONTH ---\n"
    recent_trends = category_trends.tail(3)
    summary_output += recent_trends.to_string()

    # 6. Get AI analysis
    ai_report = generate_ai_insights(summary_output)

    # 7. Print to terminal
    print("\n" + "="*50)
    print("          MONTHLY FINANCIAL AUDIT REPORT          ")
    print("="*50 + "\n")
    print(summary_output)
    print("\n" + "-"*50)
    print("[AI] LOCAL AI STRATEGIC ANALYSIS & RECOMMENDATIONS")
    print("-"*50)
    print(ai_report)
    print("\n" + "="*50)

    # 8. Write HTML report and open it
    latest_month = str(df['YearMonth'].max()).replace('-', '_')
    report_path = os.path.join(REPORTS_FOLDER, f"{latest_month}_report.html")
    generate_html_report(monthly_data, category_trends, ai_report, report_path, df)
    import webbrowser
    webbrowser.open(os.path.abspath(report_path))

if __name__ == "__main__":
    main()
