import { expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const credentials = process.env.ANALYTICS_PASSWORD
    ? { email: process.env.ANALYTICS_EMAIL || 'admin@example.com', password: process.env.ANALYTICS_PASSWORD }
    : JSON.parse(fs.readFileSync(path.resolve('../.tools/admin.json'), 'utf8').replace(/^\uFEFF/, ''));

export const editorModal = page => page.locator('#analytics-studio .fi-modal.fi-modal-open .fi-modal-window.mb-dialog[open]');
export const nativeModal = page => page.locator('.fi-modal-window:visible');
export const nativeField = (modal, name) => modal.locator(`[id$=".${name}"]`);

export async function login(page) {
    page.on('dialog', dialog => dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss());
    await page.goto('/admin/login');
    await page.locator('input[type=email]').fill(credentials.email);
    await page.locator('input[type=password]').fill(credentials.password);
    await page.locator('button[type=submit]').click();
    await expect(page).not.toHaveURL(/login/);
    await page.goto('/admin/analytics');
    await expect(page).toHaveURL(/\/admin\/analytics\/dashboards$/);
    await expect(page.locator('.fi-ta')).toBeVisible();
}

export async function api(page, route, method = 'GET', payload) {
    if (route === 'reports/preview' && payload?.query_definition?.mode === 'native') {
        payload.query_definition = { metrics: [], dimensions: [], filters: [], sort: [], joins: [], expressions: [], limit: null, ...payload.query_definition };
    }
    return page.evaluate(async ({ route, method, payload }) => {
        const token = document.querySelector('meta[name="csrf-token"]')?.content || document.querySelector('#analytics-studio')?.dataset.csrf;
        const response = await fetch('/analytics/api/' + route, {
            method, headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-TOKEN': token },
            ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
        });
        const text = await response.text();
        const body = text ? JSON.parse(text) : null;
        if (!response.ok) throw new Error(`Analytics API ${response.status}: ${JSON.stringify(body)}`);
        return body;
    }, { route, method, payload });
}

export async function nativeList(page, kind) {
    await page.goto('/admin/analytics/' + kind);
    await expect(page.locator('.fi-ta')).toBeVisible();
    await expect(page.locator('#analytics-studio')).toHaveCount(0);
}

export async function sampleConnection(page, table = 'orders') {
    const source = (await api(page, 'library')).connections.find(row => row.driver === 'sqlite' && row.catalog?.some(candidate => candidate.key === table));
    expect(source).toBeTruthy();
    return source;
}

export async function newReport(page, table = 'orders', native = false) {
    const source = await sampleConnection(page, table);
    const parameters = new URLSearchParams({ connection: String(source.id), table, ...(native ? { mode: 'native' } : {}) });
    await page.goto('/admin/analytics/reports/new?' + parameters);
    await expect(page.locator(native ? '[data-sql]' : '.mb-notebook')).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/analytics\/reports\/new\?/);
    return source;
}

export async function createDashboard(page, name) {
    await nativeList(page, 'dashboards');
    await page.getByRole('button', { name: 'داشبورد جدید', exact: true }).click();
    const modal = nativeModal(page);
    await expect(modal.locator('.fi-modal-heading')).toHaveText('ایجاد داشبورد');
    await nativeField(modal, 'name').fill(name);
    await modal.getByRole('button', { name: 'ایجاد', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/analytics\/dashboards\/\d+$/);
    await expect(page.locator('.mb-toolbar')).toContainText(name);
    await expect(page.locator('[data-action=editDashboard]')).toBeVisible();
    await page.locator('[data-action=editDashboard]').click();
    await expect(page.locator('.mb-editbar')).toBeVisible();
    return page.evaluate(() => window.analyticsStudio.dashboard.id);
}

export async function closePicker(page) {
    await editorModal(page).locator('.fi-modal-close-btn').click();
    await expect(editorModal(page)).toHaveCount(0);
}
