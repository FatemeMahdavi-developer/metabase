import { button, e, icon } from './ui';

export const nativeNavigationMethods = {
    initializeNativeNavigation() {
        this.nativeRoutes = JSON.parse(this.root.dataset.routes || '{}');
        this.nativeInitial = JSON.parse(this.root.dataset.initial || '{}');
        this.dashboardReadOnly = this.root.dataset.readOnly === 'true';
        this.nativePopstate = () => { if (this.root.isConnected) window.location.reload(); };
        window.addEventListener('popstate', this.nativePopstate);
    },
    workbenchUrl(section, record, query = {}) {
        const url = new URL(this.nativeRoutes[section].replace('__record__', encodeURIComponent(record)), window.location.origin);
        Object.entries(query).forEach(([key, value]) => { if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value); });
        return url.pathname + url.search;
    },
    async loadNativeView() {
        const section = this.root.dataset.section;
        const record = this.root.dataset.record;
        if (section === 'dashboard') {
            let navigation = null;
            try {
                const value = this.nativeInitial.filters;
                const parsed = value && value.length < 50000 ? JSON.parse(value) : null;
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) navigation = parsed;
            } catch {}
            if (!await this.openDashboard({ dataset: { id: record } }, navigation) || this.destroyed) return;
            if (this.nativeInitial.edit && this.dashboard.can_edit) this.editDashboard();
            const report = this.library.reports.find(row => row.id === Number(this.nativeInitial.add_report));
            if (report && this.dashboard.can_edit) { this.editDashboard(); this.addWidget({ type: 'report', report_id: report.id, settings: {}, click_behavior: { type: 'details' } }); }
        } else if (section === 'browser') {
            await this.browseConnection({ dataset: { id: record } });
        } else if (section === 'report' && record !== 'new') {
            this.openReport({ dataset: { id: record } });
        } else {
            this.view = 'start-report';
            this.render();
            const connection = this.library.connections.find(row => row.id === Number(this.nativeInitial.connection));
            const table = connection?.catalog?.find(row => row.key === this.nativeInitial.table);
            if (table) {
                this.sourceConnection = connection.id;
                this.sourcePurpose = this.nativeInitial.mode === 'native' ? 'native' : 'new';
                this.pickSourceTable({ dataset: { key: table.key } });
                if (this.nativeInitial.intent === 'filter') this.addReportFilter();
                if (this.nativeInitial.intent === 'summarize') this.addMetric();
            } else if (this.library.connections.some(row => row.catalog?.length)) {
                this.nativeInitial.mode === 'native' ? this.newNativeReport() : this.newReport();
            }
        }
    },
    syncWorkbenchUrl() {
        if (this.destroyed || !this.root.isConnected || !this.nativeRoutes || this.drillSession) return;
        let url;
        if (this.view === 'dashboard' && this.dashboard?.id) url = this.workbenchUrl('dashboard', this.dashboard.id, this.dashboardNavigation ? { filters: JSON.stringify(this.dashboardNavigation) } : {});
        if (this.view === 'browser' && this.browserConnection?.id) url = this.workbenchUrl('browser', this.browserConnection.id);
        if (this.view === 'report' && this.report) {
            const definition = this.report.query_definition;
            url = this.workbenchUrl('report', this.report.id || 'new', this.report.id ? {} : { connection: definition.connection_id, table: definition.source, mode: definition.mode === 'native' ? 'native' : null });
        }
        if (url && url !== window.location.pathname + window.location.search + window.location.hash) {
            if (this.view !== this.root.dataset.section) {
                this.dirty = false;
                window.location.assign(url);
                return;
            }
            const newReportPath = new URL(this.workbenchUrl('report', 'new'), window.location.origin).pathname;
            const samePath = new URL(url, window.location.origin).pathname === window.location.pathname;
            window.history[samePath || window.location.pathname === newReportPath ? 'replaceState' : 'pushState']({ analytics: true }, '', url);
        }
    },
    nativeReportStartHtml() {
        return `<header class="mb-toolbar"><div><h1>گزارش جدید</h1><small>منبع داده را انتخاب کنید و پرس‌وجو را بسازید.</small></div></header><section class="mb-content"><div class="mb-empty"><strong>انتخاب منبع داده</strong><p>برای ساخت گزارش، یک جدول از اتصال‌های همگام‌شده انتخاب کنید.</p><div class="mb-actions">${this.library.connections.some(row => row.catalog?.length) ? button(icon('table') + 'انتخاب جدول', 'newReport', 'primary') + button(icon('code') + 'پرس‌وجوی SQL', 'newNativeReport') : `<a class="mb-btn primary" href="${e(this.nativeRoutes.connections)}">مدیریت پایگاه‌های داده</a>`}</div></div></section>`;
    },
    navigate(target) {
        const url = this.nativeRoutes[target.dataset.view];
        if (!url) return;
        if (this.dirty) { this.confirm('تغییرات ذخیره‌نشده', 'با خروج از این صفحه تغییرات موقت از دست می‌روند.', () => { this.dirty = false; window.location.assign(url); }); return; }
        window.location.assign(url);
    },
    newDashboard() {
        const url = new URL(this.nativeRoutes.dashboards);
        url.searchParams.set('action', 'create');
        if (this.pendingReportId) url.searchParams.set('add_report', this.pendingReportId);
        window.location.assign(url);
    },
    newConnection() { window.location.assign(this.nativeRoutes.connections + '?action=create'); },
    editConnection(target) { window.location.assign(this.nativeRoutes.connections + '?tableAction=edit&tableActionRecord=' + encodeURIComponent(target.dataset.id)); },
    reportToDashboard(target) {
        const report = this.pendingReportId;
        this.dirty = false;
        window.location.assign(this.workbenchUrl('dashboard', target.dataset.id, { add_report: report }));
    },
    reportFromTable() {
        window.location.assign(this.workbenchUrl('report', 'new', { connection: this.browserConnection.id, table: this.browserTable }));
    },
    tableFilter() {
        window.location.assign(this.workbenchUrl('report', 'new', { connection: this.browserConnection.id, table: this.browserTable, intent: 'filter' }));
    },
    tableSummarize() {
        window.location.assign(this.workbenchUrl('report', 'new', { connection: this.browserConnection.id, table: this.browserTable, intent: 'summarize' }));
    },
};
