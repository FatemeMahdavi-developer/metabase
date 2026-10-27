import { e, copy, uid, icon, button, iconButton, entries, operators, grains, tableHtml } from "./ui";
import { joinedMetadataField } from './metadata-labels';

const metrics = { count: 'تعداد ردیف‌ها', sum: 'مجموع', avg: 'میانگین', min: 'کمینه', max: 'بیشینه', count_distinct: 'تعداد مقادیر یکتا' };
const titles = { data: 'داده‌ها', join: 'اتصال داده‌ها', expression: 'ستون سفارشی', filter: 'فیلتر', summarize: 'خلاصه‌سازی', sort: 'مرتب‌سازی', limit: 'محدودیت ردیف‌ها' };
const symbols = { join: 'join', expression: 'text', filter: 'filter', summarize: 'number', sort: 'sort', limit: 'table' };

const emptyFilterOperators = ['is_null', 'not_null', 'is_empty', 'not_empty'];
const partialTextOperators = ['contains', 'not_contains', 'starts_with', 'ends_with'];
const dateParts = {
    day_of_week: { label: 'روزهای هفته', values: ['دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه', 'یکشنبه'].map((label, index) => ({ key: index + 1, label })) },
    month: { label: 'ماه‌های سال', values: ['ژانویه', 'فوریه', 'مارس', 'آوریل', 'مه', 'ژوئن', 'ژوئیه', 'اوت', 'سپتامبر', 'اکتبر', 'نوامبر', 'دسامبر'].map((label, index) => ({ key: index + 1, label })) },
    quarter: { label: 'فصل‌های سال', values: [1, 2, 3, 4].map(key => ({ key, label: 'سه‌ماههٔ ' + key })) },
    hour: { label: 'ساعت‌های روز', values: Array.from({ length: 24 }, (_, key) => ({ key, label: String(key).padStart(2, '0') + ':00' })) },
};
const relativeDateUnits = { day: 'روز', week: 'هفته', month: 'ماه', quarter: 'فصل', year: 'سال' };
const queryDateNames = names => ({ mode: 'date_mode', amount: 'relative_amount', unit: 'relative_unit', direction: 'relative_direction', includeCurrent: 'include_current', allowRelative: true, ...names });
export function queryFilterOperators(type) {
    const keys = type === 'text' ? ['eq', 'neq', 'in', 'not_in', ...partialTextOperators, ...emptyFilterOperators] : type === 'boolean' ? ['eq', 'neq', 'in', 'not_in', 'is_null', 'not_null'] : ['eq', 'neq', 'in', 'not_in', 'between', 'not_between', 'gt', 'gte', 'lt', 'lte', 'is_null', 'not_null'];
    return keys.map(key => ({ key, label: operators[key] || key }));
}

export function readQueryFilterValue(form, column, operator, names = {}, validate = true) {
    if (emptyFilterOperators.includes(operator)) return null;
    if (readQueryFilterRelative(form, column, operator, names, validate)) return null;
    const keys = { value: 'value', from: 'from', to: 'to', part: 'date_part', ...names };
    const datePart = column?.type === 'date' && ['in', 'not_in'].includes(operator) ? form.get(keys.part) : null;
    let value = ['between', 'not_between'].includes(operator) ? [form.get(keys.from) ?? '', form.get(keys.to) ?? ''] : ['in', 'not_in'].includes(operator) ? column?.type === 'boolean' || datePart ? form.getAll(keys.value) : String(form.get(keys.value) ?? '').split(',').map(item => item.trim()).filter(item => item !== '') : form.get(keys.value) ?? '';
    const parse = item => {
        if (item === '' || item === null || item === undefined) { if (validate) throw new Error('مقدار یا بازهٔ فیلتر را کامل وارد کنید.'); return ''; }
        if (column?.type === 'number' || datePart) { const number = Number(item); if (!Number.isFinite(number)) { if (validate) throw new Error('عدد معتبر وارد کنید.'); return item; } return number; }
        if (column?.type === 'boolean') { if ([0, '0', false].includes(item)) return 0; if ([1, '1', true].includes(item)) return 1; if (validate) throw new Error('مقدار بله یا خیر انتخاب کنید.'); }
        return item;
    };
    value = Array.isArray(value) ? value.map(parse) : parse(value);
    if (validate && Array.isArray(value) && !value.length) throw new Error('حداقل یک مقدار انتخاب کنید.');
    if (validate && datePart && (!dateParts[datePart] || value.some(item => !dateParts[datePart].values.some(choice => choice.key === item)))) throw new Error('مقادیر بخش تاریخ را از فهرست انتخاب کنید.');
    if (validate && ['between', 'not_between'].includes(operator) && value[0] > value[1]) throw new Error('ابتدای بازه باید قبل از انتهای آن باشد.');
    return value;
}

export function readQueryFilterRelative(form, column, operator, names = {}, validate = true) {
    const keys = queryDateNames(names);
    if (!keys.allowRelative || column?.type !== 'date' || !['between', 'not_between'].includes(operator) || form.get(keys.mode) !== 'relative') return null;
    const direction = form.get(keys.direction) || 'past';
    const unit = form.get(keys.unit) || 'month';
    const amount = direction === 'current' ? 1 : Number(form.get(keys.amount) ?? 1);
    if (validate && (!['past', 'current', 'future'].includes(direction) || !relativeDateUnits[unit] || !Number.isInteger(amount) || amount < 1 || amount > 365)) throw new Error('تعداد صحیح و واحد معتبر برای بازهٔ پویا انتخاب کنید.');
    return { unit, amount, direction, include_current: direction !== 'current' && form.has(keys.includeCurrent) };
}

export function readQueryFilter(form, column, validate = true) {
    const operator = form.get('operator');
    const row = { field: form.get('field'), operator, value: readQueryFilterValue(form, column, operator, {}, validate) };
    if (column?.type === 'text' && partialTextOperators.includes(operator)) row.case_sensitive = form.has('case_sensitive');
    if (column?.type === 'date' && ['in', 'not_in'].includes(operator) && form.get('date_part')) row.date_part = form.get('date_part');
    const relative = readQueryFilterRelative(form, column, operator, {}, validate);
    if (relative) row.relative_date = relative;
    return row;
}

export function queryFilterValueLabel(row, type) {
    if (emptyFilterOperators.includes(row.operator)) return '';
    if (row.relative_date) { const relative = row.relative_date; return relative.direction === 'current' ? `${relativeDateUnits[relative.unit]} جاری` : `${relative.amount} ${relativeDateUnits[relative.unit]} ${relative.direction === 'future' ? 'آینده' : 'گذشته'}${relative.include_current ? ' و دورهٔ جاری' : ''}`; }
    if (row.date_part && dateParts[row.date_part]) return dateParts[row.date_part].label + ': ' + (row.value || []).map(value => dateParts[row.date_part].values.find(choice => choice.key === Number(value))?.label || value).join('، ');
    const label = value => type === 'boolean' ? Number(value) === 0 ? 'خیر' : 'بله' : value ?? '';
    return Array.isArray(row.value) ? row.value.map(label).join('، ') : label(row.value);
}

export const notebookFlowMethods = {
    reportHtml() {
        const report = this.report; const q = report.query_definition;
        const connection = this.library.connections.find(row => row.id === q.connection_id); const table = connection?.catalog?.find(row => row.key === q.source);
        const native = q.mode === 'native'; const notebook = this.notebookOpen !== false;
        const sqlControl = native ? '' : button(icon('code') + 'SQL', 'showSql');
        const refreshControl = !native && !notebook ? button(icon('refresh'), 'runReport', 'small', 'aria-label="اجرای مجدد"') : '';
        return `<header class="mb-toolbar mb-question-header"><div><div class="mb-breadcrumb">${e(connection?.name)} / ${e(table?.label)}</div><h1>${e(report.name)}</h1><small class="mb-dirty">${this.dirty ? 'تغییرات ذخیره نشده' : 'پرسش ذخیره‌شده'}</small></div><div class="mb-actions">${button(icon('back') + 'بازگشت', 'cancelReport')}${native ? button(icon('database'), 'toggleSqlSchema', this.sqlSchemaOpen ? 'selected' : '', 'title="ساختار داده‌ها"') : button(icon('notebook') + 'ویرایشگر', 'toggleNotebook', notebook ? 'selected' : '')}${sqlControl}${button('ذخیره', 'reportSaveDialog', 'primary')}</div></header>${native ? this.nativeEditorHtml(connection) : notebook ? this.notebookHtml() : ''}<section class="mb-preview mb-question-result"><div class="mb-preview-body">${this.previewResult ? '' : '<div class="mb-empty">' + icon('chart') + '<strong>داده‌ها چه چیزی به شما می‌گویند؟</strong>پرسش را تنظیم کنید و «نمایش نتیجه» را بزنید.</div>'}</div><footer class="mb-preview-meta"><div class="mb-actions">${button(icon(report.display) + 'نمایش', 'displayPicker', 'small')}${iconButton('settings', 'تنظیمات نمایش', 'reportVisualization')}${refreshControl}</div><span class="mb-result-meta"></span>${button(icon('download'), 'exportReport', 'small', 'aria-label="دریافت نتیجه"')}</footer></section>`;
    },
    notebookDefinition(stage = 0) { return stage === 0 ? this.report.query_definition : this.report.query_definition.stages?.[stage - 1]; },
    outputColumns() { return this.report.query_definition.mode === 'native' ? [] : this.notebookColumns(this.report.query_definition.stages?.length || 0); },
    notebookFields(stage = 0, definition = this.notebookDefinition(stage)) {
        if (stage === 0) return this.reportFields(definition);
        const fields = copy(this.notebookColumns(stage - 1));
        const connection = this.library.connections.find(row => row.id === this.report.query_definition.connection_id);
        for (const join of definition?.joins || []) {
            const table = connection.catalog.find(row => row.key === join.source);
            for (const column of table?.fields || []) fields.push(joinedMetadataField(column, table, join.alias + '.' + column.key));
        }
        for (const expression of definition?.expressions || []) fields.push({ key: expression.key, label: expression.label, type: expression.type || 'number', computed: true });
        return fields;
    },
    notebookColumns(stage = 0, definition = this.notebookDefinition(stage)) {
        const fields = this.notebookFields(stage, definition);
        if (definition.mode === 'rows') return definition.columns ? definition.columns.map(key => fields.find(row => row.key === key)).filter(Boolean) : fields.filter(row => !row.hidden).slice(0, 50);
        return [...definition.dimensions.map(row => fields.find(column => column.key === row.field)).filter(Boolean), ...definition.metrics.map(row => ({ key: row.key, label: row.label ?? row.key, type: ['min', 'max'].includes(row.function) ? fields.find(column => column.key === row.field)?.type || 'number' : 'number' }))];
    },
    prepareNotebookContext(stage = 0) {
        const fullQuery = copy(this.report.query_definition);
        let definition = stage === 0 ? fullQuery : fullQuery.stages?.[stage - 1];
        if (!definition) {
            if (stage > 5 || stage !== (fullQuery.stages?.length || 0) + 1) throw new Error('حداکثر پنج مرحلهٔ بعدی مجاز است.');
            definition = { mode: 'rows', metrics: [], dimensions: [], filters: [], joins: [], expressions: [], sort: [], limit: null, limit_explicit: false, columns: this.notebookColumns(stage - 1).map(row => row.key).slice(0, 50) };
            fullQuery.stages ||= []; fullQuery.stages.push(definition);
        }
        definition.joins ||= []; definition.expressions ||= []; definition.sort ||= [];
        return { definition, fields: this.notebookFields(stage, definition), fullQuery, stageIndex: stage === 0 ? null : stage - 1, stage };
    },
    notebookSectionVisible(stage, kind, active) { return active || this.notebookSections?.has(`${stage}:${kind}`); },
    notebookStep(stage, kind, body, removable = true, suffix = '') {
        const key = `${stage}:${kind}${suffix}`;
        const preview = this.stepPreviewResults?.[key];
        const definition = this.notebookDefinition(stage);
        const active = kind === 'data' || kind === 'join' || (kind === 'summarize' ? definition.mode === 'aggregate' : kind === 'limit' ? definition.limit_explicit : definition[({ expression: 'expressions', filter: 'filters', sort: 'sort' })[kind]]?.length > 0);
        return `<div class="mb-step ${kind} mb-notebook-step" data-notebook-step="${kind}" data-stage="${stage}"><div class="mb-notebook-step-heading"><div class="mb-step-label">${titles[kind]}</div>${removable && (active || this.notebookSections?.has(`${stage}:${kind}`)) ? iconButton('close', 'حذف ' + titles[kind], 'removeNotebookSection', `data-stage="${stage}" data-type="${kind}" ${suffix ? `data-index="${suffix.slice(1)}"` : ''}`) : ''}</div><div class="mb-notebook-step-row"><div class="mb-step-content">${body}</div>${active ? iconButton('play', 'پیش‌نمایش ' + titles[kind], 'previewNotebookStep', `data-stage="${stage}" data-type="${kind}" data-suffix="${suffix}"`) : '<span class="mb-notebook-preview-spacer" aria-hidden="true"></span>'}</div>${preview ? `<div class="mb-step-preview" data-step-key="${e(key)}"><header><strong>پیش‌نمایش ${titles[kind]}</strong><span>${preview.rows.length} ردیف</span>${iconButton('close', 'بستن پیش‌نمایش', 'closeNotebookPreview', `data-key="${e(key)}"`)}</header>${tableHtml({ ...preview, rows: preview.rows.slice(0, 10) })}<p class="mb-help">پیش‌نمایش هر بخش حداکثر ۱۰ ردیف دارد.</p></div>` : ''}</div>`;
    },
    notebookClause(stage, list, row, index, label, color = '') {
        const attrs = `data-stage="${stage}" data-list="${list}" data-index="${index}"`;
        const direction = list === 'sort' ? `<button type="button" class="mb-sort-direction" data-action="toggleSortDirection" ${attrs} aria-label="${row.direction === 'asc' ? 'صعودی؛ تغییر به نزولی' : 'نزولی؛ تغییر به صعودی'}">${row.direction === 'asc' ? '↑' : '↓'}</button>` : '';
        return `<span class="mb-notebook-chip ${color} mb-notebook-clause" draggable="true" ${attrs}>${direction}<button type="button" data-action="editNotebookClause" ${attrs}>${label}</button>${iconButton('close', 'حذف', 'removeNotebookClause', attrs)}</span>`;
    },
    notebookStageHtml(stage) {
        const q = this.notebookDefinition(stage); const fields = this.notebookFields(stage); const label = key => e(fields.find(row => row.key === key)?.label || q.field_labels?.[key] || key);
        const connection = this.library.connections.find(row => row.id === this.report.query_definition.connection_id);
        const table = stage === 0 ? connection?.catalog?.find(row => row.key === q.source) : null;
        let html = stage === 0 ? this.notebookStep(stage, 'data', `<div class="mb-step-box">${button(icon('table') + e(table?.label || q.source), 'changeSource', 'mb-source-chip')}${q.mode === 'rows' ? button(icon('settings'), 'selectColumns', 'mb-cell-add', 'title="انتخاب ستون‌ها" aria-label="انتخاب ستون‌ها"') : ''}</div>`, false) : `<div class="mb-stage-after-title"><strong>مرحلهٔ ${stage + 1}</strong><span>نتیجهٔ مرحلهٔ قبلی</span>${iconButton('close', 'حذف این مرحله و مراحل بعدی', 'removeStage', `data-index="${stage - 1}"`)}</div>`;
        for (const [index, join] of (q.joins || []).entries()) {
            const relation = fields.find(row => row.key === join.field)?.relation; const target = connection.catalog.find(row => row.key === (join.source || relation?.table));
            const conditions = join.conditions || [{ left: join.field, operator: 'eq', right: relation?.field }];
            html += this.notebookStep(stage, 'join', `<div class="mb-join-row"><div class="mb-step-box">${button(stage === 0 ? e(table?.label) : 'نتیجهٔ مرحلهٔ قبلی', 'editNotebookClause', 'mb-source-chip', `data-stage="${stage}" data-list="joins" data-index="${index}"`)}${button(this.joinIcon(join.type || 'left') + '<span class="mb-sr-only">' + e((join.type || 'left').toUpperCase()) + ' JOIN</span>', 'editNotebookClause', 'mb-cell-add', `data-stage="${stage}" data-list="joins" data-index="${index}" aria-label="تغییر نوع اتصال"`)}${button(e(target?.label), 'editNotebookClause', 'mb-source-chip', `data-stage="${stage}" data-list="joins" data-index="${index}"`)}</div><span class="mb-join-on">روی</span><div class="mb-step-box mb-grow">${conditions.map(condition => `<button class="mb-condition-chip" data-action="editNotebookClause" data-stage="${stage}" data-list="joins" data-index="${index}">${label(condition.left)} <b dir="ltr">${e(({ eq: '=', neq: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤' })[condition.operator])}</b> ${e(target?.fields.find(row => row.key === condition.right)?.label)}</button>`).join('<span>و</span>')}</div></div>`, true, ':' + index);
        }
        html += this.notebookActions(stage, 'source');
        if (this.notebookSectionVisible(stage, 'expression', q.expressions?.length)) html += this.notebookStep(stage, 'expression', `<div class="mb-step-box">${(q.expressions || []).map((row, index) => this.notebookClause(stage, 'expressions', row, index, e(row.label), 'gray')).join('')}${button(icon('plus') + (!q.expressions?.length ? 'افزودن ستون محاسباتی' : ''), 'editNotebookClause', 'mb-cell-add', `data-stage="${stage}" data-list="expressions" data-index="-1"`)}</div>`);
        if (stage === 0 || this.notebookSectionVisible(stage, 'filter', q.filters.length)) html += this.notebookStep(stage, 'filter', `<div class="mb-step-box">${q.filters.map((row, index) => this.notebookClause(stage, 'filters', row, index, `${label(row.field)} ${e(operators[row.operator])} ${e(queryFilterValueLabel(row, fields.find(column => column.key === row.field)?.type))}`, 'purple')).join('')}${button(icon('plus') + (!q.filters.length ? 'افزودن فیلتر' : ''), stage === 0 ? 'addReportFilter' : 'editNotebookClause', 'mb-cell-add', `data-stage="${stage}" data-list="filters" data-index="-1"`)}</div>`);
        if (stage === 0 || this.notebookSectionVisible(stage, 'summarize', q.mode === 'aggregate')) html += this.notebookStep(stage, 'summarize', `<div class="mb-summary-row"><div class="mb-step-box mb-grow">${q.mode === 'aggregate' ? q.metrics.map((row, index) => this.notebookClause(stage, 'metrics', row, index, e(row.label || metrics[row.function]) + (row.function !== 'count' ? ' از ' + label(row.field) : ''), 'green')).join('') : ''}${button(icon('plus') + (q.mode === 'aggregate' && q.metrics.length ? '' : 'انتخاب محاسبه'), stage === 0 ? 'addMetric' : 'editNotebookClause', 'mb-cell-add', `data-stage="${stage}" data-list="metrics" data-index="-1"`)}</div><span>بر اساس</span><div class="mb-step-box mb-grow">${q.mode === 'aggregate' ? q.dimensions.map((row, index) => this.notebookClause(stage, 'dimensions', row, index, label(row.field) + (row.grain ? ': ' + e(grains[row.grain]) : ''), 'green')).join('') : ''}${button(icon('plus') + (q.dimensions.length ? '' : 'انتخاب گروه‌بندی'), stage === 0 ? 'addDimension' : 'editNotebookClause', 'mb-cell-add', `data-stage="${stage}" data-list="dimensions" data-index="-1"`)}</div></div>`);
        if (this.notebookSectionVisible(stage, 'sort', q.sort.length)) html += this.notebookStep(stage, 'sort', `<div class="mb-step-box">${q.sort.map((row, index) => this.notebookClause(stage, 'sort', row, index, e(this.notebookSortFields(stage).find(column => column.key === row.key)?.label || row.key), 'gray')).join('')}${button(icon('plus') + (!q.sort.length ? 'انتخاب ستون برای مرتب‌سازی' : ''), 'editNotebookClause', 'mb-cell-add', `data-stage="${stage}" data-list="sort" data-index="-1"`)}</div>`);
        if (this.notebookSectionVisible(stage, 'limit', q.limit_explicit)) html += this.notebookStep(stage, 'limit', `<div class="mb-step-box mb-limit-cell">${button(q.limit_explicit ? `${q.limit} ردیف` : 'تعیین حداکثر ردیف‌ها', 'editNotebookLimit', '', `data-stage="${stage}"`)}</div>`);
        html += this.notebookActions(stage);
        return stage === 0 ? html : `<div class="mb-stage-after" data-notebook-stage="${stage}">${html}</div>`;
    },
    notebookActions(stage, position = 'bottom') {
        const q = this.notebookDefinition(stage); const scalar = q.mode === 'aggregate' && !q.dimensions.length;
        const actions = [];
        if (position === 'source' && (q.joins || []).length < 5) actions.push(['join', stage]);
        if (position === 'source' && !this.notebookSectionVisible(stage, 'expression', q.expressions?.length)) actions.push(['expression', stage]);
        if (position === 'bottom' && !scalar) {
            if (!this.notebookSectionVisible(stage, 'sort', q.sort.length)) actions.push(['sort', stage]);
        if (this.notebookSectionVisible(stage, 'limit', q.limit_explicit)) html += this.notebookStep(stage, 'limit', `<div class="mb-step-box mb-limit-cell">${button(q.limit_explicit ? `${q.limit} ردیف` : 'تعیین حداکثر ردیف‌ها', 'editNotebookLimit', '', `data-stage="${stage}"`)}</div>`);
        }
        if (position === 'bottom' && stage > 0 && !(this.notebookDefinition(stage - 1).mode === 'aggregate' && !this.notebookDefinition(stage - 1).dimensions.length) && !q.filters.length) actions.unshift(['filter', stage]);
        if (position === 'bottom' && stage > 0 && !(this.notebookDefinition(stage - 1).mode === 'aggregate' && !this.notebookDefinition(stage - 1).dimensions.length) && q.mode !== 'aggregate') actions.unshift(['summarize', stage]);
        let next = '';
        if (position === 'bottom' && q.mode === 'aggregate' && stage === (this.report.query_definition.stages?.length || 0) && stage < 5) {
            const types = scalar ? ['join', 'expression'] : ['filter', 'summarize', 'join', 'expression'];
            next = `<div class="mb-notebook-next"><span>ادامه روی نتیجهٔ خلاصه‌سازی</span>${types.map(kind => button(icon(symbols[kind]) + titles[kind], 'openNotebookStep', `mb-notebook-action ${kind}`, `data-kind="${kind}" data-stage="${stage + 1}"`)).join('')}</div>`;
        }
        return `${actions.length ? `<div class="mb-notebook-actions">${actions.map(([kind, index]) => button(icon(symbols[kind]) + titles[kind], 'openNotebookStep', `mb-notebook-action ${kind}`, `data-kind="${kind}" data-stage="${index}"`)).join('')}</div>` : ''}${next}`;
    },
    notebookHtml() {
        return `<section class="mb-notebook mb-notebook-v2 mb-notebook-open">${this.notebookStageHtml(0)}${(this.report.query_definition.stages || []).map((_, index) => this.notebookStageHtml(index + 1)).join('')}<div class="mb-notebook-bottom">${button(icon('plus'), 'addNotebookStep', 'mb-round-add', 'aria-label="افزودن مرحله"')}${button(icon('play') + 'نمایش نتیجه', 'runReport', 'primary mb-run')}</div></section>`;
    },
    addNotebookStep() {
        const stage = this.report.query_definition.stages?.length || 0; const q = this.notebookDefinition(stage);
        const next = q.mode === 'aggregate' ? stage + 1 : stage; const scalar = q.mode === 'aggregate' && !q.dimensions.length;
        const operations = [...(!scalar ? ['filter', 'summarize'] : []), 'join', 'expression', ...(!scalar ? ['sort', 'limit'] : [])];
        this.modal('افزودن بخش به پرسش', operations.map(kind => {
            const targetStage = ['sort', 'limit'].includes(kind) ? stage : next;
            const legacy = targetStage === 0 ? { filter: 'addReportFilter', summarize: 'addMetric', join: 'addJoin', expression: 'addExpression', sort: 'addSort', limit: 'editLimit' }[kind] : null;
            return button(icon(symbols[kind]) + titles[kind], legacy || 'openNotebookStep', 'mb-card-picker', `data-kind="${kind}" data-stage="${targetStage}"`);
        }).join('') + (stage < 5 ? button(icon('notebook') + 'ادامه روی نتیجهٔ قبلی — تنظیم همهٔ بخش‌ها', 'addStage', 'mb-card-picker') : ''));
    },
    async openNotebookStep(target) {
        const stage = Number(target.dataset.stage || 0); const kind = target.dataset.kind;
        this.notebookEditingStage = stage; this.notebookSections ||= new Set(); this.notebookSections.add(`${stage}:${kind}`);
        if (kind === 'limit') return this.editNotebookLimit({ dataset: { stage } });
        const list = { expression: 'expressions', sort: 'sort', join: 'joins', filter: 'filters', summarize: 'metrics' }[kind];
        if (!list) return;
        await this.editNotebookClause({ dataset: { stage, list, index: -1 } });
    },
    async editNotebookClause(target) {
        const stage = Number(target.dataset.stage || 0); const index = Number(target.dataset.index); const list = target.dataset.list;
        this.notebookEditingStage = stage;
        const context = this.prepareNotebookContext(stage); this.notebookDraftContext = context;
        if (list === 'expressions') {
            const expressions = context.definition.expressions;
            const later = expressions.slice(index < 0 ? expressions.length : index).map(row => row.key);
            return this.openExpressionEditor({ definition: context.fullQuery, fields: context.fields.filter(row => !later.includes(row.key)), index, stageIndex: context.stageIndex, contextLabel: stage ? `نتیجهٔ مرحلهٔ ${stage}` : 'داده‌های جدول', onSave: query => { this.adaptNotebookDisplay(this.report.query_definition, query); this.report.query_definition = query; this.queryUpdated(); } });
        }
        if (list === 'sort') return this.editSort({ dataset: { index, stage } });
        if (stage === 0 && list === 'joins' && index < 0) return this.addJoin();
        if (stage === 0) return this[({ joins: 'editJoin', filters: 'editReportFilter', metrics: 'editMetric', dimensions: 'editDimension' })[list]]?.({ dataset: { index } });
        this.stageIndex = stage - 1; this.stageFields = this.notebookColumns(stage - 1); this.stageDraft = context.definition; this.stageInline = true;
        if (list === 'joins') {
            this.joinStage = true; this.joinIndex = index;
            const table = this.library.connections.find(row => row.id === this.report.query_definition.connection_id).catalog[0];
            this.joinDraft = copy(this.stageDraft.joins[index] || { source: table.key, alias: 'join_' + uid().replaceAll('-', '').slice(0, 8), type: 'left', conditions: [{ left: context.fields[0].key, right: table.fields[0].key, operator: 'eq' }] });
            return this.joinDialog();
        }
        this.notebookItemIndex = index; this.notebookItemList = list;
        if (list === 'filters') { this.notebookItemDraft = copy(context.definition.filters[index] || { field: context.fields[0].key, operator: 'eq', value: '' }); return this.notebookFilterDialog(); }
        if (list === 'metrics') { this.notebookItemDraft = copy(context.definition.metrics[index] || { key: 'metric_' + uid().replaceAll('-', '').slice(0, 8), function: 'count', label: '' }); return this.notebookMetricDialog(); }
        if (list === 'dimensions') { this.notebookItemDraft = copy(context.definition.dimensions[index] || { field: context.fields[0].key, grain: null }); return this.notebookDimensionDialog(); }
    },
    async commitNotebookDefinition(stage, definition, cleanDependencies = true) {
        const previous = this.report.query_definition;
        const query = copy(this.report.query_definition);
        if (stage === 0) Object.assign(query, definition); else { query.stages ||= []; query.stages[stage - 1] = copy(definition); }
        const pending = this.request('reports/validate', 'POST', { query_definition: cleanDependencies ? this.cleanNotebookDependencies(query) : query }); this.notebookPendingValidation = pending;
        let result;
        try { result = await pending; } finally { if (this.notebookPendingValidation === pending) this.notebookPendingValidation = null; }
        this.adaptNotebookDisplay(previous, result.query_definition); this.report.query_definition = result.query_definition; this.queryUpdated();
    },
    adaptNotebookDisplay(previous, query) {
        const scalar = definition => {
            const stage = definition.stages?.at(-1) || definition;
            return stage.mode === 'aggregate' && !stage.dimensions.length && stage.metrics.length === 1;
        };
        const wasScalar = scalar(previous); const isScalar = scalar(query);
        if (!wasScalar && isScalar && this.report.display === 'table') this.report.display = 'number';
        else if (wasScalar && !isScalar && this.report.display === 'number') this.report.display = 'table';
    },
    queryUpdated() {
        this.previewResult = null; this.stepPreviewResults = {}; this.notebookSections = new Set(); this.notebookOpen = true; this.notebookDraftContext = null; this.stageInline = false;
        this.markDirty(); this.closeModal(); this.render();
    },
    notebookSortFields(stage) { const q = this.notebookDefinition(stage) || this.notebookDraftContext?.definition; return q.mode === 'rows' ? this.notebookFields(stage, q) : this.notebookColumns(stage, q); },
    addSort() { return this.editSort({ dataset: { index: -1, stage: 0 } }); },

    chooseSortColumn(target) { this.root.querySelector('.mb-dialog [name=key]').value = target.dataset.key; return this.saveSort(); },
    async saveSort() {
        const form = this.form(); const row = { key: form.get('key'), direction: form.get('direction') }; if (!row.key) throw new Error('ستون انتخاب کنید.');
        const definition = copy(this.notebookDraftContext.definition);
        if (this.notebookSortIndex < 0) definition.sort.push(row); else definition.sort[this.notebookSortIndex] = row;
        await this.commitNotebookDefinition(this.notebookEditingStage, definition);
    },
    async toggleSortDirection(target) { const stage = Number(target.dataset.stage || 0); const q = copy(this.notebookDefinition(stage)); const row = q.sort[Number(target.dataset.index)]; row.direction = row.direction === 'asc' ? 'desc' : 'asc'; await this.commitNotebookDefinition(stage, q); },
    editLimit() { return this.openNotebookStep({ dataset: { stage: 0, kind: 'limit' } }); },
    async saveNotebookLimit(target) {
        const stage = Number(target.dataset.stage || 0); const value = target.value.trim(); const limit = value === '' ? null : Number(value);
        if (limit !== null && (!Number.isSafeInteger(limit) || limit < 1)) { target.setAttribute('aria-invalid', 'true'); this.toast('تعداد ردیف‌ها باید عدد صحیح مثبت باشد.', true); return; }
        const definition = copy(this.notebookDefinition(stage));
        if (definition.limit === limit && !!definition.limit_explicit === (limit !== null)) return;
        definition.limit = limit; definition.limit_explicit = limit !== null;
        await this.commitNotebookDefinition(stage, definition);
    },

async saveNotebookFilter() { const form = this.form(); const column = this.notebookDraftContext.fields.find(column => column.key === form.get('field')); await this.saveNotebookItem('filters', readQueryFilter(form, column)); },

async saveNotebookMetric() { const form = this.form(); const row = { ...this.notebookItemDraft, label: form.get('label') || metrics[this.notebookItemDraft.function] }; if (row.function !== 'count') row.field = form.get('field'); else delete row.field; await this.saveNotebookItem('metrics', row); },

async saveNotebookDimension() { const form = this.form(); await this.saveNotebookItem('dimensions', { field: form.get('field'), grain: form.get('grain') || null }); },
    async saveNotebookItem(list, row) { const definition = copy(this.notebookDraftContext.definition); if (this.notebookItemIndex < 0) definition[list].push(row); else definition[list][this.notebookItemIndex] = row; if (['metrics', 'dimensions'].includes(list)) { definition.mode = 'aggregate'; if (!definition.metrics.length) definition.metrics = [{ key: 'count', function: 'count', label: 'تعداد ردیف‌ها' }]; } await this.commitNotebookDefinition(this.notebookEditingStage, definition); },
    editStageExpression(target) {
        this.readStageForm(); const index = Number(target.dataset.index); const query = copy(this.report.query_definition); query.stages ||= [];
        const stageIndex = this.stageIndex < 0 ? query.stages.length : this.stageIndex; query.stages[stageIndex] = copy(this.stageDraft);
        const later = this.stageDraft.expressions.slice(index < 0 ? this.stageDraft.expressions.length : index).map(row => row.key);
        this.openExpressionEditor({ definition: query, fields: this.stageAvailableFields().filter(row => !later.includes(row.key)), index, stageIndex, contextLabel: 'نتیجهٔ مرحلهٔ قبلی', onSave: canonical => { this.stageDraft = copy(canonical.stages[stageIndex]); this.stageDraft.joins ||= []; this.stageDraft.expressions ||= []; this.stageDialog(); } });
    },
    cleanNotebookDependencies(query) {
        const original = this.report.query_definition; this.report.query_definition = query;
        try {
            for (let stage = 0; stage <= (query.stages?.length || 0); stage++) {
                const q = this.notebookDefinition(stage);
                const expressions = q.expressions || []; q.expressions = [];
                const joins = q.joins || []; q.joins = [];
                for (const join of joins) {
                    const available = this.notebookFields(stage, q).map(row => row.key);
                    if (join.field ? available.includes(join.field) : join.conditions.every(condition => available.includes(condition.left))) q.joins.push(join);
                }
                for (const expression of expressions) {
                    const keys = this.notebookFields(stage, q).map(row => row.key);
                    const refs = [...expression.expression.matchAll(/"(?:""|[^"\r\n])*"|\[([^\]\r\n]+)\]/g)].map(match => match[1]).filter(Boolean);
                    if (refs.every(key => keys.includes(key))) q.expressions.push(expression);
                }
                const keys = this.notebookFields(stage, q).map(row => row.key);
                if (q.columns) { q.columns = q.columns.filter(key => keys.includes(key)); if (!q.columns.length) delete q.columns; }
                q.filters = q.filters.filter(row => keys.includes(row.field)); q.dimensions = q.dimensions.filter(row => keys.includes(row.field));
                q.metrics = q.metrics.filter(row => row.function === 'count' || keys.includes(row.field));
                if (q.mode === 'aggregate' && !q.metrics.length) { q.mode = 'rows'; q.dimensions = []; }
                const orderable = q.mode === 'rows' ? keys : this.notebookColumns(stage, q).map(row => row.key); q.sort = q.sort.filter(row => orderable.includes(row.key));
            }
            while (query.stages?.length) {
                const last = query.stages.at(-1); const previous = this.notebookColumns(query.stages.length - 1).map(row => row.key);
                if (last.mode === 'rows' && !(last.joins?.length || last.expressions?.length || last.filters.length || last.sort.length || last.limit_explicit) && (!last.columns || JSON.stringify(last.columns) === JSON.stringify(previous))) query.stages.pop(); else break;
            }
        } finally { this.report.query_definition = original; }
        return query;
    },
    async removeNotebookSection(target) {
        const stage = Number(target.dataset.stage || 0); const kind = target.dataset.type; const query = copy(this.report.query_definition); const q = stage === 0 ? query : query.stages[stage - 1];
        if (kind === 'join') q.joins.splice(Number(target.dataset.index), 1);
        if (kind === 'expression') q.expressions = [];
        if (kind === 'filter') q.filters = [];
        if (kind === 'summarize') { q.mode = 'rows'; q.metrics = []; q.dimensions = []; }
        if (kind === 'sort') q.sort = [];
        if (kind === 'limit') { q.limit = null; q.limit_explicit = false; }
        this.notebookSections?.delete(`${stage}:${kind}`);
        await this.commitNotebookDefinition(stage, q);
    },
    async removeNotebookClause(target) {
        const stage = Number(target.dataset.stage || 0); const query = copy(this.report.query_definition); const q = stage === 0 ? query : query.stages[stage - 1]; q[target.dataset.list].splice(Number(target.dataset.index), 1);
        await this.commitNotebookDefinition(stage, q);
    },
    async reorderNotebookClause(source, target) {
        while (this.notebookPendingValidation) await this.notebookPendingValidation;
        if (source.stage !== target.stage || source.list !== target.list || source.index === target.index) return;
        const definition = copy(this.notebookDefinition(source.stage)); const [row] = definition[source.list].splice(source.index, 1); definition[source.list].splice(target.index, 0, row);
        await this.commitNotebookDefinition(source.stage, definition, false);
    },
    async previewNotebookStep(target) {
        const stage = Number(target.dataset.stage || 0); const kind = target.dataset.type; const suffix = target.dataset.suffix || ''; const key = `${stage}:${kind}${suffix}`;
        const query = copy(this.report.query_definition); query.stages = (query.stages || []).slice(0, stage);
        const q = stage === 0 ? query : query.stages[stage - 1]; const order = ['data', 'join', 'expression', 'filter', 'summarize', 'sort', 'limit']; const position = order.indexOf(kind);
        if (position < 1) q.joins = []; else if (kind === 'join' && suffix) q.joins = q.joins.slice(0, Number(suffix.slice(1)) + 1);
        if (position < 2) q.expressions = [];
        if (position < 3) q.filters = [];
        if (position < 4) {
            q.mode = 'rows'; q.metrics = []; q.dimensions = [];
            if (q.columns) {
                const available = this.notebookFields(stage, q).map(column => column.key);
                q.columns = q.columns.filter(column => available.includes(column));
                if (!q.columns.length) delete q.columns;
            }
        }
        if (position < 5) q.sort = [];
        if (position < 6) { q.limit = null; q.limit_explicit = false; }
        q.limit = Math.min(q.limit_explicit ? q.limit : 10, 10); q.limit_explicit = true;
        if (stage === 0) delete query.stages;
        const signature = JSON.stringify(this.report.query_definition); const epoch = this.epoch;
        const result = await this.request('reports/preview', 'POST', { query_definition: query });
        if (signature !== JSON.stringify(this.report.query_definition) || epoch !== this.epoch) return;
        this.stepPreviewResults ||= {}; this.stepPreviewResults[key] = result; this.render();
    },
    closeNotebookPreview(target) { delete this.stepPreviewResults[target.dataset.key]; this.render(); },
};
