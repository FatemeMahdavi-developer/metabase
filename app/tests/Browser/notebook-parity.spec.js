import { test, expect } from '@playwright/test';
import { api, editorModal, login, newReport } from './helpers/native-analytics.js';

// These scenarios exercise server validation, native modal flows and persisted editor URLs.
test.setTimeout(300000);

const section = (page, kind, stage = 0) => page.locator(`[data-notebook-step="${kind}"][data-stage="${stage}"]`);

async function operation(page, kind, stage = 0) {
    await expect(editorModal(page)).toHaveCount(0);
    const button = page.locator(`[data-action=openNotebookStep][data-kind="${kind}"][data-stage="${stage}"]`).first();
    const list = { expression: 'expressions', sort: 'sort', filter: 'filters', summarize: 'metrics', join: 'joins' }[kind];
    const control = kind === 'limit' ? section(page, 'limit', stage).locator('[data-row-limit]') : section(page, kind, stage).locator(`[data-action=editNotebookClause][data-list="${list}"][data-index="-1"]`);
    await expect.poll(async () => await button.isVisible() || await control.isVisible()).toBe(true);
    if (await button.isVisible()) await button.click();
    else if (kind === 'limit') await control.focus();
    else await control.click();
}

async function expression(page, label, formula, artifact) {
    await editorModal(page).locator('[name=label]').fill(label);
    await editorModal(page).locator('[name=expression]').fill(formula);
    await expect(page.locator('[data-expression-status][data-state=valid]')).toBeVisible();
    if (artifact) {
        const numbers = page.locator('[data-expression-highlight] .mb-expression-token.number');
        await expect(numbers).toHaveCount(2);
        await expect(numbers.nth(0)).toHaveText('0.1');
        await expect(numbers.nth(1)).toHaveText('2');
        const first = await numbers.nth(0).boundingBox(); const second = await numbers.nth(1).boundingBox();
        expect(first.x).toBeLessThan(second.x);
        await snapshot(page, artifact);
    }
    await editorModal(page).locator('[data-action=saveExpression]').click();
    await expect(editorModal(page)).toHaveCount(0);
}

async function snapshot(page, artifact) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: 'tests/Browser/artifacts/' + artifact, fullPage: true });
}

async function rowLimit(page, limit, stage = 0) {
    const control = section(page, 'limit', stage).locator('[data-row-limit]');
    await expect(control).toBeVisible();
    await control.fill(String(limit));
    await control.press('Tab');
    await expect.poll(() => page.evaluate(stage => {
        const q = window.analyticsStudio.report.query_definition;
        return (stage ? q.stages[stage - 1] : q).limit;
    }, stage)).toBe(limit);
}

async function run(page) {
    await page.getByRole('button', { name: 'نمایش نتیجه', exact: true }).click();
    await expect(page.locator('.mb-preview-body .mb-table')).toBeVisible();
    return page.evaluate(() => window.analyticsStudio.previewResult);
}

async function notebook(page) {
    if (!await page.locator('.mb-notebook').isVisible()) await page.locator('[data-action=toggleNotebook]').click();
    await expect(page.locator('.mb-notebook')).toBeVisible();
}

async function save(page, name) {
    await page.locator('[data-action=reportSaveDialog]').click();
    await editorModal(page).locator('[name=name]').fill(name);
    await editorModal(page).locator('[data-action=saveReport]').click();
    await expect(editorModal(page)).toHaveCount(0);
    return page.evaluate(() => window.analyticsStudio.report.id);
}

async function reloadReport(page, id) {
    await expect(page).toHaveURL(new RegExp('/admin/analytics/reports/' + id + '$'));
    await page.reload();
    await expect(page.locator('.mb-preview-body .mb-table')).toBeVisible();
    await expect(page).toHaveURL(new RegExp('/admin/analytics/reports/' + id + '$'));
    await notebook(page);
}

async function newOrders(page) {
    await newReport(page, 'orders');
    await expect(page.locator('[data-notebook-step=data]')).toContainText('orders');
}

test('custom column, inline sort and row limit remain visible, editable and removable after reload', async ({ page }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await login(page); let reportId;
    try {
        await newOrders(page);
        const totalLabel = await page.evaluate(() => window.analyticsStudio.reportFields().find(column => column.key === 'total').label);
        await operation(page, 'expression');
        await editorModal(page).locator('[name=label]').fill('ده درصد فروش');
        await editorModal(page).locator('[name=expression]').fill(`[${totalLabel}] *`);
        await expect(page.locator('[data-expression-status][data-state=error]')).toBeVisible();
        await expect(page.locator('[data-action=saveExpression]')).toBeDisabled();
        await editorModal(page).locator('[name=expression]').fill('[tot');
        await expect(page.locator('[data-expression-suggestions] [role=option]')).toHaveCount(1);
        await editorModal(page).locator('[name=expression]').press('Enter');
        await expect(editorModal(page).locator('[name=expression]')).toHaveValue(`[${totalLabel}]`);
        await page.locator('[data-action=toggleExpressionBrowser]').click();
        await page.locator('[data-expression-browser-search]').fill('round');
        await expect(page.locator('[data-action=insertExpressionFunction][data-key=round]')).toBeVisible();
        await expect(page.locator('[data-expression-function-list]')).toContainText('round');
        const preservedFormula = `round([${totalLabel}] * 0.1, 2)`;
        await editorModal(page).locator('[name=expression]').fill(preservedFormula);
        await editorModal(page).locator('[name=expression]').evaluate(editor => { editor.setSelectionRange(2, 2); editor.dispatchEvent(new Event('click', { bubbles: true })); });
        await expect(page.locator('[data-expression-suggestions] [role=option]')).toHaveCount(1);
        await editorModal(page).locator('[name=expression]').press('Enter');
        await expect(editorModal(page).locator('[name=expression]')).toHaveValue(preservedFormula);
        await expression(page, 'ده درصد فروش', `round([${totalLabel}] * 0.1, 2)`, 'notebook-expression-editor.png');
        await expect(section(page, 'expression')).toContainText('ده درصد فروش');
        const customKey = await page.evaluate(() => window.analyticsStudio.report.query_definition.expressions[0].key);
        expect(await page.evaluate(() => window.analyticsStudio.report.query_definition.expressions[0].expression)).toContain('[total]');

        await operation(page, 'sort');
        await editorModal(page).locator('[name=direction]').selectOption('desc');
        await editorModal(page).locator('[data-action=chooseSortColumn][data-key=total]').click();
        await expect(editorModal(page)).toHaveCount(0);
        await section(page, 'sort').locator('[data-action=toggleSortDirection]').click();
        await expect.poll(() => page.evaluate(() => window.analyticsStudio.report.query_definition.sort[0].direction)).toBe('asc');

        await operation(page, 'limit');
        await rowLimit(page, 5000);
        await rowLimit(page, 3);
        const positions = await page.locator('[data-notebook-step][data-stage="0"]').evaluateAll(nodes => nodes.map(node => node.dataset.notebookStep));
        expect(positions.indexOf('expression')).toBeLessThan(positions.indexOf('filter'));
        expect(positions.indexOf('expression')).toBeLessThan(positions.indexOf('summarize'));
        expect(positions.indexOf('sort')).toBeLessThan(positions.indexOf('limit'));
        await snapshot(page, 'notebook-inline-steps.png');

        const definition = await page.evaluate(() => window.analyticsStudio.report.query_definition);
        const oracle = await api(page, 'reports/preview', 'POST', { query_definition: { connection_id: definition.connection_id, source: 'orders', mode: 'native', sql: 'SELECT total, ROUND(total * 0.1, 2) AS computed FROM orders ORDER BY total ASC LIMIT 3', parameters: [] } });
        const result = await run(page);
        expect(result.rows).toHaveLength(3);
        expect(result.rows.map(row => row.total)).toEqual(oracle.rows.map(row => row.total));
        for (let index = 0; index < result.rows.length; index++) expect(result.rows[index][customKey]).toBeCloseTo(oracle.rows[index].computed, 6);
        expect(result.meta.truncated).toBe(false);

        reportId = await save(page, 'Notebook inline parity ' + Date.now());
        await reloadReport(page, reportId);
        await expect(section(page, 'expression')).toContainText('ده درصد فروش');
        await expect(section(page, 'limit').locator('[data-row-limit]')).toHaveValue('3');
        await section(page, 'expression').locator('[data-action=editNotebookClause][data-list=expressions][data-index="0"]').click();
        await expect(editorModal(page).locator('[name=expression]')).toHaveValue(`round([${totalLabel}] * 0.1, 2)`);
        await expression(page, 'بیست درصد فروش', `round([${totalLabel}] * 0.2, 2)`);
        const revised = await run(page);
        const revisedOracle = await api(page, 'reports/preview', 'POST', { query_definition: { connection_id: definition.connection_id, source: 'orders', mode: 'native', sql: 'SELECT total, ROUND(total * 0.2, 2) AS computed FROM orders ORDER BY total ASC LIMIT 3', parameters: [] } });
        for (let index = 0; index < revised.rows.length; index++) expect(revised.rows[index][customKey]).toBeCloseTo(revisedOracle.rows[index].computed, 6);
        await notebook(page);
        const removals = [];
        const captureRemoval = response => { if (response.url().endsWith('/reports/validate') && response.request().method() === 'POST') removals.push(response); };
        const delayedValidation = async route => { await new Promise(resolve => setTimeout(resolve, 250)); await route.continue(); };
        page.on('response', captureRemoval);
        await page.route('**/analytics/api/reports/validate', delayedValidation);
        try {
            await section(page, 'limit').locator('[data-action=removeNotebookSection][data-type=limit]').click();
            await section(page, 'sort').locator('[data-action=removeNotebookSection][data-type=sort]').click();
            await section(page, 'expression').locator('[data-action=removeNotebookSection][data-type=expression]').click();
            await expect.poll(() => removals.length).toBe(3);
            await Promise.all(removals.map(response => response.finished()));
            await page.evaluate(async () => { while (window.analyticsStudio.notebookPendingValidation) await window.analyticsStudio.notebookPendingValidation; });
            expect(removals.map(response => response.status())).toEqual([200, 200, 200]);
        } finally {
            await page.unroute('**/analytics/api/reports/validate', delayedValidation);
            page.off('response', captureRemoval);
        }
        await expect(section(page, 'limit')).toHaveCount(0);
        await expect(section(page, 'sort')).toHaveCount(0);
        await expect(section(page, 'expression')).toHaveCount(0);
        const cleared = await page.evaluate(() => window.analyticsStudio.report.query_definition);
        expect(cleared.limit).toBeNull(); expect(cleared.limit_explicit).toBe(false);
        expect(cleared.sort).toEqual([]); expect(cleared.expressions).toEqual([]);
        const raw = await run(page);
        expect(raw.rows.length).toBeGreaterThan(3);
        expect(raw.columns.some(column => column.key === customKey)).toBe(false);
        await save(page, 'Notebook inline parity ' + reportId);
        await reloadReport(page, reportId);
        const persisted = await page.evaluate(() => window.analyticsStudio.report.query_definition);
        expect(persisted.limit).toBeNull(); expect(persisted.sort).toEqual([]); expect(persisted.expressions).toEqual([]);
        await expect(section(page, 'limit')).toHaveCount(0);
        await expect(section(page, 'sort')).toHaveCount(0);
        await expect(section(page, 'expression')).toHaveCount(0);
        expect(errors).toEqual([]);
    } finally { if (reportId) await api(page, `reports/${reportId}`, 'DELETE'); }
});

test('custom column after summarizing creates the next stage with its own visible sort and limit', async ({ page }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await login(page); let reportId;
    try {
        await newOrders(page);
        await page.locator('[data-action=addMetric]').click();
        await editorModal(page).locator('[data-action=chooseMetricFunction][data-function=sum]').click();
        await editorModal(page).locator('[name=field]').selectOption('total');
        await editorModal(page).locator('[name=label]').fill('فروش وضعیت');
        await editorModal(page).locator('[data-action=saveMetric]').click();
        await page.locator('[data-action=addDimension]').click();
        await editorModal(page).locator('[name=field]').selectOption('status');
        await editorModal(page).locator('[data-action=saveDimension]').click();
        await expect.poll(() => page.evaluate(() => window.analyticsStudio.report.display)).toBe('table');
        const metric = await page.evaluate(() => window.analyticsStudio.report.query_definition.metrics[0].key);
        await operation(page, 'expression', 1);
        await expression(page, 'کارمزد وضعیت', 'round([فروش وضعیت] * 0.1, 2)');
        await expect(section(page, 'expression', 1)).toContainText('کارمزد وضعیت');
        const definition = await page.evaluate(() => window.analyticsStudio.report.query_definition);
        expect(definition.expressions).toEqual([]);
        expect(definition.stages).toHaveLength(1);
        const customKey = definition.stages[0].expressions[0].key;
        expect(definition.stages[0].expressions[0].expression).toContain(`[${metric}]`);

        await operation(page, 'sort', 1);
        await editorModal(page).locator('[name=direction]').selectOption('desc');
        await editorModal(page).locator(`[data-action=chooseSortColumn][data-key="${customKey}"]`).click();
        await expect(editorModal(page)).toHaveCount(0);
        await operation(page, 'limit', 1);
        await rowLimit(page, 2, 1);
        await snapshot(page, 'notebook-after-summary-steps.png');

        const oracle = await api(page, 'reports/preview', 'POST', { query_definition: { connection_id: definition.connection_id, source: 'orders', mode: 'native', sql: 'SELECT status, SUM(total) AS revenue, ROUND(SUM(total) * 0.1, 2) AS computed FROM orders GROUP BY status ORDER BY revenue DESC LIMIT 2', parameters: [] } });
        const result = await run(page);
        expect(result.rows).toHaveLength(2);
        expect(result.rows.map(row => row.status)).toEqual(oracle.rows.map(row => row.status));
        for (let index = 0; index < result.rows.length; index++) {
            expect(result.rows[index][metric]).toBeCloseTo(oracle.rows[index].revenue, 2);
            expect(result.rows[index][customKey]).toBeCloseTo(oracle.rows[index].computed, 6);
        }
        reportId = await save(page, 'Notebook after summary parity ' + Date.now());
        await reloadReport(page, reportId);
        await expect(section(page, 'expression', 1)).toContainText('کارمزد وضعیت');
        await expect(section(page, 'sort', 1)).toContainText('کارمزد وضعیت');
        await expect(section(page, 'limit', 1).locator('[data-row-limit]')).toHaveValue('2');
        await section(page, 'expression', 1).locator('[data-action=editNotebookClause][data-list=expressions][data-index="0"]').click();
        await expect(editorModal(page).locator('[name=expression]')).toHaveValue('round([فروش وضعیت] * 0.1, 2)');
        await editorModal(page).getByRole('button', { name: 'بستن', exact: true }).click();
        await section(page, 'expression', 1).locator('[data-action=removeNotebookSection][data-type=expression]').click();
        await expect(section(page, 'expression', 1)).toHaveCount(0);
        await expect(section(page, 'sort', 1)).toHaveCount(0);
        const removed = await page.evaluate(() => window.analyticsStudio.report.query_definition);
        expect(removed.stages[0].expressions).toEqual([]);
        expect(removed.stages[0].sort).toEqual([]);
        expect(removed.stages[0].columns).not.toContain(customKey);
        const withoutFormula = await run(page);
        expect(withoutFormula.rows).toHaveLength(2);
        expect(withoutFormula.columns.some(column => column.key === customKey)).toBe(false);
        await save(page, 'Notebook after summary parity ' + reportId);
        await reloadReport(page, reportId);
        expect(await page.evaluate(() => window.analyticsStudio.report.query_definition.stages[0].expressions)).toEqual([]);
        expect(errors).toEqual([]);
    } finally { if (reportId) await api(page, `reports/${reportId}`, 'DELETE'); }
});

test('each notebook step previews only its own preceding operations without changing the draft', async ({ page }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await login(page);
    await newOrders(page);
    const connectionId = await page.evaluate(() => window.analyticsStudio.report.query_definition.connection_id);
    const profile = await api(page, 'reports/preview', 'POST', { query_definition: { connection_id: connectionId, source: 'orders', mode: 'native', sql: 'SELECT MIN(total) AS minimum, MAX(total) AS maximum, COUNT(*) AS row_count FROM orders', parameters: [] } });
    const threshold = (profile.rows[0].minimum + profile.rows[0].maximum) / 2;
    await operation(page, 'expression');
    await expression(page, 'نمونه محاسبه', '[total] * 0.1');
    const customKey = await page.evaluate(() => window.analyticsStudio.report.query_definition.expressions[0].key);
    await page.locator('[data-action=selectColumns]').click();
    for (const checkbox of await editorModal(page).locator('[name=columns]').all()) await checkbox.uncheck();
    for (const key of ['total', 'status', customKey]) await editorModal(page).locator(`[name=columns][value="${key}"]`).check();
    await editorModal(page).locator('[data-action=saveColumns]').click();
    await expect(editorModal(page)).toHaveCount(0);
    const selectedColumns = await page.evaluate(() => window.analyticsStudio.report.query_definition.columns);
    expect(selectedColumns).toHaveLength(3);
    expect(new Set(selectedColumns)).toEqual(new Set(['total', 'status', customKey]));
    await page.locator('[data-action=addReportFilter]').click();
    await editorModal(page).locator('[name=field]').selectOption('total');
    await editorModal(page).locator('[name=operator]').selectOption('gte');
    await editorModal(page).locator('[name=value]').fill(String(threshold));
    await editorModal(page).locator('[data-action=saveReportFilter]').click();
    await page.locator('[data-action=addMetric]').click();
    await editorModal(page).locator('[data-action=chooseMetricFunction][data-function=sum]').click();
    await editorModal(page).locator('[name=field]').selectOption('total');
    await editorModal(page).locator('[data-action=saveMetric]').click();
    await page.locator('[data-action=addDimension]').click();
    await editorModal(page).locator('[name=field]').selectOption('status');
    await editorModal(page).locator('[data-action=saveDimension]').click();
    await operation(page, 'limit');
    await rowLimit(page, 2);
    const before = await page.evaluate(() => JSON.stringify(window.analyticsStudio.report.query_definition));
    const metric = JSON.parse(before).metrics[0].key;
    const quote = key => '"' + key.replaceAll('"', '""') + '"';
    const native = sql => api(page, 'reports/preview', 'POST', { query_definition: { connection_id: connectionId, source: 'orders', mode: 'native', sql, parameters: [] } });
    const rawColumns = selectedColumns.filter(key => key !== customKey);
    const computedProjection = selectedColumns.map(key => key === customKey ? `"total" * 0.1 AS ${quote(customKey)}` : quote(key)).join(', ');
    const sourceOracle = await native(`SELECT ${rawColumns.map(quote).join(', ')} FROM "orders" LIMIT 10`);
    const computedOracle = await native(`SELECT ${computedProjection} FROM "orders" LIMIT 10`);
    const filteredOracle = await native(`SELECT ${computedProjection} FROM "orders" WHERE "total" >= ${threshold} LIMIT 10`);
    const filteredCount = await native(`SELECT COUNT(*) AS row_count FROM "orders" WHERE "total" >= ${threshold}`);
    const summaryOracle = await native(`SELECT "status", SUM("total") AS ${quote(metric)} FROM "orders" WHERE "total" >= ${threshold} GROUP BY "status" LIMIT 10`);
    expect(filteredCount.rows[0].row_count).toBeGreaterThan(0);
    expect(filteredCount.rows[0].row_count).toBeLessThan(profile.rows[0].row_count);
    async function preview(type) {
        await section(page, type).locator(`[data-action=previewNotebookStep][data-type="${type}"][data-stage="0"]`).click();
        const panel = page.locator(`.mb-step-preview[data-step-key="0:${type}"]`);
        await expect(panel.locator('.mb-table')).toBeVisible();
        const result = await page.evaluate(type => {
            const results = window.analyticsStudio.stepPreviewResults;
            return typeof results.get === 'function' ? results.get('0:' + type) : results['0:' + type];
        }, type);
        expect(result.rows.length).toBeLessThanOrEqual(10);
        expect(result.meta.query_limit).toBe(type === 'limit' ? 2 : 10);
        await expect(panel.locator('.mb-table tbody tr')).toHaveCount(result.rows.length);
        expect(await page.evaluate(() => JSON.stringify(window.analyticsStudio.report.query_definition))).toBe(before);
        return result;
    }
    const source = await preview('data');
    expect(source.rows).toHaveLength(Math.min(10, profile.rows[0].row_count));
    expect(source.rows).toEqual(sourceOracle.rows);
    expect(source.columns.map(column => column.key)).toEqual(rawColumns);
    const computed = await preview('expression');
    expect(computed.rows).toHaveLength(source.rows.length);
    expect(computed.rows).toEqual(computedOracle.rows);
    expect(computed.columns.map(column => column.key)).toEqual(selectedColumns);
    for (const row of computed.rows) expect(row[customKey]).toBeCloseTo(row.total * 0.1, 2);
    const filtered = await preview('filter');
    expect(filtered.rows).toHaveLength(Math.min(10, filteredCount.rows[0].row_count));
    expect(filtered.rows).toEqual(filteredOracle.rows);
    expect(filtered.columns.map(column => column.key)).toEqual(selectedColumns);
    for (const row of filtered.rows) expect(row.total).toBeGreaterThanOrEqual(threshold);
    const summarized = await preview('summarize');
    expect(summarized.columns.map(column => column.key)).toEqual(['status', metric]);
    expect(summarized.rows).toHaveLength(summaryOracle.rows.length);
    expect(summarized.rows.map(row => row.status)).toEqual(summaryOracle.rows.map(row => row.status));
    for (let index = 0; index < summarized.rows.length; index++) expect(summarized.rows[index][metric]).toBeCloseTo(summaryOracle.rows[index][metric], 2);
    const limited = await preview('limit');
    expect(limited.rows).toHaveLength(2);
    expect(limited.columns.map(column => column.key)).toEqual(['status', metric]);
    expect(limited.rows).toEqual(summarized.rows.slice(0, 2));
    await snapshot(page, 'notebook-step-previews.png');
    expect(errors).toEqual([]);
});

test('dragging columns respects dependencies and unrelated edits preserve backslashes inside literals', async ({ page }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await login(page);
    await newOrders(page);
    await operation(page, 'expression');
    await expression(page, 'کارمزد اول', '[total] * 0.1');
    await operation(page, 'expression');
    await expression(page, 'کارمزد دوم', '[total] * 0.2');
    const original = await page.evaluate(() => window.analyticsStudio.report.query_definition.expressions.map(row => row.key));
    const expressionRows = section(page, 'expression').locator('.mb-notebook-clause[data-list=expressions]');
    await expressionRows.nth(0).dragTo(expressionRows.nth(1));
    await expect.poll(() => page.evaluate(() => window.analyticsStudio.report.query_definition.expressions.map(row => row.key))).toEqual([original[1], original[0]]);

    await operation(page, 'expression');
    await expression(page, 'کارمزد وابسته', '[کارمزد اول] + 1');
    const beforeRejected = await page.evaluate(() => JSON.stringify(window.analyticsStudio.report.query_definition));
    const validation = page.waitForResponse(response => response.url().endsWith('/reports/validate') && response.request().method() === 'POST');
    await expressionRows.nth(2).dragTo(expressionRows.nth(1));
    expect((await validation).status()).toBe(422);
    await expect(page.locator('.mb-toast.error')).toBeVisible();
    expect(await page.evaluate(() => JSON.stringify(window.analyticsStudio.report.query_definition))).toBe(beforeRejected);

    await operation(page, 'expression');
    const literalFormula = 'concat("[missing]\\", [status])';
    await expression(page, 'پیشوند وضعیت', literalFormula);
    const literalKey = await page.evaluate(() => window.analyticsStudio.report.query_definition.expressions.at(-1).key);
    await operation(page, 'sort');
    await editorModal(page).locator('[name=direction]').selectOption('desc');
    await editorModal(page).locator('[data-action=chooseSortColumn][data-key=total]').click();
    await expect(editorModal(page)).toHaveCount(0);
    await operation(page, 'limit');
    await rowLimit(page, 5);
    expect(await page.evaluate(() => window.analyticsStudio.report.query_definition.expressions.map(row => row.key))).toEqual([original[1], original[0], JSON.parse(beforeRejected).expressions[2].key, literalKey]);
    const rows = await run(page);
    expect(rows.rows).toHaveLength(5);
    const dependentKey = JSON.parse(beforeRejected).expressions[2].key;
    for (const row of rows.rows) {
        expect(row[original[0]]).toBeCloseTo(row.total * 0.1, 6);
        expect(row[original[1]]).toBeCloseTo(row.total * 0.2, 6);
        expect(row[dependentKey]).toBeCloseTo(row.total * 0.1 + 1, 6);
        expect(row[literalKey]).toBe('[missing]\\' + row.status);
    }

    await notebook(page);
    await section(page, 'limit').locator('[data-action=removeNotebookSection][data-type=limit]').click();
    expect(await page.evaluate(() => window.analyticsStudio.report.query_definition.expressions.find(row => row.key === window.analyticsStudio.report.query_definition.expressions.at(-1).key).expression)).toBe(literalFormula);
    await page.locator('[data-action=addMetric]').click();
    await editorModal(page).locator('[data-action=chooseMetricFunction][data-function=sum]').click();
    await editorModal(page).locator('[name=field]').selectOption(original[0]);
    await editorModal(page).locator('[data-action=saveMetric]').click();
    await expect(editorModal(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.analyticsStudio.report.query_definition.sort)).toEqual([]);
    await expect(section(page, 'sort')).toHaveCount(0);
    await page.locator('[data-action=addDimension]').click();
    await editorModal(page).locator('[name=field]').selectOption('status');
    await editorModal(page).locator('[data-action=saveDimension]').click();
    await page.locator('[data-action=displayPicker]').click();
    await page.locator('[data-display=table]').click();
    const definition = await page.evaluate(() => window.analyticsStudio.report.query_definition);
    const oracle = await api(page, 'reports/preview', 'POST', { query_definition: { connection_id: definition.connection_id, source: 'orders', mode: 'native', sql: 'SELECT status, SUM(total * 0.1) AS fee FROM orders GROUP BY status', parameters: [] } });
    const aggregate = await run(page);
    expect(aggregate.rows).toHaveLength(oracle.rows.length);
    for (const row of aggregate.rows) expect(row[definition.metrics[0].key]).toBeCloseTo(oracle.rows.find(expected => expected.status === row.status).fee, 6);
    expect(definition.expressions).toHaveLength(4);
    await snapshot(page, 'notebook-drag-aggregate-result.png');
    expect(errors).toEqual([]);
});
