import { test, expect } from '@playwright/test';
import { createServer } from 'node:net';
import { api, login, nativeField, nativeList, nativeModal } from './helpers/native-analytics.js';

async function newPostgres(page, name, port = 5432) {
    await nativeList(page, 'databases');
    await page.getByRole('button', { name: 'پایگاه داده جدید', exact: true }).click();
    const modal = nativeModal(page);
    await expect(nativeField(modal, 'driver')).toHaveValue('pgsql');
    expect(await nativeField(modal, 'driver').locator('option').evaluateAll(options => options.map(option => option.value).filter(Boolean))).toEqual(['pgsql', 'clickhouse']);
    await expect(nativeField(modal, 'configuration.path')).toHaveCount(0);
    await expect(nativeField(modal, 'configuration.host')).toHaveValue('localhost');
    await expect(nativeField(modal, 'configuration.port')).toHaveValue('5432');
    await expect(nativeField(modal, 'configuration.database')).toHaveValue('unisq');
    await expect(nativeField(modal, 'configuration.username')).toHaveValue('postgres');
    await expect(nativeField(modal, 'configuration.sslmode')).toHaveValue('prefer');
    await nativeField(modal, 'driver').selectOption('clickhouse');
    await expect(nativeField(modal, 'configuration.port')).toHaveValue('8123');
    await expect(nativeField(modal, 'configuration.database')).toHaveValue('');
    await expect(nativeField(modal, 'configuration.username')).toHaveValue('default');
    await expect(nativeField(modal, 'configuration.sslmode')).toHaveCount(0);
    await nativeField(modal, 'driver').selectOption('pgsql');
    await expect(nativeField(modal, 'configuration.port')).toHaveValue('5432');
    await expect(nativeField(modal, 'configuration.database')).toHaveValue('unisq');
    await nativeField(modal, 'name').fill(name);
    await nativeField(modal, 'configuration.host').fill('127.0.0.1');
    await nativeField(modal, 'configuration.port').fill(String(port));
    await nativeField(modal, 'configuration.database').fill('analytics_browser_probe');
    await nativeField(modal, 'configuration.username').fill('postgres');
    return modal;
}

async function fixture(page, name) {
    return (await api(page, 'library')).connections.find(connection => connection.name === name);
}

async function cleanup(page, prefix) {
    const connections = (await api(page, 'library')).connections;
    for (const connection of connections.filter(row => row.name.startsWith(prefix))) {
        await api(page, `connections/${connection.id}`, 'DELETE');
    }
}

async function searchedRow(page, name) {
    // Filament debounces search; existing rows can match before that request runs.
    // Complete the search update before clicking a row action queued behind it.
    const searchUpdated = page.waitForResponse(response => response.url().endsWith('/livewire/update')
        && response.request().method() === 'POST'
        && response.request().postDataJSON()?.components?.some(component => component.updates?.tableSearch === name));
    await page.locator('.fi-ta-search-field input').fill(name);
    const response = await searchUpdated;
    expect(response.ok()).toBe(true);
    await response.finished();
    await expect(page.locator('.fi-ta tbody tr')).toHaveCount(1);
    const row = page.locator('.fi-ta tbody tr').filter({ hasText: name });
    await expect(row).toHaveCount(1);
    return row;
}

function hostError(page, modal) {
    return modal.locator('.fi-fo-field-wrp')
        .filter({ has: page.locator('[id$=".configuration.host"]') })
        .locator('.fi-fo-field-wrp-error-message');
}

test('PostgreSQL can be created and edited with native forms without a running server and keeps its password', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await login(page);
    const name = `Browser PostgreSQL saved ${Date.now()}`;
    try {
        let modal = await newPostgres(page, name);
        await nativeField(modal, 'configuration.host').fill('soar_db');
        await nativeField(modal, 'configuration.database').fill('soar_app');
        await nativeField(modal, 'configuration.password').fill('browser-fixture-password-only');
        await nativeField(modal, 'configuration.sslmode').selectOption('require');
        await expect(nativeField(modal, 'test_first')).toHaveAttribute('aria-checked', 'false');
        await modal.getByRole('button', { name: 'ذخیره', exact: true }).click();
        await expect(modal).not.toBeVisible();
        const saved = await fixture(page, name);
        expect(saved.driver).toBe('pgsql');
        expect(saved.configuration).toMatchObject({ host: 'soar_db', port: 5432, database: 'soar_app', username: 'postgres', sslmode: 'require' });
        expect(saved.configuration).not.toHaveProperty('password');
        expect(saved.has_password).toBe(true);
        expect(saved.synced_at).toBeNull();
        await page.reload();
        let row = await searchedRow(page, name);
        await row.getByRole('button', { name: 'ویرایش اتصال', exact: true }).click();
        modal = nativeModal(page);
        await expect(nativeField(modal, 'configuration.password')).toHaveValue('');
        await expect(nativeField(modal, 'configuration.sslmode')).toHaveValue('require');
        await nativeField(modal, 'configuration.host').fill('https://127.0.0.1');
        await modal.locator('button[type=submit]').click();
        await expect(hostError(page, modal)).toBeVisible();
        expect((await fixture(page, name)).configuration.host).toBe('soar_db');
        await nativeField(modal, 'configuration.host').fill('soar_db_replica');
        await nativeField(modal, 'configuration.port').fill('6432');
        await nativeField(modal, 'name').fill(name + ' edited');
        await modal.locator('button[type=submit]').click();
        await expect(modal).not.toBeVisible();
        const edited = await fixture(page, name + ' edited');
        expect(edited.id).toBe(saved.id);
        expect(edited.configuration.port).toBe(6432);
        expect(edited.configuration.host).toBe('soar_db_replica');
        expect(edited.configuration.database).toBe('soar_app');
        expect(edited.configuration.sslmode).toBe('require');
        expect(edited.has_password).toBe(true);
        expect(edited.configuration).not.toHaveProperty('password');
        row = await searchedRow(page, name + ' edited');
        await expect(row).toContainText('PostgreSQL');
        expect(errors).toEqual([]);
    } finally { await cleanup(page, name); }
});

test('PostgreSQL invalid hosts show a field error and a failed preflight does not create a connection', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await login(page);
    const name = `Browser PostgreSQL validation ${Date.now()}`;
    // Reserve then release an unused local port; no PostgreSQL server is installed or started.
    const server = createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    await new Promise(resolve => server.close(resolve));
    try {
        const modal = await newPostgres(page, name, port);
        await nativeField(modal, 'configuration.host').fill('http://127.0.0.1');
        await modal.getByRole('button', { name: 'ذخیره', exact: true }).click();
        await expect(hostError(page, modal)).toBeVisible();
        expect(await fixture(page, name)).toBeUndefined();
        await nativeField(modal, 'configuration.host').fill('127.0.0.1');
        await nativeField(modal, 'test_first').click();
        await expect(nativeField(modal, 'test_first')).toHaveAttribute('aria-checked', 'true');
        await modal.getByRole('button', { name: 'ذخیره', exact: true }).click();
        await expect(page.locator('.fi-no-notification').filter({ hasText: 'اتصال به دیتابیس برقرار نشد' }).last()).toBeVisible();
        await expect(modal).toBeVisible();
        expect(await fixture(page, name)).toBeUndefined();
        await nativeField(modal, 'test_first').click();
        await expect(nativeField(modal, 'test_first')).toHaveAttribute('aria-checked', 'false');
        await modal.getByRole('button', { name: 'ذخیره', exact: true }).click();
        await expect(modal).not.toBeVisible();
        const saved = await fixture(page, name);
        expect(saved.driver).toBe('pgsql');
        expect(saved.configuration.port).toBe(port);
        expect(saved.synced_at).toBeNull();
        const row = await searchedRow(page, name);
        await row.getByRole('button', { name: 'آزمون اتصال', exact: true }).click();
        await expect(page.locator('.fi-no-notification').filter({ hasText: 'اتصال برقرار نشد' }).last()).toBeVisible();
        expect((await fixture(page, name)).synced_at).toBeNull();
        expect(errors).toEqual([]);
    } finally { await cleanup(page, name); }
});
