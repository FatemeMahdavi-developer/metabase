import { copy } from "./ui";

export const visualizationMethods = {
    visualizationDialog(settings, display, columns) { this.vizDraft = copy(settings); this.vizDisplay = display; this.vizColumns = columns; this.vizResult = this.vizTarget === 'report' ? this.previewResult : this.results.get(this.vizTarget); const rendered = this.vizTarget === 'report' ? this.root.querySelector('.mb-preview-body') : this.root.querySelector('[data-widget="' + CSS.escape(this.vizTarget) + '"] .mb-card-body'); if (rendered?._analyticsVisualization?.settings?._series_colors) this.vizDraft._series_colors = { ...rendered._analyticsVisualization.settings._series_colors }; this.vizTab = 'data'; this.visualizationPanel(); },

};
