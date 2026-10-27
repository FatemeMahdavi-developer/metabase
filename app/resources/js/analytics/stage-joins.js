import { copy } from "./ui";
import { joinedMetadataField } from './metadata-labels';

export const stageAdditionalMethods = {
    stageAvailableFields(joins = this.stageDraft.joins || [], includeExpressions = true) {
        const fields = copy(this.stageFields);
        const connection = this.library.connections.find(row => row.id === this.report.query_definition.connection_id);
        for (const join of joins) {
            const table = connection.catalog.find(row => row.key === join.source);
            for (const column of table?.fields || []) fields.push(joinedMetadataField(column, table, join.alias + '.' + column.key));
        }
        if (includeExpressions) for (const expression of this.stageDraft.expressions || []) fields.push({ key: expression.key, label: expression.label, type: expression.type || 'number', computed: true });
        return fields;
    },

cancelStageJoin() { if (this.stageInline) { this.stageInline = false; this.closeModal(); } else this.stageDialog(); },
    async validateStageDraft(stage) {
        const query = copy(this.report.query_definition); query.stages ||= [];
        const index = this.stageIndex < 0 ? query.stages.length : this.stageIndex;
        query.stages[index] = stage;
        query.stages = query.stages.slice(0, index + 1);
        const result = await this.request('reports/preview', 'POST', { query_definition: query });
        return result.query_definition.stages[index];
    },
    async saveStageJoin() {
        const stage = copy(this.stageDraft);
        if (this.joinIndex < 0) stage.joins.push(copy(this.joinDraft)); else stage.joins[this.joinIndex] = copy(this.joinDraft);
        const available = this.stageAvailableFields(stage.joins);
        if (stage.mode === 'rows' && this.joinIndex < 0) stage.columns = [...new Set([...(stage.columns || []), ...available.filter(row => !row.hidden && row.key.startsWith(this.joinDraft.alias + '.')).map(row => row.key)])].slice(0, 50);
        this.pruneStageFields(stage, available);
        this.stageDraft = await this.validateStageDraft(stage); this.stageDraft.joins ||= []; this.stageDraft.expressions ||= [];
        if (this.stageInline) return this.commitNotebookDefinition(this.stageIndex + 1, this.stageDraft);
        this.stageDialog();
    },
    pruneStageFields(stage, fields) {
        const keys = fields.map(row => row.key);
        stage.columns = stage.columns?.filter(key => keys.includes(key));
        stage.filters = stage.filters.filter(row => keys.includes(row.field));
        stage.dimensions = stage.dimensions.filter(row => keys.includes(row.field));
        stage.metrics = stage.metrics.filter(row => row.function === 'count' || keys.includes(row.field));
        const outputs = stage.mode === 'rows' ? stage.columns || keys : [...stage.dimensions.map(row => row.field), ...stage.metrics.map(row => row.key)];
        stage.sort = stage.sort.filter(row => outputs.includes(row.key));
    },

};
