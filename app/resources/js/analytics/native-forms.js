import { nativeFormData, filterFormState, valueFormState, readValueState } from './native-form-state.js';
import { copy, uid, e, button, icon } from './ui';
import { readQueryFilter } from './notebook-flow';
import { chartColorEntries, chartDefaultPalette, resolveSeriesColors } from './chart-style';
import { persistedPresentationSettings } from './drill-presentation';
import { expressionFunctions } from './expression-editor';

// Only draft values/options cross this bridge. Field markup and validation live in PHP.
const rows = items => items.map(row => ({ key: row.key ?? row.id, label: row.label ?? row.name, ...(row.type ? { type: row.type } : {}), ...(row.is_dimension !== undefined ? { is_dimension: row.is_dimension } : {}) }));
const tables = items => items.map(table => ({ key: table.key, label: table.label, fields: rows(table.fields || []) }));
const list = value => String(value ?? '').split(',').map(item => item.trim()).filter(Boolean);
function filterRow(data, fields) {
    const column = fields.find(field => field.key === data.field);
    const values = { ...data };
    if (column?.type === 'date' && !['in', 'not_in', 'between', 'not_between'].includes(data.operator)) values.value = data.date_value;
    if (column?.type === 'boolean') values.value = data.boolean_value === 'false' ? '0' : '1';
    if (column?.type === 'date' && data.date_part && ['in', 'not_in'].includes(data.operator)) values.value = list(data.value);
    return readQueryFilter(nativeFormData(values), column);
}
export const nativeFormMethods = {
    workbenchWire() { return window.Livewire.find(this.root.closest('[wire\\:id]').getAttribute('wire:id')); },
    initializeNativeForms() {
        this.nativeFormListener = async event => {
            const pending = this.nativeFormPending;
            if (!pending || pending.id !== event.detail.requestId || this.destroyed || pending.busy) return;
            pending.busy = true;
            this.submittedFormData = nativeFormData(event.detail.data);
            try {
                const callback = event.detail.command === 'submit' ? pending.submit : pending.commands[event.detail.command];
                if (callback) await callback(event.detail.data);
                if (this.nativeFormPending === pending) this.closeNativeForm();
            } catch (error) {
                if (this.nativeFormPending === pending) await this.workbenchWire().workbenchFailed(pending.id, error.message);
            } finally { pending.busy = false; this.submittedFormData = null; }
        };
        window.addEventListener('analytics-form-submitted', this.nativeFormListener);
        this.nativeDismissListener = event => { if (event.detail.id === 'analytics-native-form') this.nativeFormPending = null; };
        window.addEventListener('modal-closed', this.nativeDismissListener, true);
    },
    async nativeForm(kind, data, context, submit, commands = {}) {
        this.closeModal();
        const pending = { id: uid(), kind, submit, commands, busy: false };
        this.nativeFormPending = pending;
        try {
            // Register native lazy components before Livewire morphs the first form.
            // This also keeps offline/LAN navigation independent of lazy-load timing.
            this.nativeComponentsReady ||= Promise.all(Object.entries(JSON.parse(this.root.dataset.formComponents || '{}')).map(async ([name, url]) => {
                const component = await import(/* @vite-ignore */ url);
                window.Alpine.data(name, component.default);
            }));
            await this.nativeComponentsReady;
            if (this.destroyed || this.nativeFormPending !== pending) return;
            await this.workbenchWire().openWorkbenchForm(kind, copy(data), copy(context), pending.id);
            if (this.destroyed || this.nativeFormPending !== pending) window.dispatchEvent(new CustomEvent('close-modal', { detail: { id: 'analytics-native-form' } }));
        } catch (error) { if (this.nativeFormPending === pending) { this.nativeFormPending = null; this.toast(error.message, true); } }
    },
    closeNativeForm() {
        if (!this.nativeFormPending) return;
        this.nativeFormPending = null;
        window.dispatchEvent(new CustomEvent('close-modal', { detail: { id: 'analytics-native-form' } }));
    },
    confirm(title, message, callback) { return this.nativeForm('confirm', {}, { message }, callback); },
    newFolder() { return this.nativeForm('folder', { name: '' }, {}, () => this.saveFolder()); },
    reportSaveDialog() { return this.nativeForm('report', { ...this.report, add_to_dashboard: false }, {}, () => this.saveReport()); },
    dashboardSettings() { return this.nativeForm('dashboard', { ...this.dashboard, ...this.dashboard.settings, refresh_interval: this.dashboard.settings.refresh_interval || 0 }, { is_owner: this.dashboard.is_owner }, () => this.saveDashboardSettings()); },
    addTab() { this.tabDraft = null; return this.nativeForm('tab', { name: '' }, {}, () => this.saveTab()); },
    editTab(target) { this.tabDraft = this.dashboard.tabs.find(tab => tab.key === target.dataset.key); return this.nativeForm('tab', { name: this.tabDraft.name }, { existing: true }, () => this.saveTab(), { delete: () => this.deleteTab(), copy: () => this.duplicateTab() }); },
    addTextCard() { this.textDraft = null; return this.nativeForm('text', { title: '', content: '' }, {}, () => this.saveTextCard()); },
    addLinkCard() { this.textDraft = null; return this.nativeForm('link', { title: '', content: '' }, {}, () => this.saveLinkCard()); },
    shareDashboard() { return this.nativeForm('share', { email: '', role: 'viewer' }, {}, () => this.saveShare()); },
    copyDashboard() { return this.nativeForm('copy', { copy_reports: false }, {}, () => this.saveDashboardCopy()); },
    selectColumns() { const q = this.report.query_definition; return this.nativeForm('columns', { columns: q.columns || this.reportFields().filter(field => !field.hidden).slice(0, 50).map(field => field.key) }, { fields: this.reportFields() }, () => this.saveColumns()); },
    metricDialog() { return this.openNativeMetric(this.metricDraft, this.reportFields(), async data => { this.metricDraft.function = data.function; await this.saveMetric(); }); },
    notebookMetricDialog() { return this.openNativeMetric(this.notebookItemDraft, this.notebookDraftContext.fields, async data => { this.notebookItemDraft.function = data.function; await this.saveNotebookMetric(); }); },
    openNativeMetric(metric, fields, save) { return this.nativeForm('metric', metric, { fields }, save); },
    editDimension(target) {
        this.queryItemIndex = Number(target.dataset.index);
        const row = this.report.query_definition.dimensions[this.queryItemIndex] || {};
        return this.nativeForm('dimension', row, { fields: this.reportFields() }, () => this.saveDimension());
    },
    notebookDimensionDialog() { return this.nativeForm('dimension', this.notebookItemDraft, { fields: this.notebookDraftContext.fields }, () => this.saveNotebookDimension()); },
    reportFilterDialog() {
        return this.nativeForm('filter', filterFormState(this.queryFilterDraft), { fields: this.reportFields() }, async data => {
            const q = copy(this.report.query_definition); const row = filterRow(data, this.reportFields());
            if (this.queryItemIndex < 0) q.filters.push(row); else q.filters[this.queryItemIndex] = row;
            await this.commitNotebookDefinition(0, q);
        });
    },
    notebookFilterDialog() { return this.nativeForm('filter', filterFormState(this.notebookItemDraft), { fields: this.notebookDraftContext.fields }, data => this.saveNotebookItem('filters', filterRow(data, this.notebookDraftContext.fields))); },
    notebookSortDialog() {
        return this.nativeForm('sort', this.notebookItemDraft, { fields: this.notebookSortFields(this.notebookEditingStage) }, data => this.saveNotebookItem('sort', { key: data.key, direction: data.direction }));
    },
    editSort(target) {
        const stage = Number(target.dataset.stage || 0); this.notebookEditingStage = stage; this.notebookSortIndex = Number(target.dataset.index);
        this.notebookDraftContext = this.prepareNotebookContext(stage);
        const q = this.notebookDraftContext.definition; const row = q.sort[this.notebookSortIndex] || { direction: 'asc' };
        const fields = this.notebookSortFields(stage).filter(column => !q.sort.some((sort, index) => sort.key === column.key && index !== this.notebookSortIndex));
        return this.nativeForm('sort', row, { fields }, () => this.saveSort());
    },
    async expressionDialog() {
        const context = this.expressionEditorContext;
        await this.nativeForm('expression', this.expressionDraft, { fields: context.fields, functions: expressionFunctions }, data => {
            this.expressionDraft.expression = data.expression; this.expressionDraft.label = data.label;
            return this.saveExpression();
        });
        const editor = this.expressionEditorTextarea();
        if (editor) { editor.addEventListener('click', () => { this.updateExpressionSuggestions(); this.updateExpressionHelp(); }); this.queueExpressionValidation(); }
    },
    expressionEditorTextarea() { return this.nativeFormPending?.kind === 'expression' ? this.root.querySelector('[data-analytics-native-form] [data-expression-editor]') : null; },
    expressionEditorKeydown(event) {
        if (!event.target.matches('[data-expression-editor]')) return;
        const suggestions = this.expressionSuggestions || []; const box = this.root.querySelector('[data-expression-suggestions]');
        if (box && !box.hidden && suggestions.length && ['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape'].includes(event.key)) {
            event.preventDefault(); event.stopPropagation();
            if (event.key === 'Escape') { box.hidden = true; return; }
            if (['Enter', 'Tab'].includes(event.key)) { this.acceptExpressionSuggestion({ dataset: { index: this.expressionSuggestionIndex } }); return; }
            this.expressionSuggestionIndex = (this.expressionSuggestionIndex + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length; this.updateExpressionSuggestions();
        }
    },
    drillFilterDialog() {
        const data = this.drillFilterData; const field = { key: data.context.column_key, label: data.response.context.column_label || data.context.column_key, type: data.response.context.type };
        return this.nativeForm('filter', filterFormState({ field: field.key, operator: data.action.operator || 'eq', value: data.response.context.value }), { fields: [field] }, values => {
            const { field: ignored, ...filter } = filterRow(values, [field]);
            return this.performDrill(data, data.action, filter);
        });
    },
    joinDialog() {
        const connection = this.library.connections.find(row => row.id === this.report.query_definition.connection_id);
        return this.nativeForm('join', this.joinDraft, { fields: rows(this.joinLeftFields()), tables: tables(connection.catalog) }, async data => {
            this.joinDraft.type = data.type; this.joinDraft.source = data.source; this.joinDraft.conditions = Object.values(data.conditions);
            // The existing commit path validates types, aliases, stage references and access.
            const flat = {};
            this.joinDraft.conditions.forEach((row, index) => { flat['left_' + index] = row.left; flat['right_' + index] = row.right; flat['operator_' + index] = row.operator; });
            this.submittedFormData = nativeFormData(flat);
            await this.saveJoin();
        });
    },
    nativeParameters() {
        const q = this.report.query_definition;
        const names = [...new Set([...q.sql.matchAll(/\{\{([a-z][a-z0-9_]*)\}\}/g)].map(match => match[1]))];
        const parameters = names.map(key => q.parameters?.find(row => row.key === key) || { key, type: 'text', default: '', required: false });
        return this.nativeForm('parameters', { parameters }, {}, data => { q.parameters = Object.values(data.parameters); this.queryUpdated(); });
    },
    nativeEditorHtml(connection) {
        const q = this.report.query_definition;
        return `<section class="mb-native-editor"><header><strong dir="ltr">SQL</strong>${button(icon('database') + e(connection?.name), 'changeSource', 'small')}${button('ویرایش SQL', 'editNativeSql')}${button('متغیرها', 'nativeParameters')}${button(icon('play') + 'نمایش نتیجه', 'runReport', 'primary')}</header><pre class="mb-sql" dir="ltr" data-sql-preview>${e(q.sql || '')}</pre>${this.sqlSchemaOpen ? `<nav class="mb-sql-schema">${(connection?.catalog || []).map(table => `<details><summary>${e(table.label)}</summary>${table.fields.map(field => button(e(field.label), 'insertSqlField', 'small', `data-key="${e(field.key)}"`)).join('')}</details>`).join('')}</nav>` : ''}<div class="mb-native-variables">${(q.parameters || []).map(row => `<span class="mb-chip">{{${e(row.key)}}} ${e(row.default ?? '')}</span>`).join('')}</div></section>`;
    },
    editNativeSql(sql = this.report.query_definition.sql) {
        if (typeof sql !== 'string') sql = this.report.query_definition.sql;
        return this.nativeForm('sql', { sql }, {}, data => { this.report.query_definition.sql = data.sql; this.queryUpdated(); });
    },
    insertSqlField(target) {
        const identifier = '"' + target.dataset.key.replaceAll('"', '""') + '"';
        return this.editNativeSql(this.report.query_definition.sql + ' ' + identifier);
    },
    displayPicker() { return this.nativeForm('display', { display: this.report.display }, {}, data => this.pickDisplay({ dataset: { display: data.display } })); },
    sourcePickerDialog() {
        const connections = this.library.connections.filter(row => row.catalog?.length).map(row => ({ key: row.id, label: row.name, catalog: rows(row.catalog) }));
        return this.nativeForm('source', { connection_id: this.sourceConnection || connections[0]?.key, source: null }, { connections }, data => {
            this.sourceConnection = Number(data.connection_id); return this.pickSourceTable({ dataset: { key: data.source } });
        });
    },
    addReportCard() {
        const reports = this.dashboard.is_owner ? this.library.reports : this.dashboard.reports;
        return this.nativeForm('report_card', { report_id: null }, { reports: rows(reports) }, data => this.addWidget({ type: 'report', report_id: Number(data.report_id), settings: {}, click_behavior: { type: 'details' } }));
    },
    reportDashboardPicker() {
        if (!this.report.id || this.dirty) throw new Error('ابتدا گزارش را ذخیره کنید.');
        this.pendingReportId = this.report.id;
        return this.nativeForm('dashboard_picker', { dashboard_id: null }, { dashboards: rows(this.library.dashboards.filter(row => row.is_owner)) }, data => this.reportToDashboard({ dataset: { id: data.dashboard_id } }), { create: () => this.newDashboard() });
    },
    cardSettings(target) {
        const widget = this.dashboard.widgets.find(row => row.key === target.dataset.key); this.cardDraft = widget;
        if (widget.type !== 'report') {
            this.textDraft = widget;
            return this.nativeForm(widget.type === 'link' ? 'link' : 'text', { title: widget.settings.title || '', content: widget.content }, {}, () => widget.type === 'link' ? this.saveLinkCard() : this.saveTextCard());
        }
        const title = widget.settings.title || this.dashboardReport(widget.report_id).name;
        const saveTitle = data => { widget.settings.title = data.title || ''; this.markDirty(); };
        return this.nativeForm('card', { title }, {}, data => { saveTitle(data); this.render(); }, {
            visualization: data => { saveTitle(data); const report = this.dashboardReport(widget.report_id); this.vizTarget = widget.key; this.visualizationDialog({ ...report.visualization_settings, ...widget.settings }, widget.settings.display || report.display, this.results.get(widget.key)?.columns || []); },
            click: async data => { saveTitle(data); const pending = this.nativeFormPending; if (!this.results.get(widget.key)) await this.loadCard(widget, true); if (this.nativeFormPending === pending) this.nativeClickEditor(widget); },
        });
    },
    nativeClickEditor(widget, scope = '*', draft = null) {
        const columns = this.results.get(widget.key)?.columns || [];
        const config = copy(draft || widget.click_behavior || { type: 'menu' });
        const behavior = scope === '*' ? config : config.columns?.[scope] || config;
        if (!behavior.type || behavior.type === 'details') behavior.type = 'menu';
        const context = { fields: rows(columns), dashboards: rows(this.library.dashboards), reports: rows(this.library.reports), report_targets: Object.fromEntries(this.library.reports.map(report => [report.id, rows(this.dashboardFilterFields(report))])), parameters: rows(this.dashboard.filters), target_help: 'فیلترهای این داشبورد: ' + this.dashboard.filters.map(row => row.key + ' (' + row.label + ')').join('، ') };
        const commit = (data, validate) => {
            const changed = { type: data.type };
            if (data.type === 'url') Object.assign(changed, { url: data.url, link_text: data.link_text || '' });
            if (data.type === 'dashboard') changed.dashboard_id = Number(data.dashboard_id);
            if (data.type === 'report') changed.report_id = Number(data.report_id);
            if (['filter', 'dashboard', 'report'].includes(data.type)) changed.mappings = Object.values(data.mappings || []);
            this.clickBehaviorEditor = { columns }; // Shared validation for templates and mappings.
            if (validate) this.validateClickBehavior(changed);
            if (scope === '*') return { ...changed, ...(config.columns ? { columns: config.columns } : {}) };
            config.columns ||= {}; if (data.inherit) delete config.columns[scope]; else config.columns[scope] = changed;
            return config;
        };
        return this.nativeForm('click', { ...behavior, scope, inherit: false }, context, data => { widget.click_behavior = commit(data, true); this.markDirty(); this.render(); }, { scope: data => this.nativeClickEditor(widget, data.scope, commit(data, false)) });
    },
    visualizationPanel() {
        const s = this.vizDraft; const entries = this.vizResult ? chartColorEntries(this.vizResult, this.vizDisplay, s).slice(0, 100) : [];
        const colors = this.vizResult ? resolveSeriesColors(this.vizResult, this.vizDisplay, s, this.root) : {};
        const data = { ...s, display: this.vizDisplay, color: s.color || chartDefaultPalette(this.vizDisplay, this.root)[0], decimals: s.decimals ?? 0, page_size: s.page_size || 25, target: s.target ?? 100, ring_thickness: s.ring_thickness ?? 28, center_mode: s.center_mode || 'total', gauge_style: s.gauge_style || 'semi', percent_visibility: s.percent_visibility || 'off', visible_columns: s.visible_columns?.length ? s.visible_columns : this.vizColumns.map(row => row.key), series_colors: entries.map(row => ({ key: row.key, label: row.label, color: colors[row.key] })) };
        for (const key of ['legend', 'show_total', 'show_x', 'show_y', 'points', 'smooth']) data[key] = s[key] !== false;
        return this.nativeForm('visualization', data, { fields: this.vizColumns, colors: entries }, values => {
            const { display, series_colors, reset_colors, ...settings } = values;
            const categoryColors = reset_colors ? {} : { ...(s.series_colors || {}) };
            if (!reset_colors) for (const row of Object.values(series_colors || [])) if (row.color !== colors[row.key] || Object.hasOwn(categoryColors, row.key)) categoryColors[row.key] = row.color;
            const changedColor = settings.color != null && settings.color !== data.color;
            if (!changedColor && !s.color) delete settings.color;
            for (const key of ['decimals', 'target', 'page_size', 'y_min', 'y_max', 'ring_thickness']) if (settings[key] != null && settings[key] !== '') settings[key] = Number(settings[key]);
            if (settings.y_min != null && settings.y_min !== '' && settings.y_max != null && settings.y_max !== '' && settings.y_min >= settings.y_max) throw new Error('بیشینهٔ محور باید بزرگ‌تر از کمینه باشد.');
            this.vizDisplay = display;
            this.vizDraft = { ...s, ...settings, series_colors: categoryColors, color_custom: !!s.color_custom || changedColor };
            if (changedColor || reset_colors || display !== data.display) delete this.vizDraft._series_colors;
            const final = persistedPresentationSettings(this.vizDraft);
            if (display === 'table' && !final.visible_columns?.length) throw new Error('حداقل یک ستون انتخاب کنید.');
            if (this.vizTarget === 'report') { this.report.display = display; this.report.visualization_settings = final; }
            else { const widget = this.dashboard.widgets.find(row => row.key === this.vizTarget); widget.settings = { ...widget.settings, ...final, display }; }
            this.visualizationColors.clear(); this.markDirty(); this.render();
        });
    },
    editDataMetadata(target) {
        const table = this.browserConnection.catalog.find(table => table.key === this.browserTable);
        const column = target.dataset.key ? table.fields.find(field => field.key === target.dataset.key) : null; this.metadataField = column?.key || null;
        const row = column || table; const metadata = this.browserConnection.metadata?.[table.key] || {}; const custom = column ? metadata.fields?.[column.key] || {} : metadata;
        const label = lang => Object.hasOwn(custom.labels || {}, lang) ? custom.labels[lang] || '' : row.display_names?.[lang] !== row.display_names?.original ? row.display_names?.[lang] || '' : '';
        return this.nativeForm('metadata', { original: row.original_name || row.key, label_fa: label('fa'), label_en: label('en'), description: row.description, semantic_type: row.semantic_type, hidden: !!row.hidden }, { column: !!column }, () => this.saveDataMetadata());
    },
    addDashboardFilter() {
        this.filterDraft = { key: uid(), label: 'فیلتر جدید', type: 'text', required: false, default_value: null, settings: { widget_type: 'dropdown' }, bindings: [] };
        this.filterIsNew = true; return this.filterDialog();
    },
    filterDialog() {
        const filter = this.filterDraft;
        const widgets = this.dashboard.widgets.filter(widget => widget.type === 'report').map(widget => { const report = this.dashboardReport(widget.report_id); return { key: widget.key, label: widget.settings.title || report.name, fields: this.dashboardFilterFields(report) }; });
        const operator = filter.bindings[0]?.operator || filter.settings.operator || (filter.type === 'date' ? 'between' : filter.type === 'time_grain' ? 'grain' : 'eq');
        const data = { ...filter, ...valueFormState(filter.default_value, operator), operator, widget_type: filter.settings.widget_type || 'dropdown', values: (filter.settings.values || []).join(', '), parent_key: filter.settings.parent_key, case_sensitive: !!filter.settings.case_sensitive };
        return this.nativeForm('dashboard_filter', data, { existing: !this.filterIsNew, widgets, parents: rows(this.dashboard.filters.filter(row => row.key !== filter.key)) }, values => {
            const parent = values.widget_type === 'input' || list(values.values).length ? null : values.parent_key || null;
            const bindings = Object.values(values.bindings || []).map(row => ({ ...row, operator: values.operator }));
            if (new Set(bindings.map(row => row.widget_key)).size !== bindings.length) throw new Error('هر کارت فقط یک اتصال به این فیلتر می‌پذیرد.');
            const updated = { ...filter, label: values.label, type: values.type, required: !!values.required, default_value: readValueState(values, values.type, values.operator), settings: { ...filter.settings, values: list(values.values), parent_key: parent, widget_type: values.widget_type, case_sensitive: !!values.case_sensitive, operator: values.operator }, bindings };
            if (this.filterIsNew) this.dashboard.filters.push(updated); else Object.assign(this.dashboard.filters.find(row => row.key === filter.key), updated);
            this.filterValues[filter.key] = copy(updated.default_value); this.markDirty(); this.render();
        }, { delete: () => this.removeDashboardFilter() });
    },
    async openNativeFilterValue(filter) {
        const operator = filter.bindings[0]?.operator || filter.settings.operator || 'eq';
        let suggestions = (filter.settings.values || []).map(value => ({ key: value, label: value }));
        if (!suggestions.length && ['text', 'number', 'boolean'].includes(filter.type) && filter.bindings.length) {
            try {
                const result = await this.request(`dashboards/${this.dashboard.id}/filters/${filter.key}/options`, 'POST', { parameters: this.filterValues, search: '', limit: 100 });
                suggestions = (result.values || []).filter(value => value != null && typeof value !== 'object').map(value => ({ key: String(value), label: String(value) }));
            } catch { /* Free input remains available when no saved binding can be queried. */ }
        }
        this.valueFilter = filter;
        return this.nativeForm('filter_value', filter.type === 'time_grain' ? { value: this.filterValues[filter.key] } : valueFormState(this.filterValues[filter.key], operator), { type: filter.type, suggestions, dashboard_id: this.dashboard.id, filter_key: filter.key, parameters: this.filterValues }, data => {
            const value = filter.type === 'time_grain' ? data.value || null : readValueState(data, filter.type, operator);
            this.setDashboardFilterValue(filter.key, value);
        }, { clear: () => this.setDashboardFilterValue(filter.key, null) });
    },
    editFilterValue(target) {
        const filter = this.dashboard.filters.find(row => row.key === target.dataset.key);
        if (filter) return this.openNativeFilterValue(filter);
    },
    stageDialog() {
        this.joinStage = false;
        const stage = this.stageDraft;
        const connection = this.library.connections.find(row => row.id === this.report.query_definition.connection_id);
        return this.nativeForm('stage', { ...stage, filters: stage.filters.map(filterFormState), limit: stage.limit_explicit ? stage.limit : null }, { fields: rows(this.stageAvailableFields()), tables: tables(connection?.catalog || []), output: stage.metrics.map(row => ({ key: row.key, label: row.label || row.key })) }, async data => {
            const definition = copy(this.report.query_definition); definition.stages ||= [];
            const updated = { ...stage, ...data, joins: Object.values(data.joins || []).map(row => ({ ...row, conditions: Object.values(row.conditions || []) })), expressions: Object.values(data.expressions || []), filters: Object.values(data.filters || []).map(row => filterRow(row, this.stageAvailableFields())), metrics: Object.values(data.metrics || []).map(row => ({ ...row, key: row.key || 'metric_' + uid().replaceAll('-', '').slice(0, 8), label: row.label || row.function })), dimensions: Object.values(data.dimensions || []), sort: Object.values(data.sort || []), limit: data.limit ? Number(data.limit) : null, limit_explicit: !!data.limit };
            if (updated.mode === 'aggregate') delete updated.columns;
            if (this.stageIndex < 0) definition.stages.push(updated); else definition.stages[this.stageIndex] = updated;
            const result = await this.request('reports/preview', 'POST', { query_definition: definition });
            this.adaptNotebookDisplay(this.report.query_definition, result.query_definition); this.report.query_definition = result.query_definition; this.queryUpdated();
        });
    },
    editNotebookLimit(target) {
        const stage = Number(target.dataset.stage || 0); const definition = this.notebookDefinition(stage);
        return this.nativeForm('limit', { limit: definition.limit_explicit ? definition.limit : null }, {}, async data => {
            const q = copy(definition); q.limit = data.limit ? Number(data.limit) : null; q.limit_explicit = q.limit !== null;
            this.notebookSections ||= new Set(); this.notebookSections.add(stage + ':limit');
            await this.commitNotebookDefinition(stage, q);
        });
    },
};
