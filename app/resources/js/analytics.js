import { e, icon, visualize } from "./analytics/ui";
import { dashboardMethods } from './analytics/dashboards';
import { reportMethods } from './analytics/reports';
import { connectionMethods } from './analytics/connections';
import { notebookMethods } from './analytics/notebook';
import { visualizationMethods } from './analytics/visualizations';
import { filterMethods } from './analytics/filters';
import { stageMethods } from './analytics/stages';
import { stageAdditionalMethods } from './analytics/stage-joins';
import { notebookFlowMethods } from './analytics/notebook-flow';
import { expressionEditorMethods } from './analytics/expression-editor';
import { sqlEditorMethods } from './analytics/sql-editor';
import { clickBehaviorMethods } from './analytics/click-behavior';
import { interactionMethods } from './analytics/interactions';
import { themeMethods } from './analytics/theme';
import { normalizeMetadataSearch } from './analytics/metadata-labels';
import { sanitizeSeriesColors } from './analytics/chart-style';
import { nativeNavigationMethods } from './analytics/native-navigation';
import { nativeFormMethods } from './analytics/native-forms';
import { openFilamentModal, closeFilamentModal } from './analytics/filament-modal';
import '../css/analytics.css';
import '../css/analytics-theme.css';
import '../css/analytics-filament.css';

class AnalyticsStudio {
    constructor(root) {
        this.root = root; this.api = root.dataset.api; this.token = root.dataset.csrf; this.view = 'dashboards';
        this.folder = null; this.charts = []; this.library = { connections: [], reports: [], dashboards: [], folders: [] };
        this.editing = false; this.dirty = false; this.results = new Map(); this.cardCache = new Map(); this.cardPromises = new Map(); this.epoch = 0; this.navigationEpoch = 0;
        this.visualizationColors = new Map();
        this.initializeNativeNavigation();
        this.initializeNativeForms();
        this.root.addEventListener('analytics:themechange', () => this.refreshVisualizationTheme());
        root.addEventListener('click', event => { const target = event.target.closest('[data-action]'); if (target && root.contains(target)) { event.preventDefault(); this.dispatch(target.dataset.action, target); } });
        root.addEventListener('change', event => this.change(event.target));
        root.addEventListener('input', event => { const target = event.target; if (target.dataset.expressionEditor !== undefined || target.dataset.expressionName !== undefined || target.dataset.expressionSearch !== undefined || target.dataset.expressionBrowserSearch !== undefined) this.expressionEditorInput(target); if (target.closest('[data-connection-form]')) this.markDirty(); if (target.dataset.schemaSearch !== undefined) this.root.querySelectorAll('.mb-schema-tables [data-key]').forEach(row => { row.hidden = !(row.dataset.searchText || normalizeMetadataSearch(row.textContent)).includes(normalizeMetadataSearch(target.value)); }); if (target.dataset.pickerSearch !== undefined) this.root.querySelectorAll('.mb-dialog .mb-card-picker').forEach(row => { row.hidden = !(row.dataset.searchText || normalizeMetadataSearch(row.textContent)).includes(normalizeMetadataSearch(target.value)); }); if (target.dataset.reportInput) { this.report[target.dataset.reportInput] = target.value; this.markDirty(); } if (target.dataset.sql !== undefined) { this.report.query_definition.sql = target.value; this.markDirty(); this.updateSqlHighlight(); } });
        root.addEventListener('keydown', event => { if (event.target.matches('[data-expression-editor]') || event.target.closest('[data-expression-workbench]')) this.expressionEditorKeydown(event); if (event.target.dataset.rowLimit !== undefined && event.key === 'Enter') { event.preventDefault(); event.target.blur(); } });
        root.addEventListener('focusout', event => { if (event.target.dataset.rowLimit !== undefined) this.dispatch('saveNotebookLimit', event.target); });
        root.addEventListener('dragstart', event => { const clause = event.target.closest('.mb-notebook-clause'); if (clause) { event.dataTransfer.setData('application/json', JSON.stringify({ stage: Number(clause.dataset.stage), list: clause.dataset.list, index: Number(clause.dataset.index) })); event.dataTransfer.effectAllowed = 'move'; } });
        root.addEventListener('dragover', event => { if (event.target.closest('.mb-notebook-clause')) event.preventDefault(); });
        root.addEventListener('drop', event => { const clause = event.target.closest('.mb-notebook-clause'); if (!clause) return; event.preventDefault(); try { const source = JSON.parse(event.dataTransfer.getData('application/json')); this.reorderNotebookClause(source, { stage: Number(clause.dataset.stage), list: clause.dataset.list, index: Number(clause.dataset.index) }).catch(error => this.toast(error.message, true)); } catch {} });
        this.beforeUnload = event => { if (this.dirty) { event.preventDefault(); event.returnValue = ''; } };
        window.addEventListener('beforeunload', this.beforeUnload);
        this.resizeHandler = () => { if (this.view === 'dashboard' && (window.innerWidth < 768) !== this.mobile) this.render(); };
        window.addEventListener('resize', this.resizeHandler);
        root.addEventListener('analytics-modal-closed', event => { if (event.detail.reason === 'dismiss') this.modalWasClosed(event.detail.modal); });
        this.initializeInteractions();
        this.initializeTheme();
        this.load().catch(error => this.showInitializationError(error));
    }
    showInitializationError(error) {
        console.error('Analytics initialization failed.', error);
        const content = this.root.querySelector('[data-analytics-content]');
        if (content) {
            const alert = document.createElement('div');
            alert.className = 'mb-empty mb-load-error';
            alert.setAttribute('role', 'alert');
            alert.textContent = `بارگذاری فضای تحلیل انجام نشد: ${error?.message || 'خطای ناشناخته'}`;
            content.replaceChildren(alert);
        }
        this.toast(error?.message || 'بارگذاری فضای تحلیل انجام نشد.', true);
    }
    async request(path, method = 'GET', data) {
        const response = await fetch(this.api + '/' + path, { method, credentials: 'same-origin', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-TOKEN': this.token }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
        const result = await response.json().catch(() => ({ message: 'پاسخ سرور معتبر نیست.' }));
        if (!response.ok) { if ([401, 419].includes(response.status)) throw new Error('نشست شما تمام شده است؛ دوباره وارد شوید.'); throw new Error(result.errors ? Object.values(result.errors).flat().join(' • ') : result.message || 'عملیات ناموفق بود.'); }
        return result;
    }
    async dispatch(action, target) {
        if (typeof this[action] !== 'function') return;
        target.disabled = true;
        try { while (this.notebookPendingValidation) await this.notebookPendingValidation; await this[action](target); }
        catch (error) { const box = this.root.querySelector('.mb-dialog[open] .mb-dialog-error') || this.root.querySelector('[data-connection-form] .mb-dialog-error'); if (box) { box.textContent = error.message; box.setAttribute('role', 'alert'); } else this.toast(error.message, true); }
        finally { target.disabled = false; if (this.expressionEditorTextarea()) this.updateExpressionSaveState(); }
    }
    async load() { const [library] = await Promise.all([this.request('library'), this.waitForAnalyticsFonts()]); if (this.destroyed || !this.root.isConnected) return; this.library = library; await this.loadNativeView(); }
    async refreshLibrary() { this.library = await this.request('library'); }
    cleanup() { this.closeDrillMenu(); this.charts.forEach(chart => chart?.destroy()); this.charts = []; this.grid?.destroy(false); this.grid = null; clearInterval(this.refreshTimer); this.epoch++; }
    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.navigationEpoch++;
        this.cleanup();
        this.destroyAnalyticsTheme();
        window.removeEventListener('beforeunload', this.beforeUnload);
        window.removeEventListener('resize', this.resizeHandler);
        window.removeEventListener('popstate', this.nativePopstate);
        document.removeEventListener('pointerdown', this.drillOutsideHandler);
        document.removeEventListener('keydown', this.drillKeydownHandler);
        clearTimeout(this.filterSearchTimer);
        clearTimeout(this.expressionValidationTimer);
        this.closeNativeForm();
        window.removeEventListener('analytics-form-submitted', this.nativeFormListener);
        window.removeEventListener('modal-closed', this.nativeDismissListener, true);
        closeFilamentModal(this.root);
    }
    render() {
        if (this.destroyed || !this.root.isConnected) return;
        this.closeModal();
        this.cleanup();
        this.mobile = window.innerWidth < 768;
        const content = this.root.querySelector('[data-analytics-content]');
        const list = this.view === 'dashboard' ? 'dashboards' : this.view === 'browser' ? 'connections' : 'reports';
        const workbenchTools = this.dashboardReadOnly ? '' : `<div class="mb-workbench-tools">${this.view === 'report' ? '' : `<a class="mb-btn" href="${e(this.nativeRoutes[list])}">${icon('back')} بازگشت به فهرست</a>`}</div>`;
        content.innerHTML = `${workbenchTools}<div class="mb-shell ${this.fullscreen ? 'mb-fullscreen' : ''}"><main class="mb-main">${this.view === 'dashboard' ? this.dashboardHtml() : this.view === 'report' ? this.reportHtml() : this.view === 'browser' ? this.browserHtml() : this.nativeReportStartHtml()}</main></div>`;
        this.syncWorkbenchUrl();
        if (this.view === 'dashboard') this.mountDashboard();
        if (this.view === 'report' && this.previewResult) this.renderPreview();
        if (this.view === 'report' && this.report.query_definition.mode === 'native') this.mountSqlEditor();
        if (this.view === 'browser') this.loadTablePreview();
        if (this.view === 'connection') this.connectionDriverChanged(this.root.querySelector('[data-driver]'));
    }
    change(target) {
        if (target.matches('[data-series-color], [data-base-chart-color]')) target.dataset.colorChanged = 'true';
        if (target.dataset.notebookFilterField !== undefined || target.dataset.notebookFilterOperator !== undefined) this.notebookFilterChanged(target);
        if (target.dataset.notebookDimensionField !== undefined) this.notebookDimensionChanged(target);
        if (target.dataset.clickType !== undefined) this.cardClickTypeChanged(target);
        if (target.dataset.dashboardOperator !== undefined) this.dashboardFilterDefaultInputs();
        if (target.dataset.stageChange !== undefined) this.stageFormChanged();
        if (target.dataset.cardFilterBinding !== undefined) this.cardFilterBindingChanged(target);
        if (target.dataset.vizDisplay !== undefined) this.visualizationDisplayChanged();
        if (target.dataset.queryFilterField !== undefined || target.dataset.queryFilterOperator !== undefined) this.reportFilterChanged(target);
        if (target.dataset.dimensionField !== undefined) this.dimensionFieldChanged(target);
        if (target.dataset.joinSource !== undefined) this.joinSourceChanged(target);
        if (target.dataset.filterValue !== undefined) this.filterValueChanged(target);
        if (target.dataset.driver !== undefined) { this.markDirty(); this.connectionDriverChanged(target); }
        if (target.dataset.bindingType !== undefined) this.filterTypeChanged(target);
        if (target.dataset.reportInput) { this.report[target.dataset.reportInput] = target.value; this.markDirty(); }
    }
    markDirty() { this.dirty = true; const label = this.root.querySelector('.mb-dirty'); if (label) label.textContent = 'تغییرات ذخیره نشده'; }
    toast(message, error = false) {
        this.root.querySelector('.mb-toast')?.remove(); const toast = document.createElement('div'); toast.className = 'mb-toast' + (error ? ' error' : ''); toast.setAttribute('role', error ? 'alert' : 'status'); toast.textContent = message; this.root.append(toast); setTimeout(() => toast.remove(), error ? 9000 : 4000);
    }
    modal(title, body, footer = '', wide = false, side = false, modeless = false) {
        this.closeModal();
        const dialog = openFilamentModal(this.root, { title, body, footer, wide, side, modeless });
        if (dialog.querySelector('[data-click-type]')) this.cardClickTypeChanged(dialog.querySelector('[data-click-type]'));
    }
    modalWasClosed(dialog) {
        this.closeDrillMenu();
        if (dialog.dataset.objectDetail !== undefined) this.objectDetailClosed();
        if (dialog.querySelector('[data-expression-workbench]')) { clearTimeout(this.expressionValidationTimer); this.expressionValidationRevision = (this.expressionValidationRevision || 0) + 1; }
    }
    closeModal() {
        this.closeNativeForm();
        const dialog = this.root.querySelector('.mb-dialog[open]');
        if (!dialog) return;
        this.modalWasClosed(dialog);
        closeFilamentModal(this.root);
    }
    form() { if (!this.submittedFormData) throw new Error('??? ?? ?? ???? Filament ????? ????.'); return this.submittedFormData; }

    async confirmAction() { this.closeModal(); await this.confirmCallback?.(); }

    async saveFolder() { const form = this.form(); await this.request('folders', 'POST', { name: form.get('name') }); this.closeModal(); await this.refreshLibrary(); this.render(); }
    deleteItem(target) { const { id, kind } = target.dataset; this.confirm('حذف مورد', 'این مورد حذف می‌شود. مواردی که در گزارش یا داشبورد استفاده شده‌اند قابل حذف نیستند.', async () => { await this.request(`${kind}/${id}`, 'DELETE'); await this.refreshLibrary(); this.render(); this.toast('حذف شد.'); }); }
    exportResult(result, name = 'report') {
        const cell = value => { let text = String(value ?? ''); if (typeof value === 'string' && /^[=+\-@]/.test(text)) text = "'" + text; return '"' + text.replaceAll('"', '""') + '"'; };
        const rows = [result.columns.map(column => cell(column.label)).join(','), ...result.rows.map(row => result.columns.map(column => cell(row[column.key])).join(','))];
        const url = URL.createObjectURL(new Blob(['\uFEFF' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8;' })); const link = document.createElement('a'); link.href = url; link.download = name + '.csv'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); if (result.meta?.truncated) this.toast(`فایل شامل ${result.meta.limit} ردیف نمایش‌داده‌شده است.`);
    }
    draw(container, result, display, settings = {}, callback) {
        if (!container) return;
        const widget = container.closest('[data-widget]')?.dataset.widget;
        const origin = this.drillSession?.origin;
        const scope = widget ? ['widget', this.dashboard?.id, widget] : origin?.kind === 'widget' ? ['widget', origin.dashboard_id, origin.widget_key] : ['report', this.report?.id || origin?.definition?.connection_id || this.report?.query_definition?.connection_id, this.report?.id || origin?.name || this.report?.name, this.report?.query_definition?.source];
        const signature = JSON.stringify([scope, display, settings.color, settings.color_custom, settings.series_colors]);
        const cachedColors = this.visualizationColors.get(signature);
        const inheritedColors = sanitizeSeriesColors(settings._series_colors);
        const indexes = { ...cachedColors?.indexes, ...settings._series_color_indexes };
        for (const key of Object.keys(inheritedColors)) if (!Number.isInteger(settings._series_color_indexes?.[key])) delete indexes[key];
        const runtime = { ...settings, _series_colors: { ...cachedColors?.colors, ...inheritedColors }, _series_color_indexes: indexes };
        const chart = visualize(container, result, display, runtime, callback);
        this.visualizationColors.set(signature, { colors: runtime._series_colors || {}, indexes: runtime._series_color_indexes || {} });
        if (this.visualizationColors.size > 256) this.visualizationColors.delete(this.visualizationColors.keys().next().value);
        if (chart) this.charts.push(chart);
    }
    refreshVisualizationTheme() {
        this.charts.forEach(chart => chart?.$analyticsTheme?.());
    }
}
Object.assign(AnalyticsStudio.prototype, dashboardMethods, reportMethods, connectionMethods, notebookMethods, visualizationMethods, filterMethods, stageMethods, stageAdditionalMethods, sqlEditorMethods, notebookFlowMethods, expressionEditorMethods, clickBehaviorMethods, interactionMethods, themeMethods, nativeNavigationMethods, nativeFormMethods);
function initialize() {
    const root = document.getElementById('analytics-studio');
    if (!root) return;
    if (window.analyticsStudio?.root === root && !window.analyticsStudio.destroyed) return;
    window.analyticsStudio?.destroy?.();
    root.dataset.mounted = 'true';
    try {
        window.analyticsStudio = new AnalyticsStudio(root);
    } catch (error) {
        console.error('Analytics startup failed.', error);
        const content = root.querySelector('[data-analytics-content]');
        if (content) {
            const alert = document.createElement('div');
            alert.className = 'mb-empty mb-load-error';
            alert.setAttribute('role', 'alert');
            alert.textContent = `راه‌اندازی فضای تحلیل انجام نشد: ${error?.message || 'خطای ناشناخته'}`;
            content.replaceChildren(alert);
        }
    }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize); else initialize();
document.addEventListener('livewire:navigated', initialize);
document.addEventListener('livewire:navigating', () => window.analyticsStudio?.destroy?.());
