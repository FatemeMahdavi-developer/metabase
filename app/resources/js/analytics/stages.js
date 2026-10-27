import { copy } from "./ui";

const legacyStageMethods = {

    addStage() { this.editStage({ dataset: { index: -1 } }); },
    async editStage(target) { this.stageIndex = Number(target.dataset.index); const q = copy(this.report.query_definition); q.stages = this.stageIndex < 0 ? q.stages || [] : q.stages.slice(0, this.stageIndex); if (q.stages.length >= 5) throw new Error('حداکثر پنج مرحلهٔ بعدی مجاز است.'); const result = await this.request('reports/preview', 'POST', { query_definition: q }); this.stageFields = result.columns; this.stageDraft = copy(this.report.query_definition.stages?.[this.stageIndex] || { mode: 'rows', metrics: [], dimensions: [], filters: [], sort: [], columns: result.columns.map(row => row.key), limit: null, limit_explicit: false }); this.stageDraft.joins ||= []; this.stageDraft.expressions ||= []; this.stageDialog(); },

removeStage(target) { this.report.query_definition.stages.splice(Number(target.dataset.index)); this.queryUpdated(); },
};
export const stageMethods = {
    ...legacyStageMethods,

};
