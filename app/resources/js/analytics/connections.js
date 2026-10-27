import { e, icon, button, tableHtml } from "./ui";
import { metadataSearchText } from './metadata-labels';

export const connectionMethods = {

async browseConnection(target) {
        const opening = ++this.navigationEpoch;
        let connection = this.library.connections.find(row => row.id === Number(target.dataset.id));
        if (!connection.catalog) connection = await this.request(`connections/${connection.id}/sync`, 'POST', {});
        if (opening !== this.navigationEpoch) return;
        this.browserConnection = connection;
        this.library.connections = this.library.connections.map(row => row.id === connection.id ? connection : row);
        this.browserTable = this.browserConnection.catalog[0]?.key; this.view = 'browser'; this.render();
    },
    async syncConnection() { this.browserConnection = await this.request(`connections/${this.browserConnection.id}/sync`, 'POST', {}); await this.refreshLibrary(); if (!this.browserConnection.catalog.some(table => table.key === this.browserTable)) this.browserTable = this.browserConnection.catalog[0]?.key; this.render(); this.toast('ساختار دیتابیس همگام شد.'); },
    browserHtml() {
        const connection = this.browserConnection; const table = connection.catalog.find(row => row.key === this.browserTable);
        return `<header class="mb-toolbar"><div><div class="mb-breadcrumb">مرور داده‌ها</div><h1>${icon('database')} ${e(connection.name)}</h1></div><div class="mb-actions">${button(icon('settings') + 'تنظیم اتصال', 'editConnection', '', `data-id="${connection.id}"`)}${button(icon('refresh') + 'همگام‌سازی', 'syncConnection')}${table ? button('ساخت گزارش از این جدول', 'reportFromTable', 'primary') : ''}</div></header><div class="mb-content"><div class="mb-schema"><nav class="mb-schema-tables"><label class="mb-search">${icon('search')}<input placeholder="جست‌وجوی جدول…" aria-label="جست‌وجوی جدول" data-schema-search></label>${connection.catalog.map(row => `<button class="${row.key === this.browserTable ? 'active' : ''}" data-action="selectTable" data-key="${e(row.key)}" data-search-text="${e(metadataSearchText(row))}">${icon('table')} ${e(row.label || row.key)} ${row.kind === 'view' ? '<small>View</small>' : ''}</button>`).join('')}</nav><div class="mb-schema-details">${table ? `<div class="mb-schema-heading"><div><h2>${e(table.label || table.key)} <span class="mb-count">${table.fields.length} ستون</span></h2><p class="mb-help">${e(table.description)}</p></div>${button('تنظیم جدول', 'editDataMetadata', 'small')}</div><nav class="mb-browser-tabs"><button class="${this.browserMode !== 'data' ? 'active' : ''}" data-action="browserTab" data-tab="schema">ساختار داده‌ها</button><button class="${this.browserMode === 'data' ? 'active' : ''}" data-action="browserTab" data-tab="data">داده‌های جدول</button></nav>${this.browserMode !== 'data' ? `<table class="mb-table"><thead><tr><th>نام ستون</th><th>نوع داده</th><th>معنا</th><th>کلید / رابطه</th><th>مقدار خالی</th><th>نمایش</th><th></th></tr></thead><tbody>${table.fields.map(column => `<tr><td><strong>${e(column.label || column.key)}</strong><small class="mb-list-subtitle" dir="ltr"> ${column.label !== column.key ? e(column.key) : ''}</small></td><td dir="ltr">${e(column.raw_type)}</td><td>${e(column.semantic_type || '—')}</td><td>${column.primary ? '🔑 کلید اصلی' : ''}${column.relation ? ` → ${e(connection.catalog.find(row => row.key === column.relation.table)?.label || column.relation.table)}.${e(column.relation.field)}` : ''}</td><td>${column.nullable ? 'بله' : 'خیر'}</td><td>${column.hidden ? 'پنهان' : 'قابل نمایش'}</td><td>${button(icon('settings'), 'editDataMetadata', 'small', `data-key="${e(column.key)}" aria-label="تنظیم ستون ${e(column.label)}"`)}</td></tr>`).join('')}</tbody></table>` : `<div class="mb-actions">${button(icon('filter') + 'فیلتر', 'tableFilter')}${button(icon('chart') + 'خلاصه‌سازی', 'tableSummarize')}</div>`}<h3 style="margin:24px 0 12px;font-weight:bold">${this.browserMode === 'data' ? 'داده‌ها' : 'نمونهٔ داده'}</h3><div class="mb-browser-preview"><div class="mb-loading">در حال خواندن جدول…</div></div>` : '<div class="mb-empty">جدولی پیدا نشد.</div>'}</div></div></div>`;
    },
    selectTable(target) { this.browserTable = target.dataset.key; this.render(); },
    browserTab(target) { this.browserMode = target.dataset.tab; this.render(); },
    tableFilter() { this.reportFromTable(); this.addReportFilter(); },
    tableSummarize() { this.reportFromTable(); this.addMetric(); },
    async loadTablePreview() {
        if (!this.browserTable) return; const epoch = this.epoch;
        try { const result = await this.request('reports/preview', 'POST', { query_definition: { connection_id: this.browserConnection.id, source: this.browserTable, mode: 'rows', metrics: [], dimensions: [], filters: [], sort: [], joins: [], limit: 20 } }); if (epoch === this.epoch) this.root.querySelector('.mb-browser-preview').innerHTML = tableHtml(result); }
        catch (error) { if (epoch === this.epoch) this.root.querySelector('.mb-browser-preview').innerHTML = `<div class="mb-error">${e(error.message)}</div>`; }
    },
    reportFromTable() { this.createReport(this.browserConnection.id, this.browserTable); },

    async saveDataMetadata() {
        const form = this.form();
        this.browserConnection = await this.request(`connections/${this.browserConnection.id}/metadata`, 'PUT', {
            table: this.browserTable, field: this.metadataField,
            labels: { fa: String(form.get('label_fa') || '').trim() || null, en: String(form.get('label_en') || '').trim() || null },
            description: form.get('description'),
            ...(this.metadataField ? { hidden: form.has('hidden'), semantic_type: form.get('semantic_type') || null } : {}),
        });
        await this.refreshLibrary(); this.closeModal(); this.render(); this.toast('تنظیمات داده ذخیره شد.');
    },
};
