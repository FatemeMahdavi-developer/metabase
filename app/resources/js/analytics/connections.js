import { e, searchField, icon, button, tableHtml } from "./ui";
import { metadataSearchText } from './metadata-labels';
import { nativeTableElement } from './native-table';

function schemaTableHtml(connection, table) {
    const columns = [
        { key: 'name', label: 'نام ستون' },
        { key: 'type', label: 'نوع داده' },
        { key: 'semantic', label: 'معنا' },
        { key: 'relation', label: 'کلید / رابطه' },
        { key: 'nullable', label: 'مقدار خالی' },
        { key: 'visibility', label: 'نمایش' },
        { key: 'settings', label: 'تنظیم' },
    ];
    const root = nativeTableElement({
        result: { rows: table.fields }, columns, rows: table.fields, interactive: false,
        formatCell(column, field) {
            switch (field.key) {
                case 'name': return column.label || column.key;
                case 'type': return column.raw_type || '';
                case 'semantic': return column.semantic_type || '—';
                case 'relation': {
                    const relation = column.relation;
                    const target = relation && connection.catalog.find(row => row.key === relation.table);
                    return (column.primary ? '🔑 کلید اصلی' : '') + (relation ? ' → ' + (target?.label || relation.table) + '.' + relation.field : '');
                }
                case 'nullable': return column.nullable ? 'بله' : 'خیر';
                case 'visibility': return column.hidden ? 'پنهان' : 'قابل نمایش';
                default: return '';
            }
        },
    });
    root.classList.add('mb-schema-metadata');
    root.querySelectorAll('tbody tr').forEach((record, index) => {
        const column = table.fields[index];
        const label = record.querySelector('[data-column="name"] [data-native-cell-label]');
        const name = document.createElement('strong');
        name.textContent = column.label || column.key;
        label.replaceChildren(name);
        if (column.label && column.label !== column.key) {
            const original = document.createElement('small');
            original.className = 'mb-list-subtitle';
            original.dir = 'ltr';
            original.textContent = column.key;
            label.append(original);
        }
        record.querySelector('[data-column="type"] [data-native-cell-label]').dir = 'ltr';
        record.querySelector('[data-column="settings"] [data-native-cell-label]').innerHTML = button(
            icon('settings'), 'editDataMetadata', 'small',
            `data-key="${e(column.key)}" aria-label="تنظیم ستون ${e(column.label || column.key)}"`,
        );
    });
    return root.outerHTML;
}

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
        return `<header class="mb-toolbar mb-database-toolbar"><div><div class="mb-breadcrumb">مرور داده‌ها</div><h1>${icon('database')} ${e(connection.name)}</h1></div><div class="mb-actions">${button(icon('settings') + 'تنظیم اتصال', 'editConnection', '', `data-id="${connection.id}"`)}${button(icon('refresh') + 'همگام‌سازی', 'syncConnection')}${table ? button('ساخت گزارش از این جدول', 'reportFromTable', 'primary') : ''}</div></header><div class="mb-content"><div class="mb-schema"><nav class="mb-schema-tables">${searchField('data-schema-search', 'جست‌وجوی جدول…')}${connection.catalog.map(row => `<button class="${row.key === this.browserTable ? 'active' : ''}" data-action="selectTable" title="${e(row.label || row.key)}" data-key="${e(row.key)}" data-search-text="${e(metadataSearchText(row))}">${icon('table')} <span class="mb-schema-table-name" dir="auto">${e(row.label || row.key)}</span> ${row.kind === 'view' ? '<small>View</small>' : ''}</button>`).join('')}</nav><div class="mb-schema-details">${table ? `<div class="mb-schema-heading"><div><h2>${e(table.label || table.key)} <span class="mb-count">${table.fields.length} ستون</span></h2><p class="mb-help">${e(table.description)}</p></div>${button('تنظیم جدول', 'editDataMetadata', 'small')}</div><nav class="mb-browser-tabs"><button class="${this.browserMode !== 'data' ? 'active' : ''}" data-action="browserTab" data-tab="schema">ساختار داده‌ها</button><button class="${this.browserMode === 'data' ? 'active' : ''}" data-action="browserTab" data-tab="data">داده‌های جدول</button></nav>${this.browserMode !== 'data' ? schemaTableHtml(connection, table) : `<div class="mb-actions">${button(icon('filter') + 'فیلتر', 'tableFilter')}${button(icon('chart') + 'خلاصه‌سازی', 'tableSummarize')}</div>`}<h3 class="mb-browser-preview-heading">${this.browserMode === 'data' ? 'داده‌ها' : 'نمونهٔ داده'}</h3><div class="mb-browser-preview"><div class="mb-loading">در حال خواندن جدول…</div></div>` : '<div class="mb-empty">جدولی پیدا نشد.</div>'}</div></div></div>`;
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
