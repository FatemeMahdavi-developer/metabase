import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const credentials = process.env.ANALYTICS_PASSWORD
    ? { email: process.env.ANALYTICS_EMAIL || 'admin@example.com', password: process.env.ANALYTICS_PASSWORD }
    : JSON.parse(fs.readFileSync(path.resolve('../.tools/admin.json'), 'utf8').replace(/^\uFEFF/, ''));
test.setTimeout(360000);

const names = {
    orders: { original: 'orders', fa: 'سفارش‌های آزمون', en: 'QA orders' },
    customers: { original: 'customers', fa: 'مشتریان آزمون', en: 'QA customers' },
    customer_id: { original: 'customer_id', fa: 'شناسهٔ مشتری آزمون', en: 'QA customer identifier' },
    total: { original: 'total', fa: 'مبلغ آزمون', en: 'QA total' },
    ordered_at: { original: 'ordered_at', fa: 'تاریخ سفارش آزمون', en: 'QA ordered at' },
    status: { original: 'status', fa: 'وضعیت آزمون', en: 'QA status' },
    city: { original: 'city', fa: 'شهر آزمون', en: 'QA city' },
};
const languageControl = page => page.locator('select[data-metadata-language]:visible');
const header = (page, key) => page.locator(`.mb-preview-body [data-table-sort="${key}"]`);
const root = page => page.locator('#analytics-studio');
const nativeListPaths = { dashboards: '/admin/analytics/dashboards', reports: '/admin/analytics/reports', connections: '/admin/analytics/databases' };
const nativeListLabels = { dashboards: 'داشبوردها', reports: 'گزارش‌ها', connections: 'پایگاه‌های داده' };

async function nativeList(page, view) {
    await page.locator('aside.fi-sidebar').getByRole('link', { name: nativeListLabels[view], exact: true }).click();
    await expect(page).toHaveURL(new RegExp(nativeListPaths[view] + '(?:\\?.*)?$'));
    await expect(page.locator('.fi-ta')).toBeVisible();
    await expect(root(page)).toHaveCount(0);
    await expect(page.locator('.mb-sidebar')).toHaveCount(0);
}

async function closeNativeDrawer(page) {
    const overlay = page.locator('.fi-sidebar-close-overlay');
    if (await overlay.isVisible()) await overlay.click({ position: { x: 5, y: 5 } });
    await expect(overlay).not.toBeVisible();
}

async function api(page, route, method = 'GET', payload) {
    return page.evaluate(async ({ route, method, payload }) => {
        const response = await fetch('/analytics/api/' + route, { method, headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]')?.content || document.querySelector('#analytics-studio')?.dataset.csrf }, ...(payload ? { body: JSON.stringify(payload) } : {}) });
        const body = await response.json(); if (!response.ok) throw new Error(JSON.stringify(body)); return body;
    }, { route, method, payload });
}

async function login(page) {
    page.on('dialog', async dialog => { if (dialog.type() === 'beforeunload') await dialog.accept(); else { await dialog.dismiss(); throw new Error('Unexpected browser dialog: ' + dialog.message()); } });
    await page.goto('/admin/login');
    await expect(page.locator('.fi-simple-layout')).toBeVisible();
    await page.locator('input[type=email]').fill(credentials.email);
    await page.locator('input[type=password]').fill(credentials.password);
    await page.locator('button[type=submit]').click();
    await expect(page).not.toHaveURL(/login/);
    await page.goto('/admin/analytics');
    await expect(page).toHaveURL(/\/admin\/analytics\/dashboards$/);
    await expect(page.locator('.fi-ta')).toBeVisible();
    await expect(root(page)).toHaveCount(0);
}

async function fixture(page, localized = false) {
    const source = (await api(page, 'library')).connections.find(row => row.driver === 'sqlite' && row.name === 'فروشگاه نمونه • SQLite' && row.catalog?.some(table => table.key === 'orders'));
    expect(source).toBeTruthy();
    const connection = await api(page, 'connections', 'POST', { name: 'Browser metadata language ' + Date.now(), driver: 'sqlite', configuration: source.configuration, test_first: true });
    const reports = [], dashboards = [];
    const base = { connection_id: connection.id, source: 'orders', mode: 'rows', columns: ['id', 'customer_id', 'ordered_at', 'status', 'total'], expressions: [], filters: [], joins: [], metrics: [], dimensions: [], sort: [], limit: null };
    const setNames = (table, field, item) => api(page, `connections/${connection.id}/metadata`, 'PUT', { table, field, labels: { fa: item.fa, en: item.en } });
    if (localized) {
        await setNames('orders', null, names.orders); await setNames('customers', null, names.customers);
        for (const key of ['customer_id', 'total', 'ordered_at', 'status']) await setNames('orders', key, names[key]);
        await setNames('customers', 'city', names.city);
    }
    return {
        connection, base, setNames,
        async report(label, query = {}) {
            const report = await api(page, 'reports', 'POST', { name: `Browser metadata language ${Date.now()} ${label}`, description: null, folder_id: null, display: 'table', visualization_settings: {}, query_definition: { ...base, ...query } });
            reports.push(report.id); return report;
        },
        async dashboard(label, widgets, filters = []) {
            const dashboard = await api(page, 'dashboards', 'POST', { name: `Browser metadata language ${Date.now()} ${label}`, description: null, folder_id: null }); dashboards.push(dashboard.id);
            return api(page, `dashboards/${dashboard.id}`, 'PUT', { ...dashboard, widgets, filters });
        },
        native: sql => api(page, 'reports/preview', 'POST', { query_definition: { ...base, mode: 'native', sql, parameters: [], columns: undefined } }),
        async cleanup() { for (const id of dashboards.reverse()) await api(page, `dashboards/${id}`, 'DELETE'); for (const id of reports.reverse()) await api(page, `reports/${id}`, 'DELETE'); await api(page, `connections/${connection.id}`, 'DELETE'); },
    };
}

async function browse(page, id) {
    await page.goto('/admin/analytics/databases/' + id);
    await expect(page).toHaveURL(new RegExp('/admin/analytics/databases/' + id + '$'));
    await expect(page.locator('.mb-sidebar')).toHaveCount(0);
    await expect(page.locator('.mb-schema-tables')).toBeVisible();
    await page.locator('[data-action=selectTable][data-key=orders]').click();
    await expect(page.locator('.mb-browser-preview .mb-table')).toBeVisible();
}

async function chooseLanguage(page, language) {
    await expect(languageControl(page)).toHaveCount(1);
    await languageControl(page).selectOption(language);
    await expect(root(page)).toHaveAttribute('data-metadata-language', language);
    await expect(languageControl(page)).toHaveValue(language);
}

async function closeDialog(page) {
    await page.locator('.mb-dialog[open] .fi-modal-close-btn').click();
    await expect(page.locator('.mb-dialog[open]')).toHaveCount(0);
}

async function metadataEditor(page, field, values) {
    await page.locator(field ? `[data-action=editDataMetadata][data-key="${field}"]` : '.mb-schema-heading [data-action=editDataMetadata]').click();
    await expect(page.locator('.mb-dialog[open] [data-original-name]')).toHaveValue(field || 'orders');
    await expect(page.locator('.mb-dialog[open] [data-original-name]')).toHaveAttribute('readonly', '');
    await expect(page.locator('.mb-dialog[open] [name=label]')).toHaveCount(0);
    await page.locator('.mb-dialog[open] [name=label_fa]').fill(values.fa);
    await page.locator('.mb-dialog[open] [name=label_en]').fill(values.en);
    await page.screenshot({ path: `tests/Browser/artifacts/metadata-${field || 'table'}-bilingual-form.png` });
    await page.locator('.mb-dialog[open] [data-action=saveDataMetadata]').click();
    await expect(page.locator('.mb-dialog[open]')).toHaveCount(0);
}

async function openReport(page, id) {
    await page.goto('/admin/analytics/reports/' + id);
    await expect(page).toHaveURL(new RegExp('/admin/analytics/reports/' + id + '$'));
    await expect.poll(() => page.evaluate(() => window.analyticsStudio.report?.id)).toBe(id);
    await expect(page.locator('.mb-preview-body .mb-table')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.analyticsStudio.previewResult?.rows.length || 0)).toBeGreaterThan(0);
}

async function currentResult(page) { return page.evaluate(() => ({ definition: window.analyticsStudio.report.query_definition, result: window.analyticsStudio.previewResult, dirty: window.analyticsStudio.dirty })); }
async function screenshot(page, name) { await page.screenshot({ path: 'tests/Browser/artifacts/' + name, fullPage: true }); }

test('original database names are the default and bilingual metadata persists through sync and source pickers', async ({ page }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await login(page);
    const data = await fixture(page);
    try {
        await browse(page, data.connection.id);
        await expect(languageControl(page)).toHaveValue('original');
        const prefKey = await page.evaluate(() => 'analytics-metadata-language:' + document.querySelector('#analytics-studio').dataset.user);
        await page.evaluate(key => localStorage.setItem(key, 'invalid-mode'), prefKey); await page.reload();
        await expect(languageControl(page)).toHaveValue('original');
        await page.locator('[data-action=selectTable][data-key=orders]').click();
        await expect(page.locator('.mb-browser-preview .mb-table')).toBeVisible();
        await expect(page.locator('[data-action=selectTable][data-key=orders]')).toHaveText('orders');
        await expect(page.locator('tr').filter({ has: page.locator('[data-action=editDataMetadata][data-key=customer_id]') }).locator('strong')).toHaveText('customer_id');
        await metadataEditor(page, null, names.orders);
        await metadataEditor(page, 'customer_id', names.customer_id);
        await page.locator('[data-action=syncConnection]').click();
        await expect(page.locator('.mb-browser-preview .mb-table')).toBeVisible();
        const saved = (await api(page, 'library')).connections.find(row => row.id === data.connection.id);
        const table = saved.catalog.find(row => row.key === 'orders'), column = table.fields.find(row => row.key === 'customer_id');
        const columnIndex = table.fields.findIndex(row => row.key === 'customer_id');
        expect(table.original_name).toBe('orders'); expect(table.display_names).toEqual(names.orders);
        expect(column.original_name).toBe('customer_id'); expect(column.display_names).toEqual(names.customer_id);
        expect(column.key).toBe('customer_id'); expect(column.relation.table).toBe('customers');
        for (const language of ['fa', 'en', 'original']) {
            await chooseLanguage(page, language);
            await expect(page.locator('[data-action=selectTable][data-key=orders]')).toHaveText(names.orders[language]);
            await expect(page.locator('tr').filter({ has: page.locator('[data-action=editDataMetadata][data-key=customer_id]') }).locator('strong')).toHaveText(names.customer_id[language]);
            await expect(page.locator('.mb-browser-preview thead th').nth(columnIndex)).toHaveText(names.customer_id[language]);
            expect(await page.evaluate(key => localStorage.getItem(key), prefKey)).toBe(language);
        }
        await chooseLanguage(page, 'en'); await page.reload();
        await expect(languageControl(page)).toHaveValue('en');
        await page.locator('aside.fi-sidebar').getByRole('link', { name: 'گزارش‌ها', exact: true }).click();
        await expect(page).toHaveURL(/\/admin\/analytics\/reports$/);
        await page.getByRole('link', { name: 'گزارش جدید', exact: true }).click();
        await page.locator(`.mb-dialog[open] [data-action=pickSourceConnection][data-id="${data.connection.id}"]`).click();
        await expect(languageControl(page)).toHaveCount(1);
        await expect(page.locator('#analytics-metadata-language-picker')).toBeVisible();
        await expect(page.locator('#analytics-metadata-language-global')).not.toBeVisible();
        await page.locator('.mb-dialog[open] [data-picker-search]').fill('orders');
        await chooseLanguage(page, 'fa');
        await expect(page.locator('.mb-dialog[open] [data-picker-search]')).toHaveValue('orders');
        await expect(page.locator(`.mb-dialog[open] .mb-picker-db.active[data-id="${data.connection.id}"]`)).toBeVisible();
        await expect(page.locator('.mb-dialog[open] [data-action=pickSourceTable][data-key=orders] .mb-grow')).toHaveText(names.orders.fa);
        await screenshot(page, 'metadata-persian-source-picker.png');
        await chooseLanguage(page, 'en');
        await expect(page.locator('.mb-dialog[open] [data-picker-search]')).toHaveValue('orders');
        await expect(page.locator('.mb-dialog[open] [data-action=pickSourceTable][data-key=orders] .mb-grow')).toHaveText(names.orders.en);
        await closeDialog(page); await expect(languageControl(page)).toHaveCount(1);
        await page.reload(); await expect(languageControl(page)).toHaveValue('en');
        // Clearing one translation falls back to the physical identifier and preserves the other language.
        await browse(page, data.connection.id); await metadataEditor(page, 'customer_id', { fa: names.customer_id.fa, en: '' });
        await expect(page.locator('.mb-browser-preview thead th').nth(columnIndex)).toHaveText('customer_id');
        await chooseLanguage(page, 'fa');
        await expect(page.locator('.mb-browser-preview thead th').nth(columnIndex)).toHaveText(names.customer_id.fa);
        const cleared = (await api(page, 'library')).connections.find(row => row.id === data.connection.id).catalog.find(row => row.key === 'orders').fields.find(row => row.key === 'customer_id');
        expect(cleared.display_names).toEqual({ original: 'customer_id', fa: names.customer_id.fa, en: 'customer_id' });
        expect(errors).toEqual([]);
    } finally { await data.cleanup(); }
});

test('display languages preserve physical keys, joins, computed aliases, month grains, native SQL and drill values', async ({ page }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await login(page); const data = await fixture(page, true);
    try {
        const first = await data.native('SELECT status FROM orders ORDER BY id ASC LIMIT 1');
        const status = first.rows[0].status, escaped = status.replaceAll("'", "''");
        const columns = ['id', 'customer_id', 'ordered_at', 'status', 'total', 'customer.city'];
        const raw = await data.report('joined rows', { columns, joins: [{ source: 'customers', alias: 'customer', type: 'left', conditions: [{ left: 'customer_id', operator: 'eq', right: 'id' }] }], filters: [{ field: 'status', operator: 'eq', value: status }], sort: [{ key: 'id', direction: 'asc' }], limit: 4, limit_explicit: true });
        const select = 'o.id,o.customer_id,o.ordered_at,o.status,o.total,c.city AS "customer.city"';
        const from = `FROM orders o LEFT JOIN customers c ON o.customer_id=c.id WHERE o.status='${escaped}'`;
        const oracle = await data.native(`SELECT ${select} ${from} ORDER BY o.id ASC LIMIT 4`);
        await openReport(page, raw.id); const baseline = await currentResult(page);
        expect(baseline.result.rows).toEqual(oracle.rows); expect(baseline.dirty).toBe(false);
        for (const language of ['original', 'fa', 'en']) {
            await chooseLanguage(page, language);
            await expect(header(page, 'customer_id')).toHaveText(names.customer_id[language]);
            await expect(header(page, 'customer.city')).toHaveText(language === 'original' ? 'customer.city' : names.customers[language] + ' → ' + names.city[language]);
            const current = await currentResult(page);
            expect(current.definition).toEqual(baseline.definition); expect(current.dirty).toBe(false);
            expect(current.result.sql).toBe(baseline.result.sql); expect(current.result.rows).toEqual(oracle.rows);
            expect(current.result.rows.every(row => row.status === status)).toBe(true);
            await page.locator('[data-action=toggleNotebook]').click();
            await expect(page.locator('[data-notebook-step=data] [data-action=changeSource]')).toContainText(names.orders[language]);
            await page.locator('[data-notebook-step=join] [data-action=editNotebookClause][data-index="0"]').first().click();
            await expect(page.locator('.mb-dialog[open] [name=source] option[value=customers]')).toHaveText(names.customers[language]);
            await expect(page.locator('.mb-dialog[open] [name=left_0] option[value=customer_id]')).toHaveText(names.customer_id[language]);
            await closeDialog(page);
            await page.locator('[data-action=addReportFilter]').click();
            await expect(page.locator('.mb-dialog[open] [name=field] option[value="customer.city"]')).toHaveText(language === 'original' ? 'customer.city' : names.customers[language] + ' → ' + names.city[language]);
            const descriptor = await page.evaluate(() => window.analyticsStudio.reportFields().find(row => row.key === 'customer.city'));
            expect(descriptor.original_name).toBe('customer.city'); expect(descriptor.display_names.original).toBe('customer.city');
            expect(descriptor.display_names.en).toBe(names.customers.en + ' → ' + names.city.en);
            expect(descriptor.display_names.fa).toBe(names.customers.fa + ' → ' + names.city.fa);
            await closeDialog(page); await page.locator('[data-action=toggleNotebook]').click();
        }
        // A foreign-key click keeps its integer value while its menu follows English metadata.
        const customer = baseline.result.rows[0].customer_id;
        await page.locator('.mb-preview-body [data-table-cell][data-column=customer_id]').first().click();
        await expect(page.locator('[data-drill-menu] header strong')).toHaveText(names.customer_id.en);
        await screenshot(page, 'metadata-english-drill-menu.png');
        await page.locator('[data-drill-menu] [data-drill-action=foreign_filter]').click();
        await expect(page.locator('.mb-drill-view')).toBeVisible();
        const drilled = await currentResult(page);
        expect(drilled.definition.filters).toContainEqual(expect.objectContaining({ field: 'customer_id', operator: 'eq', value: customer }));
        expect(drilled.result.rows).toEqual((await data.native(`SELECT ${select} ${from} AND o.customer_id=${customer} ORDER BY o.id ASC LIMIT 4`)).rows);
        expect((await api(page, 'library')).reports.find(row => row.id === raw.id).query_definition).toEqual(raw.query_definition);
        await page.locator('[data-action=returnFromDrill]').click();
        await page.locator('[data-action=toggleNotebook]').click();
        await page.locator('[data-action=openNotebookStep][data-kind=expression][data-stage="0"]').click();
        await page.locator('.mb-dialog[open] [name=label]').fill('QA computed amount');
        await page.locator('.mb-dialog[open] [name=expression]').fill('round([QA total] * 0.1, 2)');
        await expect(page.locator('[data-expression-status][data-state=valid]')).toBeVisible();
        await screenshot(page, 'metadata-english-expression-editor.png');
        await page.locator('[data-action=saveExpression]').click(); await expect(page.locator('.mb-dialog[open]')).toHaveCount(0);
        const formula = await page.evaluate(() => window.analyticsStudio.report.query_definition.expressions[0]);
        expect(formula.label).toBe('QA computed amount'); expect(formula.expression).toContain('[total]'); expect(formula.expression).not.toContain('[QA total]');
        await page.getByRole('button', { name: 'نمایش نتیجه', exact: true }).click();
        await expect(page.locator('.mb-preview-body .mb-table')).toBeVisible();
        const calculated = await currentResult(page);
        expect(calculated.result.rows).toEqual((await data.native(`SELECT ${select},ROUND(o.total*0.1,2) AS "${formula.key}" ${from} ORDER BY o.id ASC LIMIT 4`)).rows);
        await page.locator('[data-action=reportSaveDialog]').click(); await page.locator('.mb-dialog[open] [data-action=saveReport]').click();
        await expect(page.locator('.mb-dialog[open]')).toHaveCount(0); await openReport(page, raw.id);
        expect((await api(page, 'library')).reports.find(row => row.id === raw.id).query_definition.expressions[0]).toEqual(formula);
        for (const language of ['fa', 'original', 'en']) {
            await chooseLanguage(page, language); await expect(header(page, formula.key)).toHaveText('QA computed amount');
            expect((await currentResult(page)).definition).toEqual(calculated.definition);
            expect((await currentResult(page)).dirty).toBe(false);
        }
        const monthly = await data.report('month grain', { mode: 'aggregate', columns: undefined, joins: [], filters: [{ field: 'status', operator: 'eq', value: status }], metrics: [{ key: 'revenue', label: 'QA revenue', function: 'sum', field: 'total' }], dimensions: [{ field: 'ordered_at', grain: 'month' }], sort: [{ key: 'ordered_at', direction: 'asc' }] });
        const monthlyOracle = await data.native(`SELECT strftime('%Y-%m-01',ordered_at) AS ordered_at,SUM(total) AS revenue FROM orders WHERE status='${escaped}' GROUP BY strftime('%Y-%m-01',ordered_at) ORDER BY ordered_at ASC`);
        await openReport(page, monthly.id); const monthBaseline = await currentResult(page);
        for (const language of ['original', 'fa', 'en']) {
            await chooseLanguage(page, language); await expect(header(page, 'ordered_at')).toContainText(names.ordered_at[language]); await expect(header(page, 'revenue')).toHaveText('QA revenue');
            const current = await currentResult(page);
            expect(current.definition).toEqual(monthBaseline.definition); expect(current.result.sql).toBe(monthBaseline.result.sql); expect(current.result.rows).toEqual(monthlyOracle.rows);
            expect(current.result.columns.find(row => row.key === 'ordered_at').grain).toBe('month'); expect(current.dirty).toBe(false);
        }
        const sql = 'SELECT id AS qa_order_id,customer_id AS qa_customer_alias,status AS qa_status_value FROM orders ORDER BY id ASC LIMIT 4';
        const native = await data.report('native aliases', { mode: 'native', sql, parameters: [], columns: undefined });
        await openReport(page, native.id); const nativeOracle = await data.native(sql);
        for (const language of ['original', 'fa', 'en']) {
            await chooseLanguage(page, language);
            for (const key of ['qa_order_id', 'qa_customer_alias', 'qa_status_value']) await expect(header(page, key)).toHaveText(key);
            await expect(page.locator('[data-sql]')).toHaveValue(sql);
            const current = await currentResult(page); expect(current.result.rows).toEqual(nativeOracle.rows); expect(current.definition.sql).toBe(sql); expect(current.dirty).toBe(false);
        }
        await screenshot(page, 'metadata-native-aliases-unchanged.png'); expect(errors).toEqual([]);
    } finally { await data.cleanup(); }
});

const nativeThemeLabels = { light: 'حالت روشن', dark: 'حالت تیره' };
async function nativeTheme(page, mode) {
    if (!await page.locator('.fi-theme-switcher').isVisible()) await page.getByRole('button', { name: 'منوی کاربر', exact: true }).click();
    await expect(page.locator('.fi-theme-switcher')).toBeVisible();
    await expect(page.locator('.fi-theme-switcher')).toHaveCount(1); await expect(page.locator('.fi-theme-switcher button')).toHaveCount(3);
    await page.locator('.fi-theme-switcher').getByRole('button', { name: nativeThemeLabels[mode], exact: true }).click();
    await expect(page.locator('html')).toHaveClass(mode === 'dark' ? /dark/ : /^(?!.*\bdark\b).*$/);
    await expect(page.locator('.fi-theme-switcher')).not.toBeVisible();
}

async function themeColors(page) {
    return page.evaluate(() => {
        const rootStyle = getComputedStyle(document.documentElement), bodyStyle = getComputedStyle(document.body), canvas = document.createElement('canvas').getContext('2d');
        const hex = value => { canvas.fillStyle = '#ff00ff'; canvas.fillStyle = value.trim(); return canvas.fillStyle.toLowerCase(); };
        return { page: hex(rootStyle.getPropertyValue('--soar-page-bg')), surface: hex(rootStyle.getPropertyValue('--soar-surface')), primary: hex(rootStyle.getPropertyValue('--soar-primary')), text: hex(rootStyle.getPropertyValue('--soar-text')), body: hex(bodyStyle.backgroundColor) };
    });
}

test('the supplied panel theme styles native Filament and analytics in light, dark and mobile layouts', async ({ page }) => {
    const errors = [], failed = []; page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400 && ['stylesheet', 'script', 'document'].includes(response.request().resourceType())) failed.push(response.status() + ' ' + response.url()); });
    await login(page);
    const expected = { light: { page: '#dadbef', surface: '#ffffff', primary: '#3a4de9', text: '#111827', body: '#dadbef' }, dark: { page: '#383838', surface: '#262626', primary: '#818cf8', text: '#f8fafc', body: '#383838' } };
    await page.goto('/admin'); await expect(page.locator('.fi-sidebar')).toBeVisible(); await expect(page.locator('.fi-wi-widget').first()).toBeVisible();
    for (const mode of ['light', 'dark']) {
        await nativeTheme(page, mode); await expect.poll(() => themeColors(page)).toEqual(expected[mode]);
        await screenshot(page, `panel-native-${mode}.png`);
        await page.getByRole('button', { name: 'منوی کاربر', exact: true }).click();
        await expect(page.locator('.fi-user-menu .fi-dropdown-panel')).toBeVisible();
        const popup = await page.locator('.fi-user-menu .fi-dropdown-panel').evaluate(node => ({ background: getComputedStyle(node).backgroundColor, radius: getComputedStyle(node).borderRadius }));
        expect(popup.radius).toBe('12px'); expect(popup.background).toBe(mode === 'dark' ? 'rgb(38, 38, 38)' : 'rgb(255, 255, 255)');
        await screenshot(page, `panel-native-user-menu-${mode}.png`); await page.keyboard.press('Escape');
        await expect(page.locator('.fi-theme-switcher')).not.toBeVisible();
    }
    const themeSheets = await page.locator('link[rel=stylesheet]').evaluateAll(nodes => nodes.map(node => node.href).filter(href => /panel-theme[^/]*\.css/.test(href)));
    expect(themeSheets).toHaveLength(1);
    const stylesheet = await page.request.get(themeSheets[0]); expect(stylesheet.status()).toBe(200); expect(await stylesheet.text()).toContain('--soar-page-bg');
    const library = await api(page, 'library'), sample = library.dashboards.find(board => board.name === 'نمای کلی فروشگاه');
    expect(sample).toBeTruthy();
    expect((await api(page, `dashboards/${sample.id}`)).widgets.some(widget => widget.type === 'report')).toBe(true);
    await page.goto('/admin/analytics/dashboards/' + sample.id); await expect(page.locator('.mb-card').first()).toBeVisible();
    await expect(page.locator('.mb-card .mb-loading')).toHaveCount(0);
    for (const mode of ['light', 'dark']) {
        await expect.poll(() => page.evaluate(() => window.analyticsStudio?.view === 'dashboard' ? window.analyticsStudio.dashboard?.id : null)).toBe(sample.id);
        await expect(page.locator('.mb-card').first()).toBeVisible(); await expect(page.locator('.mb-card .mb-loading')).toHaveCount(0);
        await nativeTheme(page, mode); await expect(root(page)).toHaveAttribute('data-analytics-theme', mode);
        await expect.poll(() => themeColors(page)).toEqual(expected[mode]);
        await expect(page.locator('[data-analytics-theme-controls], [data-action=setAnalyticsTheme], .mb-appearance-bar')).toHaveCount(0);
        await expect(page.locator('aside.fi-sidebar')).toBeVisible();
        await expect(page.locator('.mb-sidebar')).toHaveCount(0);
        await expect(languageControl(page)).toHaveCount(1);
        await screenshot(page, `panel-analytics-${mode}.png`);
        await nativeList(page, 'connections'); await page.getByRole('button', { name: 'پایگاه داده جدید', exact: true }).click();
        const connectionModal = page.locator('.fi-modal.fi-modal-open .fi-modal-window:visible');
        await expect(connectionModal).toBeVisible(); await expect(languageControl(page)).toHaveCount(0);
        const pathInput = connectionModal.locator('input[id$=".configuration.path"]');
        await expect(pathInput).toBeVisible();
        await expect(connectionModal.locator('.fi-input-wrp').first()).toBeVisible();
        const fieldStyle = await pathInput.evaluate(node => ({ background: getComputedStyle(node).backgroundColor, color: getComputedStyle(node).color, width: node.getBoundingClientRect().width }));
        expect(fieldStyle.background).not.toBe(fieldStyle.color); expect(fieldStyle.width).toBeGreaterThan(250);
        await screenshot(page, `panel-connection-form-${mode}.png`); await connectionModal.locator('.fi-modal-close-btn').click();
        await expect(connectionModal).not.toBeVisible();
        await nativeList(page, 'dashboards');
        await page.locator('.fi-ta-search-field input').fill(sample.name);
        await page.locator('.fi-ta tbody tr').filter({ hasText: sample.name }).getByRole('link', { name: 'باز کردن', exact: true }).click();
    }
    // A native list navigation cancels an editor GET; a late response must not revive the old page or clear its search.
    await nativeList(page, 'dashboards');
    await heldDashboard(page, sample.id, 1, () => page.goto('/admin/analytics/dashboards/' + sample.id, { waitUntil: 'domcontentloaded' }), 'نمای کلی');
    const searchValue = await page.locator('.fi-ta-search-field input').inputValue();
    await page.setViewportSize({ width: 390, height: 844 });
    await closeNativeDrawer(page);
    await expect(page.locator('.fi-ta-search-field input')).toHaveValue(searchValue);
    await expect(root(page)).toHaveCount(0);
    await expect(page.locator('.fi-topbar-open-sidebar-btn:visible, .fi-topbar-close-sidebar-btn:visible')).toHaveCount(1);
    await screenshot(page, 'panel-native-library-mobile.png');
    await page.goto('/admin/analytics/dashboards/' + sample.id);
    await closeNativeDrawer(page);
    await expect.poll(() => page.evaluate(() => window.analyticsStudio?.view === 'dashboard' ? window.analyticsStudio.dashboard?.id : null)).toBe(sample.id);
    await expect(page.locator('.mb-workbench-tools .mb-metadata-language')).toHaveClass(/compact/);
    for (const [language, label] of [['original', 'DB'], ['fa', 'FA'], ['en', 'EN'], ['original', 'DB']]) {
        await chooseLanguage(page, language); await expect(languageControl(page).locator('option:checked')).toHaveText(label);
    }
    await screenshot(page, 'panel-workbench-mobile-language.png');
    await expect(page.locator('.mb-card').first()).toBeVisible(); await expect(page.locator('.mb-card .mb-loading')).toHaveCount(0);
    for (const mode of ['dark', 'light']) {
        await nativeTheme(page, mode); await expect(root(page)).toHaveAttribute('data-analytics-theme', mode);
        await expect(languageControl(page)).toHaveCount(1);
        await expect(page.locator('.fi-topbar-open-sidebar-btn:visible, .fi-topbar-close-sidebar-btn:visible')).toHaveCount(1);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
        await screenshot(page, `panel-analytics-mobile-${mode}.png`);
    }
    await page.reload(); await closeNativeDrawer(page); await expect(root(page)).toHaveAttribute('data-analytics-theme', 'light');
    expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('light');
    expect(await page.evaluate(() => localStorage.getItem('analytics-theme'))).toBeNull();
    expect(errors).toEqual([]); expect(failed).toEqual([]);
});

function widget(report, behavior = { type: 'menu' }) {
    return { key: 'rows', type: 'report', report_id: report.id, tab_key: 'main', x: 0, y: 0, w: 24, h: 8, settings: {}, content: null, click_behavior: behavior };
}

async function openDashboard(page, id) {
    await page.goto('/admin/analytics/dashboards/' + id);
    await expect.poll(() => page.evaluate(() => window.analyticsStudio?.view === 'dashboard' ? window.analyticsStudio.dashboard?.id : null)).toBe(id);
    await expect(page.locator('[data-widget=rows] .mb-table')).toBeVisible();
    await expect(page.locator('.mb-card .mb-loading')).toHaveCount(0);
}

async function heldDashboard(page, id, openingRequest, action, search = '') {
    const routePath = '/analytics/api/dashboards/' + id;
    let release, finished;
    const gate = new Promise(resolve => { release = resolve; });
    const heldFinished = new Promise(resolve => { finished = resolve; });
    let requests = 0, continuationError = null;
    const handler = async route => {
        const held = ++requests === openingRequest;
        if (held) await gate;
        try { await route.continue(); }
        catch (error) { continuationError = error.message; }
        finally { if (held) finished(); }
    };
    await page.route('**' + routePath, handler);
    try {
        await action(); await expect.poll(() => requests).toBe(openingRequest);
        const caller = await page.evaluate(() => ({
            dashboard: window.analyticsStudio.dashboard,
            reportId: window.analyticsStudio.report?.id,
            section: window.analyticsStudio.root.dataset.section,
            record: window.analyticsStudio.root.dataset.record,
            initial: window.analyticsStudio.nativeInitial,
            url: window.location.pathname + window.location.search,
            editing: window.analyticsStudio.editing,
            dirty: window.analyticsStudio.dirty,
            pendingReport: window.analyticsStudio.pendingReportId,
        }));
        await nativeList(page, 'dashboards');
        if (search) await page.locator('.fi-ta-search-field input').fill(search);
        release(); await heldFinished;
        if (continuationError) expect(continuationError).toMatch(/already handled|target.*closed|aborted|closed|cancel/i);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await expect(page.locator('.fi-ta')).toBeVisible();
        await expect(page.locator('.fi-ta-search-field input')).toHaveValue(search);
        await expect(root(page)).toHaveCount(0);
        expect(await page.evaluate(() => typeof window.analyticsStudio)).toBe('undefined');
        return caller;
    } finally { release(); await page.unroute('**' + routePath, handler); }
}

test('cancelled dashboard callers preserve the previous board and mapped filters never leak into a plain reopen', async ({ page }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message)); await login(page);
    const data = await fixture(page);
    try {
        const statuses = (await data.native('SELECT DISTINCT status FROM orders ORDER BY status ASC')).rows.map(row => row.status);
        expect(statuses.length).toBeGreaterThan(1);
        const sourceStatus = statuses[0], defaultStatus = statuses.at(-1), escaped = value => value.replaceAll("'", "''");
        expect(sourceStatus).not.toBe(defaultStatus);
        const destinationReport = await data.report('cancel destination rows', { sort: [{ key: 'id', direction: 'asc' }], limit: 4, limit_explicit: true });
        const sourceReport = await data.report('cancel source rows', { filters: [{ field: 'status', operator: 'eq', value: sourceStatus }], sort: [{ key: 'id', direction: 'asc' }], limit: 4, limit_explicit: true });
        const destination = await data.dashboard('cancel destination', [widget(destinationReport)], [{ key: 'status', label: 'وضعیت پیش‌فرض مقصد', type: 'text', required: false, default_value: defaultStatus, settings: {}, bindings: [{ widget_key: 'rows', target: 'status', operator: 'eq' }] }]);
        const source = await data.dashboard('cancel mapped source', [widget(sourceReport, { type: 'menu', columns: { status: { type: 'dashboard', dashboard_id: destination.id, mappings: [{ target: 'status', source: 'column', key: 'status' }] } } })]);
        await openDashboard(page, destination.id);
        const previousDashboard = await api(page, `dashboards/${destination.id}`);
        await openReport(page, sourceReport.id);
        await page.locator('[data-action=reportSaveDialog]').click(); await page.locator('.mb-dialog[open] [name=add_to_dashboard]').check();
        await page.locator('.mb-dialog[open] [data-action=saveReport]').click();
        await expect(page.locator(`.mb-dialog[open] [data-action=reportToDashboard][data-id="${destination.id}"]`)).toBeVisible();
        const cancelledCaller = await heldDashboard(page, destination.id, 1, () => page.locator(`.mb-dialog[open] [data-action=reportToDashboard][data-id="${destination.id}"]`).click());
        // The native target page has received the command, but the held GET must not add anything yet.
        expect(cancelledCaller.dashboard).toBeUndefined(); expect(cancelledCaller.reportId).toBeUndefined();
        expect(cancelledCaller.section).toBe('dashboard'); expect(cancelledCaller.record).toBe(String(destination.id));
        expect(cancelledCaller.initial.add_report).toBe(String(sourceReport.id));
        expect(cancelledCaller.url).toBe(`/admin/analytics/dashboards/${destination.id}?add_report=${sourceReport.id}`);
        expect(cancelledCaller.editing).toBe(false); expect(cancelledCaller.dirty).toBe(false); expect(cancelledCaller.pendingReport).toBeUndefined();
        const persisted = await api(page, `dashboards/${destination.id}`);
        expect(persisted).toEqual(previousDashboard);
        expect(persisted.widgets).toHaveLength(1); expect(persisted.widgets[0].report_id).toBe(destinationReport.id); expect(persisted.version).toBe(destination.version);
        // A completed native command adds a draft once; cancelling it and refreshing restores the saved board.
        await page.goto(`/admin/analytics/dashboards/${destination.id}?add_report=${sourceReport.id}`);
        await expect(page.locator('.mb-editbar')).toBeVisible();
        await expect(page.locator('.mb-card')).toHaveCount(2);
        await expect(page).toHaveURL(new RegExp('/admin/analytics/dashboards/' + destination.id + '$'));
        await page.locator('[data-action=cancelDashboard]').click();
        await page.locator('.mb-dialog[open] [data-action=confirmAction]').click();
        await expect(page.locator('.mb-editbar')).toHaveCount(0);
        await expect(page.locator('.mb-card')).toHaveCount(1);
        await page.reload();
        await expect(page.locator('.mb-card')).toHaveCount(1);
        await expect(page.locator('.mb-editbar')).toHaveCount(0);
        expect(await api(page, `dashboards/${destination.id}`)).toEqual(previousDashboard);
        await openDashboard(page, source.id);
        await expect.poll(() => page.evaluate(() => window.analyticsStudio.results.get('rows')?.rows[0]?.status)).toBe(sourceStatus);
        // The first destination GET validates mappings; the second opens the dashboard with local click parameters.
        const cancelledMappedCaller = await heldDashboard(page, destination.id, 2, () => page.locator('[data-widget=rows] [data-table-cell][data-column=status]').first().click());
        expect({ id: cancelledMappedCaller.dashboard.id, editing: cancelledMappedCaller.editing, dirty: cancelledMappedCaller.dirty }).toEqual({ id: source.id, editing: false, dirty: false });
        expect((await api(page, `dashboards/${source.id}`)).widgets).toEqual(source.widgets);
        expect(await api(page, `dashboards/${destination.id}`)).toEqual(previousDashboard);
        await openDashboard(page, destination.id);
        await expect.poll(() => page.evaluate(() => window.analyticsStudio.appliedValues.status)).toBe(defaultStatus);
        const defaults = await data.native(`SELECT id,customer_id,ordered_at,status,total FROM orders WHERE status='${escaped(defaultStatus)}' ORDER BY id ASC LIMIT 4`);
        await expect.poll(() => page.evaluate(() => window.analyticsStudio.results.get('rows')?.rows)).toEqual(defaults.rows);
        expect(await page.evaluate(() => window.analyticsStudio.dashboard.widgets.map(row => row.report_id))).toEqual([destinationReport.id]);
        await expect(page.locator('.mb-editbar')).toHaveCount(0); await screenshot(page, 'navigation-cancel-plain-defaults.png');
        // A completed click still applies its mapped value; cancellation must not disable valid navigation.
        await openDashboard(page, source.id); await page.locator('[data-widget=rows] [data-table-cell][data-column=status]').first().click();
        await expect.poll(() => page.evaluate(() => window.analyticsStudio.view === 'dashboard' ? window.analyticsStudio.dashboard.id : null)).toBe(destination.id);
        await expect.poll(() => page.evaluate(() => window.analyticsStudio.appliedValues.status)).toBe(sourceStatus);
        const mapped = await data.native(`SELECT id,customer_id,ordered_at,status,total FROM orders WHERE status='${escaped(sourceStatus)}' ORDER BY id ASC LIMIT 4`);
        await expect.poll(() => page.evaluate(() => window.analyticsStudio.results.get('rows')?.rows)).toEqual(mapped.rows);
        expect(new URL(page.url()).pathname).toBe('/admin/analytics/dashboards/' + destination.id);
        expect(JSON.parse(new URL(page.url()).searchParams.get('filters'))).toEqual({ status: sourceStatus });
        await page.reload();
        await expect.poll(() => page.evaluate(() => window.analyticsStudio?.appliedValues?.status)).toBe(sourceStatus);
        await expect.poll(() => page.evaluate(() => window.analyticsStudio?.results.get('rows')?.rows)).toEqual(mapped.rows);
        await openDashboard(page, destination.id);
        await expect.poll(() => page.evaluate(() => window.analyticsStudio.appliedValues.status)).toBe(defaultStatus);
        await expect.poll(() => page.evaluate(() => window.analyticsStudio.results.get('rows')?.rows)).toEqual(defaults.rows);
        expect((await api(page, `dashboards/${destination.id}`)).filters[0].default_value).toBe(defaultStatus);
        expect((await api(page, 'library')).reports.find(row => row.id === sourceReport.id).query_definition).toEqual(sourceReport.query_definition);
        expect(errors).toEqual([]);
    } finally { await data.cleanup(); }
});
