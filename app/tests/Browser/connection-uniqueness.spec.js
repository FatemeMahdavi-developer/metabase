import { test, expect } from '@playwright/test';
import { api, login, nativeField, nativeList, nativeModal } from './helpers/native-analytics.js';

function fieldError(page, modal, name) {
    return modal.locator('.fi-fo-field-wrp')
        .filter({ has: page.locator(`[id$=".${name}"]`) })
        .locator('.fi-fo-field-wrp-error-message');
}

async function ownConnections(page, prefix) {
    return (await api(page, 'library')).connections.filter(connection => connection.name.startsWith(prefix));
}

test('native database form rejects duplicate names and endpoints, then saves a corrected connection', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await login(page);
    const stamp = Date.now();
    const prefix = `Browser uniqueness ${stamp}`;
    const originalName = `${prefix} source`;
    const correctedName = `${prefix} corrected`;
    const host = `pg_browser_${stamp}`;
    const database = `browser_${stamp}`;
    const password = 'browser-uniqueness-fixture-password';

    try {
        const original = await api(page, 'connections', 'POST', {
            name: originalName,
            driver: 'pgsql',
            configuration: { host, port: 5432, database, username: 'first_reader', password, sslmode: 'prefer' },
            test_first: false,
        });
        expect(original.configuration).not.toHaveProperty('password');
        expect(original.has_password).toBe(true);

        await nativeList(page, 'databases');
        await page.getByRole('button', { name: 'پایگاه داده جدید', exact: true }).click();
        const modal = nativeModal(page);
        await expect(nativeField(modal, 'driver')).toHaveValue('pgsql');
        await expect(nativeField(modal, 'test_first')).toHaveAttribute('aria-checked', 'false');
        await nativeField(modal, 'name').fill(` ${originalName.toUpperCase()} `);
        await nativeField(modal, 'configuration.host').fill(`${host}_other`);
        await nativeField(modal, 'configuration.port').fill('5432');
        await nativeField(modal, 'configuration.database').fill(database);
        await nativeField(modal, 'configuration.username').fill('second_reader');
        await nativeField(modal, 'configuration.password').fill(`${password}-different`);
        await modal.getByRole('button', { name: 'ذخیره', exact: true }).click();
        await expect(fieldError(page, modal, 'name')).toBeVisible();
        await expect(modal).toBeVisible();
        expect(await ownConnections(page, prefix)).toHaveLength(1);

        // Changing credentials does not turn the same server/database into a new source.
        await nativeField(modal, 'name').fill(correctedName);
        await nativeField(modal, 'configuration.host').fill(host.toUpperCase());
        await modal.getByRole('button', { name: 'ذخیره', exact: true }).click();
        await expect(fieldError(page, modal, 'configuration.database')).toBeVisible();
        await expect(modal).toBeVisible();
        const afterErrors = await ownConnections(page, prefix);
        expect(afterErrors).toHaveLength(1);
        expect(afterErrors[0].id).toBe(original.id);
        expect(afterErrors[0].configuration).not.toHaveProperty('password');
        expect(JSON.stringify(afterErrors)).not.toContain(password);

        await nativeField(modal, 'configuration.database').fill(`${database}_corrected`);
        await modal.getByRole('button', { name: 'ذخیره', exact: true }).click();
        await expect(modal).not.toBeVisible();
        const saved = await ownConnections(page, prefix);
        expect(saved).toHaveLength(2);
        const corrected = saved.find(connection => connection.name === correctedName);
        expect(corrected).toBeTruthy();
        expect(corrected.configuration.database).toBe(`${database}_corrected`);
        expect(corrected.configuration.username).toBe('second_reader');
        expect(corrected.configuration).not.toHaveProperty('password');
        expect(corrected.has_password).toBe(true);
        expect(corrected.synced_at).toBeNull();
        expect(JSON.stringify(saved)).not.toContain(password);
        expect(errors).toEqual([]);
    } finally {
        for (const connection of await ownConnections(page, prefix)) {
            await api(page, `connections/${connection.id}`, 'DELETE');
        }
    }
});
