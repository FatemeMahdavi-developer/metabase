import { button, copy, icon } from "./ui";
import { isCurrentFilamentModal } from "./filament-modal";
import { persistedPresentationSettings } from './drill-presentation';

// HTTP installations on the local network may not expose navigator.clipboard.
function copySqlSelection(sql, modal, source) {
    const active = document.activeElement;
    const selection = window.getSelection();
    const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange()) : [];
    const scrollLeft = source.scrollLeft;
    const scrollTop = source.scrollTop;
    const field = document.createElement('textarea');
    field.value = sql;
    field.readOnly = true;
    field.tabIndex = -1;
    field.setAttribute('aria-hidden', 'true');
    field.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;';
    const onCopy = event => {
        if (!event.clipboardData) return;
        event.clipboardData.setData('text/plain', sql);
        event.preventDefault();
    };
    modal.append(field);
    field.addEventListener('copy', onCopy);
    try {
        field.focus({ preventScroll: true });
        field.select();
        return document.execCommand('copy');
    } finally {
        field.removeEventListener('copy', onCopy);
        field.remove();
        if (modal.hasAttribute('open') && source.isConnected) {
            const focus = active?.isConnected && !active.disabled && active !== document.body ? active : source;
            focus.focus({ preventScroll: true });
            selection?.removeAllRanges();
            for (const range of ranges) {
                if (range.commonAncestorContainer.isConnected) selection?.addRange(range);
            }
            source.scrollLeft = scrollLeft;
            source.scrollTop = scrollTop;
        }
    }
}

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
    async showSql() {
        const report = this.report;
        const epoch = this.navigationEpoch;
        if (!this.previewResult) {
            const result = await this.request('reports/preview', 'POST', { query_definition: copy(report.query_definition) });
            if (this.destroyed || this.report !== report || this.navigationEpoch !== epoch) return;
            this.previewResult = result;
        }
        this.modal('SQL تولیدشده', '<pre class="mb-sql mb-generated-sql" data-generated-sql dir="ltr" tabindex="0" aria-label="SQL تولیدشده"></pre>', button(icon('copy') + 'کپی SQL', 'copyGeneratedSql', 'primary'));
        // Assign as text after parsing to preserve the full SQL, including CRLF.
        this.root.querySelector('.mb-dialog[open] [data-generated-sql]').textContent = String(this.previewResult.sql ?? '');
    },
    async copyGeneratedSql(target) {
        const modal = target.closest('.mb-dialog[open]');
        const source = modal?.querySelector('[data-generated-sql]');
        if (!source) return;
        const sql = source.textContent;
        const generation = modal.dataset.analyticsModalGeneration;
        const isCurrent = () => isCurrentFilamentModal(modal, generation) && source.isConnected;
        let copied = false;
        try {
            if (typeof navigator.clipboard?.writeText === 'function') {
                try {
                    await navigator.clipboard.writeText(sql);
                    copied = true;
                } catch {
                    // Browsers may deny clipboard access even in a secure context.
                }
            }
            if (!isCurrent()) return;
            if (!copied) copied = copySqlSelection(sql, modal, source);
        } catch {
            copied = false;
        }
        if (isCurrent()) this.toast(copied ? 'SQL کپی شد.' : 'کپی انجام نشد. متن SQL را انتخاب و کپی کنید.', !copied);
    },
    exportReport() { if (!this.previewResult) throw new Error('ابتدا پرس‌وجو را اجرا کنید.'); this.exportResult(this.previewResult, this.report.name); },

    async saveReport() { const form = this.form(); const add = form.has('add_to_dashboard'); const renderedSettings = this.root.querySelector('.mb-preview-body')?._analyticsVisualization?.settings; const renderedColors = renderedSettings?._series_colors; const payload = { ...this.report, visualization_settings: persistedPresentationSettings({ ...this.report.visualization_settings, ...(renderedColors ? { _series_colors: renderedColors, _series_color_indexes: renderedSettings._series_color_indexes } : {}) }), name: form.get('name'), description: form.get('description'), folder_id: form.get('folder_id') ? Number(form.get('folder_id')) : null }; this.report = await this.request(this.report.id ? `reports/${this.report.id}` : 'reports', this.report.id ? 'PUT' : 'POST', payload); this.reportOriginal = copy(this.report); this.dirty = false; await this.refreshLibrary(); this.closeModal(); this.render(); if (add) this.reportDashboardPicker(); else this.toast('پرسش ذخیره شد.'); },

    async reportToDashboard(target) { const id = this.pendingReportId; this.pendingReportId = null; this.closeModal(); if (!await this.openDashboard(target)) return; this.editDashboard(); this.addWidget({ type: 'report', report_id: id, settings: {}, click_behavior: { type: 'details' } }); },
    cancelReport() { if (!this.dirty) return this.navigate({ dataset: { view: 'reports' } }); this.confirm('لغو تغییرات', 'تغییرات این گزارش کنار گذاشته می‌شود.', () => { this.dirty = false; this.navigate({ dataset: { view: 'reports' } }); }); },
    reportVisualization() { this.vizTarget = 'report'; this.visualizationDialog(this.report.visualization_settings, this.report.display, this.previewResult?.columns || this.outputColumns()); },
};
