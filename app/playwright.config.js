import { defineConfig } from '@playwright/test';
export default defineConfig({
    testDir: './tests/Browser', timeout: 180000, expect: { timeout: 30000 }, workers: 1, fullyParallel: false,
    reporter: 'list', use: { baseURL: process.env.ANALYTICS_URL || 'http://127.0.0.1:8000', actionTimeout: 30000, navigationTimeout: 60000, viewport: { width: 1440, height: 1050 },
        browserName: 'chromium', launchOptions: { executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
});
