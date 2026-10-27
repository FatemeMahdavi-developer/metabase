import { e, copy, uid, iconButton } from "./ui";
import { readQueryFilter } from "./notebook-flow";
import { joinedMetadataField } from "./metadata-labels";

const functions = { count: 'تعداد ردیف‌ها', sum: 'مجموع', avg: 'میانگین', min: 'کمینه', max: 'بیشینه', count_distinct: 'تعداد مقادیر یکتا' };

export const notebookMethods = {
    newReport() { this.sourcePicker('new'); },
    newNativeReport() { this.sourcePicker('native'); },
    sourcePicker(purpose = 'source') {
        this.sourcePurpose = purpose; this.sourceConnection = this.report?.query_definition.connection_id || this.library.connections.find(row => row.catalog?.length)?.id;
        if (!this.library.connections.some(row => row.catalog?.length)) throw new Error('ابتدا یک دیتابیس را متصل و همگام کنید.');
        this.sourcePickerDialog();
    },

    pickSourceConnection(target) { this.sourceConnection = Number(target.dataset.id); this.sourcePickerDialog(); },
    pickSourceTable(target) {
        const source = target.dataset.key; const id = this.sourceConnection; this.closeModal();
        if (['new', 'native'].includes(this.sourcePurpose)) { this.createReport(id, source); this.notebookOpen = true; if (this.sourcePurpose === 'native') { this.report.query_definition.mode = 'native'; const quote = part => '"' + part.replaceAll('"', '""') + '"'; this.report.query_definition.sql = 'SELECT * FROM ' + source.split('.').map(quote).join('.'); this.report.query_definition.parameters = []; } }
        else if (this.sourcePurpose === 'native-source') { this.report.query_definition.connection_id = id; this.report.query_definition.source = source; this.previewResult = null; this.markDirty(); }
        else { Object.assign(this.report.query_definition, { connection_id: id, source, joins: [], filters: [], metrics: [], dimensions: [], sort: [], expressions: [], stages: [], limit: null, limit_explicit: false, mode: 'rows' }); this.notebookSections = new Set(); this.stepPreviewResults = {}; delete this.report.query_definition.columns; this.previewResult = null; this.markDirty(); }
        this.render();
    },
    reportFields(definition = this.report.query_definition) {
        const connection = this.library.connections.find(row => row.id === definition.connection_id);
        if (!connection) return this.dashboard?.reports?.find(row => JSON.stringify(row.query_definition) === JSON.stringify(definition))?.available_fields || [];
        const table = connection.catalog?.find(row => row.key === definition.source); const fields = [...(table?.fields || [])];
        for (const join of definition.joins || []) { const relation = fields.find(column => column.key === join.field)?.relation; const target = connection.catalog?.find(row => row.key === (join.source || relation?.table)); const prefix = join.alias || join.field; if (target) fields.push(...target.fields.map(column => joinedMetadataField(column, target, `${prefix}.${column.key}`))); }
        fields.push(...(definition.expressions || []).map(row => ({ key: row.key, label: row.label, type: row.type || (/^(upper|lower|concat)\(/i.test(row.expression.trim()) ? 'text' : 'number'), computed: true })));
        return fields;
    },
    queryChip(label, action, list, index, color = '') { return `<span class="mb-notebook-chip ${color}"><button data-action="${action}" data-index="${index}">${label}</button>${iconButton('close', 'حذف', 'removeQueryItem', `data-list="${list}" data-index="${index}"`)}</span>`; },
    changeSource() { this.sourcePicker(this.report.query_definition.mode === 'native' ? 'native-source' : 'source'); },
    toggleNotebook() { this.notebookOpen = this.notebookOpen === false; this.render(); },
    async runReport() { if (this.notebookPendingValidation) await this.notebookPendingValidation; const epoch = this.epoch; const box = this.root.querySelector('.mb-preview-body'); box.innerHTML = '<div class="mb-loading">در حال اجرای پرس‌وجو…</div>'; try { const result = await this.request('reports/preview', 'POST', { query_definition: copy(this.report.query_definition) }); if (epoch !== this.epoch) return; this.rebaseEditedDrill(result); this.previewResult = result; this.report.query_definition = result.query_definition; if (this.report.query_definition.mode !== 'native') this.notebookOpen = false; this.render(); } catch (error) { if (epoch === this.epoch) box.innerHTML = `<div class="mb-error" role="alert">${e(error.message)}</div>`; } },

    async saveColumns() { const columns = this.form().getAll('columns'); if (!columns.length || columns.length > 50) throw new Error('بین ۱ تا ۵۰ ستون انتخاب کنید.'); const q = copy(this.report.query_definition); q.columns = columns; await this.commitNotebookDefinition(0, q); },
    addReportFilter() { this.editReportFilter({ dataset: { index: -1 } }); },
    editReportFilter(target) { this.queryItemIndex = Number(target.dataset.index); this.queryFilterDraft = copy(this.report.query_definition.filters[this.queryItemIndex] || { field: this.reportFields()[0]?.key, operator: 'eq', value: '' }); this.reportFilterDialog(); },

async saveReportFilter() { const form = this.form(); const column = this.reportFields().find(column => column.key === form.get('field')); const row = readQueryFilter(form, column); const q = copy(this.report.query_definition); if (this.queryItemIndex < 0) q.filters.push(row); else q.filters[this.queryItemIndex] = row; await this.commitNotebookDefinition(0, q); },
    addMetric() { this.editMetric({ dataset: { index: -1 } }); },
    editMetric(target) { this.queryItemIndex = Number(target.dataset.index); this.metricDraft = copy(this.report.query_definition.metrics[this.queryItemIndex] || { key: 'metric_' + uid().replaceAll('-', '').slice(0, 8), function: 'count', label: '' }); this.metricDialog(); },

async saveMetric() { const form = this.form(); const row = { ...this.metricDraft, label: form.get('label') || functions[this.metricDraft.function] }; if (row.function !== 'count') { row.field = form.get('field'); if (!row.field) throw new Error('ستون سازگار انتخاب کنید.'); } else delete row.field; const q = copy(this.report.query_definition); if (this.queryItemIndex < 0) { if (q.metrics.length >= 10) throw new Error('حداکثر ۱۰ محاسبه مجاز است.'); q.metrics.push(row); } else q.metrics[this.queryItemIndex] = row; q.mode = 'aggregate'; await this.commitNotebookDefinition(0, q); },
    addDimension() { this.editDimension({ dataset: { index: -1 } }); },

async saveDimension() { const form = this.form(); const row = { field: form.get('field'), grain: form.get('grain') || null }; const q = copy(this.report.query_definition); if (!row.field || q.dimensions.some((item, index) => item.field === row.field && index !== this.queryItemIndex)) throw new Error('یک ستون جدید انتخاب کنید.'); if (this.queryItemIndex < 0) { if (q.dimensions.length >= 6) throw new Error('حداکثر ۶ گروه‌بندی مجاز است.'); q.dimensions.push(row); } else q.dimensions[this.queryItemIndex] = row; if (q.mode !== 'aggregate') { q.mode = 'aggregate'; q.metrics = [{ key: 'count', function: 'count', label: 'تعداد' }]; } await this.commitNotebookDefinition(0, q); },
    removeQueryItem(target) { const q = this.report.query_definition; q[target.dataset.list].splice(Number(target.dataset.index), 1); if (target.dataset.list === 'metrics' && !q.metrics.length) q.mode = 'rows'; if (target.dataset.list === 'joins' || target.dataset.list === 'expressions') { const keys = this.reportFields().map(row => row.key); q.columns = q.columns?.filter(key => keys.includes(key)); if (!q.columns?.length) delete q.columns; q.filters = q.filters.filter(row => keys.includes(row.field)); q.dimensions = q.dimensions.filter(row => keys.includes(row.field)); q.metrics = q.metrics.filter(row => row.function === 'count' || keys.includes(row.field)); if (!q.metrics.length) q.mode = 'rows'; q.sort = []; } this.queryUpdated(); },
    joinIcon(type) { return `<svg class="mb-venn" viewBox="0 0 44 28" aria-hidden="true"><defs><clipPath id="venn-${type}"><circle cx="27" cy="14" r="11"/></clipPath></defs><circle cx="16" cy="14" r="11" fill="${['left', 'full'].includes(type) ? 'currentColor' : 'white'}" stroke="currentColor"/><circle cx="27" cy="14" r="11" fill="${['right', 'full'].includes(type) ? 'currentColor' : 'white'}" stroke="currentColor"/>${['inner', 'left'].includes(type) ? `<circle cx="16" cy="14" r="11" fill="currentColor" clip-path="url(#venn-${type})"/>` : ''}</svg>`; },
    addJoin() { this.joinStage = false; if (this.report.query_definition.joins.length >= 5) throw new Error('حداکثر پنج اتصال مجاز است.'); this.joinIndex = -1; const q = this.report.query_definition; const connection = this.library.connections.find(row => row.id === q.connection_id); const fields = this.reportFields().filter(row => !row.computed); const relationField = fields.find(row => row.relation && !row.relation.composite); const table = connection.catalog.find(row => row.key === relationField?.relation.table) || connection.catalog.find(row => row.key !== q.source) || connection.catalog[0]; this.joinDraft = { source: table.key, alias: 'join_' + uid().replaceAll('-', '').slice(0, 8), type: 'left', conditions: [{ left: relationField?.key || fields[0].key, right: relationField?.relation.field || table.fields[0].key, operator: 'eq' }] }; this.joinDialog(); },
    editJoin(target) { this.joinStage = false; this.joinIndex = Number(target.dataset.index); const join = copy(this.report.query_definition.joins[this.joinIndex]); if (join.field) { const fields = this.reportFields(); const relation = fields.find(row => row.key === join.field).relation; this.joinDraft = { source: relation.table, alias: 'join_' + uid().replaceAll('-', '').slice(0, 8), type: join.type || 'left', conditions: [{ left: join.field, right: relation.field, operator: 'eq' }], legacyPrefix: join.field }; } else this.joinDraft = join; this.joinDialog(); },
    joinLeftFields() { if (this.joinStage) return this.stageAvailableFields(this.joinIndex < 0 ? this.stageDraft.joins : this.stageDraft.joins.slice(0, this.joinIndex), false); const q = copy(this.report.query_definition); q.joins = this.joinIndex < 0 ? q.joins : q.joins.slice(0, this.joinIndex); q.expressions = []; return this.reportFields(q); },

    readJoinForm() { const form = this.form(); this.joinDraft.conditions.forEach((row, index) => Object.assign(row, { left: form.get(`left_${index}`), right: form.get(`right_${index}`), operator: form.get(`operator_${index}`) })); },

async saveJoin() { this.readJoinForm(); if (this.joinStage) return this.saveStageJoin(); const q = copy(this.report.query_definition); const join = copy(this.joinDraft); const legacy = join.legacyPrefix; delete join.legacyPrefix; if (this.joinIndex < 0) q.joins.push(join); else { q.joins[this.joinIndex] = join; if (legacy) { const remap = key => typeof key === 'string' && key.startsWith(legacy + '.') ? join.alias + key.slice(legacy.length) : key; q.columns = q.columns?.map(remap); ['metrics', 'dimensions', 'filters'].forEach(list => q[list].forEach(row => { if (row.field) row.field = remap(row.field); })); q.sort.forEach(row => { row.key = remap(row.key); }); q.joins.slice(this.joinIndex + 1).forEach(row => { if (row.field) row.field = remap(row.field); row.conditions?.forEach(condition => { condition.left = remap(condition.left); }); }); q.expressions?.forEach(row => { row.expression = row.expression.replaceAll('[' + legacy + '.', '[' + join.alias + '.'); }); } } await this.commitNotebookDefinition(0, q); },

    toggleSqlSchema() { this.sqlSchemaOpen = !this.sqlSchemaOpen; this.render(); },

pickDisplay(target) { this.report.display = target.dataset.display; this.markDirty(); this.closeModal(); this.render(); },
};
