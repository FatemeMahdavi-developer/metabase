const validMode = value => ['light', 'dark', 'system'].includes(value);
const storedTheme = () => { try { return window.localStorage.getItem('theme'); } catch { return null; } };

export function analyticsPalette(root) {
    const host = root?.closest?.('#analytics-studio') || root || document.getElementById('analytics-studio');
    const style = getComputedStyle(host || document.documentElement);
    const color = name => style.getPropertyValue('--mb-' + name).trim();
    return {
        mode: host?.dataset.analyticsThemeMode || storedTheme() || 'system',
        fontFamily: style.fontFamily || 'Vazir, Tahoma, Arial, sans-serif',
        resolved: host?.dataset.analyticsTheme || (document.documentElement.classList.contains('dark') ? 'dark' : 'light'),
        page: color('page-bg'), surface: color('surface'), card: color('card-bg'),
        text: color('text'), muted: color('muted'), grid: color('chart-grid'), track: color('chart-track'), fill: color('chart-fill'),
        colors: Array.from({ length: 6 }, (_, index) => color('chart-' + (index + 1))),
        lineColor: color('chart-line'), gaugeColor: color('chart-gauge'),
        tooltipBg: color('chart-tooltip-bg'), tooltipText: color('chart-tooltip-text'),
    };
}

export const themeMethods = {
    async waitForAnalyticsFonts() {
        if (!document.fonts?.load) return;
        try {
            // Another panel module's fonts must not delay analytics startup.
            const family = this.analyticsPalette().fontFamily;
            await Promise.all([400, 500, 700, 900].map(weight => document.fonts.load(`${weight} 12px ${family}`, 'فروش Sales ۱۲۳')));
        } catch {
            // A failed font file keeps the application usable with its local fallbacks.
        }
    },
    initializeTheme() {
        this.destroyAnalyticsTheme();
        this.analyticsThemeListening = true;
        this.analyticsThemeEventMode = null;
        this.analyticsThemeMedia = window.matchMedia('(prefers-color-scheme: dark)');
        this.analyticsThemeFilamentHandler = event => {
            if (!validMode(event.detail)) return;
            this.analyticsThemeEventMode = event.detail;
            this.scheduleAnalyticsThemeSync();
        };
        this.analyticsThemeMediaHandler = () => this.scheduleAnalyticsThemeSync();
        this.analyticsThemeStorageHandler = event => {
            if (event.key !== 'theme' && event.key !== null) return;
            this.analyticsThemeEventMode = null;
            this.scheduleAnalyticsThemeSync();
        };
        this.analyticsThemeObserver = new MutationObserver(() => {
            if (!this.root.isConnected) { this.destroyAnalyticsTheme(); return; }
            this.scheduleAnalyticsThemeSync();
        });
        this.analyticsThemeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        this.analyticsThemeMedia.addEventListener('change', this.analyticsThemeMediaHandler);
        window.addEventListener('theme-changed', this.analyticsThemeFilamentHandler);
        window.addEventListener('storage', this.analyticsThemeStorageHandler);
        this.analyticsThemeNavigationHandler = () => this.destroyAnalyticsTheme();
        document.addEventListener('livewire:navigating', this.analyticsThemeNavigationHandler);
        this.syncAnalyticsTheme({ announce: false });
    },
    scheduleAnalyticsThemeSync() {
        if (!this.analyticsThemeListening || this.analyticsThemeFrame != null) return;
        this.analyticsThemeFrame = window.requestAnimationFrame(() => {
            this.analyticsThemeFrame = null;
            if (!this.analyticsThemeListening) return;
            if (!this.root.isConnected) { this.destroyAnalyticsTheme(); return; }
            this.syncAnalyticsTheme();
        });
    },
    resolvedAnalyticsTheme() { return document.documentElement.classList.contains('dark') ? 'dark' : 'light'; },
    syncAnalyticsTheme({ announce = true } = {}) {
        const defaultMode = getComputedStyle(document.documentElement).getPropertyValue('--default-theme-mode').trim();
        this.analyticsThemeMode = [storedTheme(), this.analyticsThemeEventMode, defaultMode].find(validMode) || 'system';
        const resolved = this.resolvedAnalyticsTheme();
        const changed = this.root.dataset.analyticsTheme !== resolved;
        this.root.dataset.analyticsTheme = resolved;
        this.root.dataset.analyticsThemeMode = this.analyticsThemeMode;
        this.root.style.colorScheme = resolved;
        if (changed && announce) this.root.dispatchEvent(new CustomEvent('analytics:themechange', { bubbles: true, detail: { mode: this.analyticsThemeMode, resolved, palette: analyticsPalette(this.root) } }));
    },
    analyticsPalette() { return analyticsPalette(this.root); },
    destroyAnalyticsTheme() {
        this.analyticsThemeListening = false;
        if (this.analyticsThemeFrame != null) window.cancelAnimationFrame(this.analyticsThemeFrame);
        this.analyticsThemeFrame = null;
        this.analyticsThemeObserver?.disconnect();
        this.analyticsThemeMedia?.removeEventListener('change', this.analyticsThemeMediaHandler);
        if (this.analyticsThemeFilamentHandler) window.removeEventListener('theme-changed', this.analyticsThemeFilamentHandler);
        if (this.analyticsThemeStorageHandler) window.removeEventListener('storage', this.analyticsThemeStorageHandler);
        if (this.analyticsThemeNavigationHandler) document.removeEventListener('livewire:navigating', this.analyticsThemeNavigationHandler);
    },
};
