import { e, copy } from "./ui";
import { persistedPresentationSettings } from './drill-presentation';

export const reportMethods = {
    createReport(connectionId, source) {
        this.navigationEpoch++;
        this.drillSession = null;
        this.report = { name: 'گزارش جدید', description: '', folder_id: this.folder, display: 'table', visualization_settings: {}, query_definition: { connection_id: connectionId, source, mode: 'rows', metrics: [], dimensions: [], filters: [], sort: [], joins: [], expressions: [], limit: null, limit_explicit: false } };
        this.notebookSections = new Set(); this.stepPreviewResults = {}; this.notebookEditingStage = 0;
        this.reportOriginal = copy(this.report); this.previewResult = null; this.notebookOpen = true; this.view = 'report'; this.dirty = true; this.render();
    },
    openReport(target) { this.navigationEpoch++; this.drillSession = null; this.notebookSections = new Set(); this.stepPreviewResults = {}; this.notebookEditingStage = 0; this.report = copy(this.library.reports.find(report => report.id === Number(target.dataset.id))); this.reportOriginal = copy(this.report); this.previewResult = null; this.view = 'report'; this.dirty = false; this.notebookOpen = false; this.render(); this.runReport(); },
    copyReport(target) { this.openReport(target); delete this.report.id; delete this.report.version; this.report.name += ' — کپی'; this.dirty = true; this.notebookOpen = true; this.render(); },
    renderPreview() { this.charts.forEach(chart => chart.destroy()); this.charts = []; this.draw(this.root.querySelector('.mb-preview-body'), this.previewResult, this.report.display, this.report.visualization_settings); this.root.querySelector('.mb-result-meta').textContent = `${this.previewResult.rows.length} ردیف • ${this.previewResult.meta.duration_ms} ms${this.previewResult.meta.truncated ? ' • نتیجه محدود شده' : ''}`; },
    async showSql() { if (!this.previewResult) { const result = await this.request('reports/preview', 'POST', { query_definition: copy(this.report.query_definition) }); this.previewResult = result; } this.modal('SQL تولیدشده', `<pre class="mb-sql">${e(this.previewResult.sql)}</pre>`); },
    exportReport() { if (!this.previewResult) throw new Error('ابتدا پرس‌وجو را اجرا کنید.'); this.exportResult(this.previewResult, this.report.name); },

    async saveReport() { const form = this.form(); const add = form.has('add_to_dashboard'); const renderedColors = this.root.querySelector('.mb-preview-body')?._analyticsVisualization?.settings?._series_colors; const payload = { ...this.report, visualization_settings: persistedPresentationSettings({ ...this.report.visualization_settings, ...(renderedColors ? { _series_colors: renderedColors } : {}) }), name: form.get('name'), description: form.get('description'), folder_id: form.get('folder_id') ? Number(form.get('folder_id')) : null }; this.report = await this.request(this.report.id ? `reports/${this.report.id}` : 'reports', this.report.id ? 'PUT' : 'POST', payload); this.reportOriginal = copy(this.report); this.dirty = false; await this.refreshLibrary(); this.closeModal(); this.render(); if (add) this.reportDashboardPicker(); else this.toast('پرسش ذخیره شد.'); },

    async reportToDashboard(target) { const id = this.pendingReportId; this.pendingReportId = null; this.closeModal(); if (!await this.openDashboard(target)) return; this.editDashboard(); this.addWidget({ type: 'report', report_id: id, settings: {}, click_behavior: { type: 'details' } }); },
    cancelReport() { if (!this.dirty) return this.navigate({ dataset: { view: 'reports' } }); this.confirm('لغو تغییرات', 'تغییرات این گزارش کنار گذاشته می‌شود.', () => { this.dirty = false; this.navigate({ dataset: { view: 'reports' } }); }); },
    reportVisualization() { this.vizTarget = 'report'; this.visualizationDialog(this.report.visualization_settings, this.report.display, this.previewResult?.columns || this.outputColumns()); },
};
