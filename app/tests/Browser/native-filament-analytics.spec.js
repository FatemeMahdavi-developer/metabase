import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const credentials = process.env.ANALYTICS_PASSWORD
    ? { email: process.env.ANALYTICS_EMAIL || 'admin@example.com', password: process.env.ANALYTICS_PASSWORD }
    : JSON.parse(fs.readFileSync(path.resolve('../.tools/admin.json'), 'utf8').replace(/^\uFEFF/, ''));

const lists = {
    dashboards: '/admin/analytics/dashboards',
    reports: '/admin/analytics/reports',
    databases: '/admin/analytics/databases',
};
const labels = { dashboards: 'داشبوردها', reports: 'گزارش‌ها', databases: 'پایگاه‌های داده' };
const workbench = page => page.locator('#analytics-studio');
const nativeModal = page => page.locator('.fi-modal-window:visible');
const editorModal = page => workbench(page).locator('.fi-modal.fi-modal-open .fi-modal-window.mb-dialog[open]');
const nativeField = (modal, name) => modal.locator(`[id$=".${name}"]`);

async function api(page, route, method = 'GET', payload) {
    return page.evaluate(async ({ route, method, payload }) => {
        const token = document.querySelector('meta[name="csrf-token"]')?.content
            || document.querySelector('#analytics-studio')?.dataset.csrf;
        const response = await fetch('/analytics/api/' + route, {
            method,
            headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-TOKEN': token },
            ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
        });
        const text = await response.text();
        const body = text ? JSON.parse(text) : null;
        if (!response.ok) throw new Error(`Analytics API ${response.status}: ${JSON.stringify(body)}`);
        return body;
    }, { route, method, payload });
}

async function login(page) {
    // Leaving a new unsaved report is intentional in navigation checks.
    page.on('dialog', async dialog => dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss());
    await page.goto('/admin/login');
    await page.locator('input[type=email]').fill(credentials.email);
    await page.locator('input[type=password]').fill(credentials.password);
    await page.locator('button[type=submit]').click();
    await expect(page).not.toHaveURL(/login/);
    await page.goto('/admin/analytics');
    await expect(page).toHaveURL(new RegExp(lists.dashboards + '$'));
    await expect(page.locator('.fi-ta')).toBeVisible();
}

async function cleanFixtures(page, prefix) {
    const library = await api(page, 'library');
    for (const kind of ['dashboards', 'reports', 'connections']) {
        for (const record of library[kind].filter(record => record.name.startsWith(prefix))) {
            await api(page, `${kind}/${record.id}`, 'DELETE');
        }
    }
}

async function assertNativeNavigation(page) {
    const sidebar = page.locator('aside.fi-sidebar');
    await expect(sidebar).toHaveCount(1);
    await expect(sidebar).toBeVisible();
    await expect(page.locator('.mb-sidebar')).toHaveCount(0);
    for (const [section, label] of Object.entries(labels)) {
        await expect(sidebar.getByRole('link', { name: label, exact: true })).toHaveAttribute('href', new RegExp(lists[section] + '$'));
    }
    await expect(sidebar.locator('.fi-sidebar-group-label').filter({ hasText: 'داشبوردساز' })).toHaveCount(1);
    // The panel's original home menu must remain available alongside the module.
    await expect(sidebar.locator('.fi-sidebar-nav a[href$="/admin"]')).toHaveCount(1);
    const section = Object.keys(lists).find(section => new URL(page.url()).pathname.startsWith(lists[section]));
    if (section) await assertActiveNativeSection(page, section);
}

async function assertActiveNativeSection(page, section) {
    const active = page.locator('aside.fi-sidebar .fi-sidebar-item.fi-active > a[href*="/analytics/"]');
    await expect(active).toHaveCount(1);
    await expect(active).toHaveAttribute('href', new RegExp(lists[section] + '$'));
}

async function sidebarNavigate(page, section) {
    await page.locator('aside.fi-sidebar').getByRole('link', { name: labels[section], exact: true }).click();
    await expect(page).toHaveURL(new RegExp(lists[section] + '$'));
    await expect(page.locator('.fi-ta')).toBeVisible();
    await expect(workbench(page)).toHaveCount(0);
    await assertActiveNativeSection(page, section);
}

async function assertWorkbenchModal(page) {
    const modal = editorModal(page);
    await expect(modal).toBeVisible();
    await expect(modal.locator('.fi-modal-heading')).toBeVisible();
    await expect(modal.locator('.fi-modal-close-btn')).toBeVisible();
    await expect(page.locator('dialog.mb-dialog')).toHaveCount(0);
    // These are rendered Filament component wrappers, shared with the native CRUD forms.
    await expect(modal.locator('.fi-input-wrp').first()).toBeVisible();
    await expect(modal.locator('button.fi-btn').first()).toBeVisible();
    return modal;
}

async function holdRealApiResponse(page, url) {
    let release, complete, heldRequest;
    const gate = new Promise(resolve => { release = resolve; });
    const completed = new Promise(resolve => { complete = resolve; });
    const state = { started: 0, received: 0, status: null, error: null };
    const handler = async route => {
        state.started++;
        heldRequest = route.request();
        try {
            const response = await route.fetch();
            state.status = response.status();
            state.received++;
            await gate;
            await route.fulfill({ response });
        } catch (error) { state.error = error.message; }
        finally { complete(); }
    };
    await page.route(url, handler);
    return {
        state,
        async deliver() {
            const request = heldRequest;
            const responseReceived = page.waitForResponse(response => response.request() === request);
            release();
            const response = await responseReceived;
            await response.finished();
            await completed;
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            expect(state.error).toBeNull(); expect(state.status).toBe(200);
        },
        async cleanup() {
            release();
            if (state.started) await completed;
            await page.unroute(url, handler);
        },
    };
}

test('native Filament dashboard table and create action lead to a reloadable widget editor with native modals', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await login(page);
    const prefix = 'Browser native Filament dashboard ' + Date.now();
    try {
        await assertNativeNavigation(page);
        await page.getByRole('button', { name: 'داشبورد جدید', exact: true }).click();
        const create = nativeModal(page);
        await expect(create.locator('.fi-modal-heading')).toHaveText('ایجاد داشبورد');
        await expect(create.locator('.fi-input-wrp').first()).toBeVisible();
        await nativeField(create, 'name').fill(prefix);
        await nativeField(create, 'description').fill('Created through the native Filament resource action.');
        await create.getByRole('button', { name: 'ایجاد', exact: true }).click();
        await expect(page).toHaveURL(/\/admin\/analytics\/dashboards\/\d+(?:\?.*)?$/);
        const dashboardUrl = new URL(page.url()).pathname;
        await expect(workbench(page).locator('.mb-toolbar')).toContainText(prefix);
        await assertNativeNavigation(page);
        await expect(page.locator('.mb-library-table, .mb-side-link')).toHaveCount(0);

        if (await page.locator('[data-action=editDashboard]').isVisible()) await page.locator('[data-action=editDashboard]').click();
        await page.locator('[data-action=addTextCard]').click();
        let modal = await assertWorkbenchModal(page);
        await modal.locator('[name=title]').fill('Discarded draft');
        await page.keyboard.press('Escape');
        await expect(editorModal(page)).toHaveCount(0);
        await expect(page.locator('.mb-card')).toHaveCount(0);

        await page.locator('[data-action=addTextCard]').click();
        modal = await assertWorkbenchModal(page);
        await modal.locator('[name=title]').fill('Native panel widget');
        await modal.locator('[name=content]').fill('### Native Filament dashboard\nPersisted widget content.');
        await modal.locator('[data-action=saveTextCard]').click();
        await expect(editorModal(page)).toHaveCount(0);
        await expect(page.locator('.mb-card')).toHaveCount(1);
        await page.locator('[data-action=dashboardSettings]').click();
        modal = await assertWorkbenchModal(page);
        await modal.locator('[name=name]').fill('Unsaved dashboard name');
        await modal.locator('.fi-modal-close-btn').click();
        await expect(editorModal(page)).toHaveCount(0);
        await expect(workbench(page).locator('.mb-toolbar')).toContainText(prefix);
        await page.locator('[data-action=saveDashboard]').click();
        await expect(page.locator('[data-action=editDashboard]')).toBeVisible();
        await expect(page).toHaveURL(new RegExp(dashboardUrl + '$'));
        await page.reload();
        await expect(page.locator('.mb-card')).toContainText('Persisted widget content.');
        await assertNativeNavigation(page);
        await page.screenshot({ path: 'tests/Browser/artifacts/native-filament-dashboard-desktop.png', fullPage: true });

        await sidebarNavigate(page, 'reports');
        await page.goBack();
        await expect(page).toHaveURL(new RegExp(dashboardUrl + '$'));
        await expect(page.locator('.mb-card')).toContainText('Persisted widget content.');
        await assertActiveNativeSection(page, 'dashboards');
        await page.goForward();
        await expect(page).toHaveURL(new RegExp(lists.reports + '$'));
        await expect(page.locator('.fi-ta')).toBeVisible();
        await assertActiveNativeSection(page, 'reports');
        expect(errors).toEqual([]);
    } finally { await cleanFixtures(page, prefix); }
});

test('native database forms and tables connect schema browsing to a report whose URL survives refresh and browser history', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await login(page);
    const prefix = 'Browser native Filament database ' + Date.now();
    try {
        const source = (await api(page, 'library')).connections.find(row => row.driver === 'sqlite' && row.catalog?.some(table => table.key === 'orders'));
        expect(source).toBeTruthy();
        await sidebarNavigate(page, 'databases');
        await page.getByRole('button', { name: 'پایگاه داده جدید', exact: true }).click();
        let modal = nativeModal(page);
        await expect(modal.locator('.fi-modal-heading')).toHaveText('افزودن پایگاه داده');
        await nativeField(modal, 'name').fill(prefix);
        await nativeField(modal, 'driver').selectOption('pgsql');
        await expect(nativeField(modal, 'configuration.port')).toHaveValue('5432');
        await expect(nativeField(modal, 'configuration.sslmode')).toBeVisible();
        await nativeField(modal, 'driver').selectOption('clickhouse');
        await expect(nativeField(modal, 'configuration.port')).toHaveValue('8123');
        await nativeField(modal, 'driver').selectOption('sqlite');
        await nativeField(modal, 'configuration.path').fill(source.configuration.path);
        await modal.getByRole('button', { name: 'ذخیره', exact: true }).click();
        await expect(modal).not.toBeVisible();
        await expect(page).toHaveURL(new RegExp(lists.databases + '$'));
        await page.locator('.fi-ta-search-field input').fill(prefix);
        // Wait for Filament's debounced search to finish before mounting a row action.
        await expect(page.locator('.fi-ta tbody tr')).toHaveCount(1);
        let row = page.locator('.fi-ta tbody tr').filter({ hasText: prefix });
        await expect(row).toHaveCount(1);
        await expect(row).toContainText('SQLite');
        await row.getByRole('button', { name: 'ویرایش اتصال', exact: true }).click();
        modal = nativeModal(page);
        await expect(nativeField(modal, 'configuration.path')).toHaveValue(source.configuration.path);
        await nativeField(modal, 'name').fill(prefix + ' edited');
        await modal.locator('button[type=submit]').click();
        await expect(modal).not.toBeVisible();
        row = page.locator('.fi-ta tbody tr').filter({ hasText: prefix + ' edited' });
        await expect(row).toHaveCount(1);
        const connection = (await api(page, 'library')).connections.find(record => record.name === prefix + ' edited');
        expect(connection).toBeTruthy();
        await row.getByRole('link', { name: 'مشاهده جدول‌ها', exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`/admin/analytics/databases/${connection.id}(?:\\?.*)?$`));
        const databaseUrl = new URL(page.url()).pathname;
        await expect(page.locator('.mb-schema-tables')).toBeVisible();
        await page.locator('[data-action=selectTable][data-key=orders]').click();
        await expect(page.locator('.mb-browser-preview .mb-table')).toBeVisible();
        await expect(page.locator('[data-action=selectTable][data-key=orders]')).toHaveText('orders');
        await assertNativeNavigation(page);
        await page.locator('[data-action=reportFromTable]').click();
        await expect(page).toHaveURL(/\/admin\/analytics\/reports\/new\?/);
        await assertActiveNativeSection(page, 'reports');
        await expect(workbench(page)).toHaveAttribute('data-section', 'report');
        expect(new URL(page.url()).searchParams.get('connection')).toBe(String(connection.id));
        expect(new URL(page.url()).searchParams.get('table')).toBe('orders');
        await expect(page.locator('[data-notebook-step=data]')).toContainText('orders');
        await page.getByRole('button', { name: 'نمایش نتیجه', exact: true }).click();
        await expect(page.locator('.mb-preview-body .mb-table')).toBeVisible();
        await page.locator('[data-action=reportSaveDialog]').click();
        modal = await assertWorkbenchModal(page);
        await modal.locator('[name=name]').fill(prefix + ' report');
        await modal.locator('[data-action=saveReport]').click();
        await expect(page).toHaveURL(/\/admin\/analytics\/reports\/\d+$/);
        const reportUrl = new URL(page.url()).pathname;
        await page.reload();
        await expect(page.locator('.mb-preview-body .mb-table')).toBeVisible();
        await expect(workbench(page).locator('.mb-toolbar')).toContainText(prefix + ' report');
        await assertNativeNavigation(page);
        await page.screenshot({ path: 'tests/Browser/artifacts/native-filament-report-desktop.png', fullPage: true });
        await page.goBack();
        await expect(page).toHaveURL(new RegExp(databaseUrl + '(?:\\?.*)?$'));
        await expect(page.locator('.mb-schema-tables')).toBeVisible();
        await assertActiveNativeSection(page, 'databases');
        await page.goForward();
        await expect(page).toHaveURL(new RegExp(reportUrl + '$'));
        await expect(page.locator('.mb-preview-body .mb-table')).toBeVisible();
        await assertActiveNativeSection(page, 'reports');
        await sidebarNavigate(page, 'reports');
        await page.locator('.fi-ta-search-field input').fill(prefix);
        await expect(page.locator('.fi-ta tbody tr')).toHaveCount(1);
        const originalRow = page.locator('.fi-ta tbody tr').filter({ hasText: prefix + ' report' });
        await expect(originalRow).toHaveCount(1);
        const original = (await api(page, 'library')).reports.find(record => record.name === prefix + ' report');
        expect(original).toBeTruthy();
        await originalRow.getByRole('button', { name: 'کپی گزارش', exact: true }).click();
        const copyModal = nativeModal(page);
        await expect(copyModal.locator('.fi-modal-heading')).toHaveText('کپی گزارش');
        await expect(copyModal.locator('.fi-input-wrp').first()).toBeVisible();
        await expect(nativeField(copyModal, 'name')).toHaveValue(original.name + ' — کپی');
        const copyName = prefix + ' copied report';
        await nativeField(copyModal, 'name').fill(copyName);
        await nativeField(copyModal, 'description').fill('Copied through the native Filament report action.');
        await copyModal.getByRole('button', { name: 'ایجاد کپی', exact: true }).click();
        await expect(page).toHaveURL(/\/admin\/analytics\/reports\/\d+$/);
        expect(new URL(page.url()).pathname).not.toBe(reportUrl);
        await expect(page.locator('.mb-preview-body .mb-table')).toBeVisible();
        await expect(workbench(page).locator('.mb-toolbar')).toContainText(copyName);
        await assertActiveNativeSection(page, 'reports');
        const afterCopy = await api(page, 'library');
        const copied = afterCopy.reports.find(record => record.name === copyName);
        expect(copied.id).not.toBe(original.id);
        expect(copied.version).toBe(1);
        expect(copied.description).toBe('Copied through the native Filament report action.');
        expect(copied.query_definition).toEqual(original.query_definition);
        expect(copied.visualization_settings).toEqual(original.visualization_settings);
        expect(copied.display).toBe(original.display);
        expect(afterCopy.reports.find(record => record.id === original.id)).toEqual(original);
        await page.reload();
        await expect(page.locator('.mb-preview-body .mb-table')).toBeVisible();
        await expect(workbench(page).locator('.mb-toolbar')).toContainText(copyName);
        await sidebarNavigate(page, 'reports');
        await page.locator('.fi-ta-search-field input').fill(prefix);
        await expect(page.locator('.fi-ta tbody tr')).toHaveCount(2);
        await page.getByRole('link', { name: 'پرس‌وجوی SQL', exact: true }).click();
        await expect(page).toHaveURL(/\/admin\/analytics\/reports\/new\?mode=native$/);
        await expect(workbench(page)).toBeVisible();
        await assertActiveNativeSection(page, 'reports');
        expect(errors).toEqual([]);
    } finally { await cleanFixtures(page, prefix); }
});

test('mobile analytics uses the panel drawer and one native light/dark switch with usable widget widths', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await login(page);
    const prefix = 'Browser native Filament mobile ' + Date.now();
    try {
        const board = await api(page, 'dashboards', 'POST', { name: prefix, description: null, folder_id: null });
        await api(page, `dashboards/${board.id}`, 'PUT', {
            ...board,
            widgets: [{ key: 'native-mobile-widget', tab_key: board.tabs[0].key, type: 'text', report_id: null, content: 'Readable panel widget', x: 0, y: 0, w: 12, h: 6, settings: { title: 'Mobile widget' }, click_behavior: { type: 'menu' } }],
        });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(`/admin/analytics/dashboards/${board.id}`);
        const overlay = page.locator('.fi-sidebar-close-overlay');
        if (await overlay.isVisible()) await overlay.click({ position: { x: 5, y: 5 } });
        await expect(overlay).not.toBeVisible();
        await expect(page.locator('.fi-topbar-open-sidebar-btn')).toBeVisible();
        await expect(page.locator('.mb-card')).toContainText('Readable panel widget');
        await assertActiveNativeSection(page, 'dashboards');
        await expect(page.locator('.mb-sidebar')).toHaveCount(0);
        await expect.poll(() => page.evaluate(() => window.analyticsStudio?.grid?.getColumn())).toBe(1);

        const backgrounds = [];
        for (const [mode, label] of [['light', 'حالت روشن'], ['dark', 'حالت تیره']]) {
            await page.getByRole('button', { name: 'منوی کاربر', exact: true }).click();
            await expect(page.locator('.fi-theme-switcher')).toBeVisible();
            await expect(page.locator('.fi-theme-switcher')).toHaveCount(1);
            await page.locator('.fi-theme-switcher').getByRole('button', { name: label, exact: true }).click();
            await expect(workbench(page)).toHaveAttribute('data-analytics-theme', mode);
            await expect(page.locator('.fi-theme-switcher')).not.toBeVisible();
            await expect(workbench(page).locator('[data-analytics-theme-controls], [data-action=setAnalyticsTheme]')).toHaveCount(0);
            backgrounds.push(await page.locator('.mb-card').evaluate(node => getComputedStyle(node).backgroundColor));
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
            await page.screenshot({ path: `tests/Browser/artifacts/native-filament-dashboard-mobile-${mode}.png`, fullPage: true });
        }
        expect(backgrounds[0]).not.toBe(backgrounds[1]);
        await page.locator('.fi-topbar-open-sidebar-btn').click();
        await expect(overlay).toBeVisible();
        await page.locator('aside.fi-sidebar').getByRole('link', { name: labels.databases, exact: true }).click();
        await expect(page).toHaveURL(new RegExp(lists.databases + '$'));
        await expect(page.locator('.fi-ta')).toBeVisible();
        await assertActiveNativeSection(page, 'databases');
        await expect(overlay).not.toBeVisible();
        await expect(page.locator('.fi-topbar-open-sidebar-btn')).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        expect(errors).toEqual([]);
    } finally { await cleanFixtures(page, prefix); }
});

test('late record details and click destination responses cannot overwrite a reopened native slide-over', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await login(page);
    const prefix = 'Browser native Filament modal race ' + Date.now();
    let relatedGate, destinationGate;
    try {
        const source = (await api(page, 'library')).connections.find(row => row.driver === 'sqlite' && row.catalog?.some(table => table.key === 'orders'));
        expect(source).toBeTruthy();
        const report = await api(page, 'reports', 'POST', {
            name: prefix + ' rows', description: null, folder_id: null, display: 'table', visualization_settings: {},
            query_definition: {
                connection_id: source.id, source: 'orders', mode: 'rows', columns: ['id', 'customer_id', 'ordered_at', 'status', 'total'],
                expressions: [], filters: [], joins: [], metrics: [], dimensions: [], sort: [{ key: 'id', direction: 'asc' }], limit: 3, limit_explicit: true,
            },
        });
        const board = await api(page, 'dashboards', 'POST', { name: prefix + ' board', description: null, folder_id: null });
        const destination = await api(page, 'dashboards', 'POST', { name: prefix + ' destination', description: null, folder_id: null });
        const key = 'modal-race-table';
        const savedBoard = await api(page, `dashboards/${board.id}`, 'PUT', {
            ...board,
            widgets: [{ key, tab_key: board.tabs[0].key, type: 'report', report_id: report.id, content: null, x: 0, y: 0, w: 24, h: 8, settings: {}, click_behavior: { type: 'menu' } }],
        });
        await page.goto(`/admin/analytics/dashboards/${board.id}`);
        await expect(page.locator(`[data-widget="${key}"] .mb-table`)).toBeVisible();
        await page.locator(`[data-widget="${key}"] [data-table-cell][data-column=id]`).first().click();
        await expect(page.locator('[data-drill-menu] [data-drill-action=object_details]')).toBeVisible();
        // The first menu request has completed. Delay the real, second options response for the record's related rows.
        relatedGate = await holdRealApiResponse(page, `**/analytics/api/dashboards/${board.id}/widgets/${key}/interactions/options`);
        await page.locator('[data-drill-menu] [data-drill-action=object_details]').click();
        await expect(editorModal(page).locator('.mb-object-details')).toBeVisible();
        await expect.poll(() => relatedGate.state.received).toBe(1);
        const sideWindow = await editorModal(page).elementHandle();
        await page.keyboard.press('Escape');
        await expect(editorModal(page)).toHaveCount(0);
        await page.locator('[data-action=editDashboard]').click();
        await page.locator(`[data-action=cardSettings][data-key="${key}"]`).click();
        let settings = await assertWorkbenchModal(page);
        expect(await settings.evaluate((node, previous) => node === previous, sideWindow)).toBe(true);
        await settings.locator('[name=title]').fill('Preserve the current settings form');
        await relatedGate.deliver();
        await expect(settings.locator('.fi-modal-heading')).toHaveText('تنظیم کارت');
        await expect(settings.locator('[name=title]')).toHaveValue('Preserve the current settings form');
        await expect(settings.locator('[data-object-related]')).toHaveCount(0);
        // Async failures handled by dispatch must also leave the replacement form's validation area empty.
        await expect(settings.locator('.mb-dialog-error')).toBeEmpty();
        await relatedGate.cleanup(); relatedGate = null;

        await settings.locator('[data-action=editCardClickBehavior]').click();
        await expect(editorModal(page).locator('[data-click-behavior-editor]')).toBeVisible();
        await editorModal(page).locator('[data-action=chooseClickBehavior][data-type=dashboard]').click();
        await expect(editorModal(page).locator('[data-click-destination]')).toBeVisible();
        destinationGate = await holdRealApiResponse(page, `**/analytics/api/dashboards/${destination.id}`);
        await editorModal(page).locator('[data-click-destination]').selectOption(String(destination.id));
        await expect.poll(() => destinationGate.state.received).toBe(1);
        await page.keyboard.press('Escape');
        await expect(editorModal(page)).toHaveCount(0);
        await page.locator(`[data-action=cardSettings][data-key="${key}"]`).click();
        settings = await assertWorkbenchModal(page);
        expect(await settings.evaluate((node, previous) => node === previous, sideWindow)).toBe(true);
        await settings.locator('[name=title]').fill('Preserve settings after destination lookup');
        await destinationGate.deliver();
        await expect(settings.locator('.fi-modal-heading')).toHaveText('تنظیم کارت');
        await expect(settings.locator('[name=title]')).toHaveValue('Preserve settings after destination lookup');
        await expect(settings.locator('[data-click-behavior-editor]')).toHaveCount(0);
        await expect(settings.locator('.mb-dialog-error')).toBeEmpty();
        await page.keyboard.press('Escape');
        await expect(editorModal(page)).toHaveCount(0);
        await page.locator('[data-action=addTextCard]').click();
        await expect(editorModal(page).locator('[name=content]')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(editorModal(page)).toHaveCount(0);
        expect((await api(page, `dashboards/${board.id}`)).widgets).toHaveLength(1);
        expect((await api(page, `dashboards/${board.id}`)).version).toBe(savedBoard.version);
        expect(errors).toEqual([]);
    } finally {
        await relatedGate?.cleanup(); await destinationGate?.cleanup();
        await cleanFixtures(page, prefix);
    }
});
