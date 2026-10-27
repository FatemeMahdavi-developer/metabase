import { e, copy, uid, icon } from "./ui";

const types = { number: 'عدد', text: 'متن', boolean: 'بله / خیر', date: 'تاریخ' };
const readableFieldName = (column, fields) => column?.label && !/[\]\r\n]/.test(column.label) && fields.filter(row => row.label === column.label).length === 1 && !fields.some(row => row.key === column.label && row.key !== column.key) ? column.label : column?.key;
const readableExpression = (source, fields) => String(source || '').replace(/"(?:""|[^"\r\n])*"|\[([^\]\r\n]+)\]/g, (token, key) => key === undefined ? token : '[' + (readableFieldName(fields.find(row => row.key === key), fields) || key) + ']');
export const expressionFunctions = [
    { key: 'abs', group: 'number', signature: 'abs(number)', description: 'قدر مطلق عدد؛ مقدار منفی را مثبت می‌کند.', example: 'abs(-10)' },
    { key: 'round', group: 'number', signature: 'round(number, decimals)', description: 'گرد کردن عدد؛ تعداد رقم اعشار اختیاری است.', example: 'round([total] * 0.09, 2)' },
    { key: 'ceil', group: 'number', signature: 'ceil(number)', description: 'نزدیک‌ترین عدد صحیح بزرگ‌تر یا مساوی مقدار.', example: 'ceil(1.2)' },
    { key: 'floor', group: 'number', signature: 'floor(number)', description: 'نزدیک‌ترین عدد صحیح کوچک‌تر یا مساوی مقدار.', example: 'floor(1.8)' },
    { key: 'upper', group: 'text', signature: 'upper(text)', description: 'تبدیل حروف متن به حروف بزرگ.', example: 'upper("hello")' },
    { key: 'lower', group: 'text', signature: 'lower(text)', description: 'تبدیل حروف متن به حروف کوچک.', example: 'lower("HELLO")' },
    { key: 'length', group: 'text', signature: 'length(text)', description: 'تعداد نویسه‌های یک متن.', example: 'length("سلام")' },
    { key: 'concat', group: 'text', signature: 'concat(text1, text2, ...)', description: 'چسباندن دو یا چند متن به یکدیگر.', example: 'concat("نام", " — ", "شهر")' },
    { key: 'trim', group: 'text', signature: 'trim(text)', description: 'حذف فاصله‌های ابتدا و انتهای متن.', example: 'trim(" hello ")' },
    { key: 'ltrim', group: 'text', signature: 'ltrim(text)', description: 'حذف فاصله‌های ابتدای متن.', example: 'ltrim(" hello")' },
    { key: 'rtrim', group: 'text', signature: 'rtrim(text)', description: 'حذف فاصله‌های انتهای متن.', example: 'rtrim("hello ")' },
    { key: 'substring', group: 'text', signature: 'substring(text, start, length)', description: 'بخشی از متن؛ شمارهٔ شروع از ۱ است و طول اختیاری است.', example: 'substring("Metabase", 1, 4)' },
    { key: 'replace', group: 'text', signature: 'replace(text, find, replacement)', description: 'جایگزین کردن همهٔ موارد یک متن با متن دیگر.', example: 'replace("2026-10", "-", "/")' },
    { key: 'if', group: 'condition', signature: 'if(condition, result, otherwise)', description: 'انتخاب نتیجه بر اساس شرط؛ نتیجه‌ها باید هم‌نوع باشند.', example: 'if([total] > 100, "زیاد", "کم")' },
    { key: 'case', group: 'condition', signature: 'case(condition1, result1, condition2, result2, ..., otherwise)', description: 'اولین شرط درست، نتیجه را مشخص می‌کند. نتیجهٔ پیش‌فرض اختیاری است.', example: 'case([total] > 500, "زیاد", [total] > 100, "متوسط", "کم")' },
    { key: 'contains', group: 'condition', signature: 'contains(text, search)', description: 'آیا متن شامل مقدار موردنظر است؟ حروف بزرگ و کوچک متفاوت‌اند.', example: 'contains("Metabase", "base")' },
    { key: 'startsWith', group: 'condition', signature: 'startsWith(text, search)', description: 'آیا متن با مقدار موردنظر شروع می‌شود؟', example: 'startsWith("Metabase", "Meta")' },
    { key: 'endsWith', group: 'condition', signature: 'endsWith(text, search)', description: 'آیا متن با مقدار موردنظر تمام می‌شود؟', example: 'endsWith("report.csv", ".csv")' },
    { key: 'between', group: 'condition', signature: 'between(value, minimum, maximum)', description: 'بررسی قرار گرفتن مقدار در بازه، شامل دو انتهای بازه.', example: 'between([total], 100, 500)' },
    { key: 'not', group: 'condition', signature: 'not(condition)', description: 'برعکس کردن نتیجهٔ یک شرط بله / خیر.', example: 'not([total] > 100)' },
    { key: 'coalesce', group: 'empty', signature: 'coalesce(value1, value2, ...)', description: 'انتخاب اولین مقدار غیرخالی؛ همهٔ مقدارها باید هم‌نوع باشند.', example: 'coalesce([total], 0)' },
    { key: 'isNull', group: 'empty', signature: 'isNull(value)', description: 'آیا مقدار تهی (NULL) است؟ متن خالی با NULL تفاوت دارد.', example: 'isNull([status])' },
    { key: 'notNull', group: 'empty', signature: 'notNull(value)', description: 'آیا مقدار تهی (NULL) نیست؟', example: 'notNull([status])' },
];

export const expressionEditorMethods = {
    addExpression() { this.editExpression({ dataset: { index: -1 } }); },
    editExpression(target) {
        const index = Number(target.dataset.index); const q = this.report.query_definition;
        const before = copy(q); before.expressions = index < 0 ? before.expressions || [] : before.expressions.slice(0, index);
        this.openExpressionEditor({ definition: q, fields: this.reportFields(before), index });
    },
    openExpressionEditor({ definition, fields, index = -1, stageIndex = null, contextLabel = '', onSave } = {}) {
        this.closeModal();
        clearTimeout(this.expressionValidationTimer); this.expressionValidationRevision = (this.expressionValidationRevision || 0) + 1;
        const q = copy(definition); const stage = stageIndex === null ? q : q.stages[stageIndex];
        if (index < 0 && (stage.expressions || []).length >= 10) throw new Error('در هر مرحله حداکثر ۱۰ ستون محاسباتی مجاز است.');
        this.expressionEditorContext = { definition: q, fields: copy(fields), index, stageIndex, onSave, contextLabel };
        this.expressionDraft = copy(stage.expressions?.[index] || { key: 'custom_' + uid().replaceAll('-', '').slice(0, 8), label: '', expression: '' });
        this.expressionDraft.expression = readableExpression(this.expressionDraft.expression, fields);
        this.expressionValid = false; this.expressionBrowserOpen = false; this.expressionBrowserFilter = ''; this.expressionSuggestionIndex = 0; this.expressionActiveFunction = null;
        this.expressionDialog(); this.queueExpressionValidation();
    },

expressionEditorInput(target) {
        if (target.dataset.expressionSearch !== undefined) {
            const term = target.value.trim().toLocaleLowerCase(); this.root.querySelectorAll('[data-expression-field]').forEach(row => { row.hidden = !row.textContent.toLocaleLowerCase().includes(term) && !row.dataset.key.toLocaleLowerCase().includes(term); }); return;
        }
        if (target.dataset.expressionBrowserSearch !== undefined) { this.expressionBrowserFilter = target.value; this.renderExpressionFunctionList(); return; }
        if (target.dataset.expressionName !== undefined) { this.expressionDraft.label = target.value; this.updateExpressionSaveState(); return; }
        if (target.dataset.expressionEditor !== undefined) {
            this.expressionDraft.expression = target.value; this.expressionValid = false; this.updateExpressionSuggestions(); this.updateExpressionHelp(); this.updateExpressionHighlight(); this.queueExpressionValidation();
        }
    },
    expressionCandidate() {
        const context = this.expressionEditorContext; const q = copy(context.definition); const stage = context.stageIndex === null ? q : q.stages[context.stageIndex];
        const row = { ...this.expressionDraft, label: this.expressionDraft.label?.trim() || 'ستون سفارشی' }; stage.expressions ||= [];
        if (context.index < 0) stage.expressions.push(row); else stage.expressions[context.index] = row;
        return q;
    },
    queueExpressionValidation() {
        clearTimeout(this.expressionValidationTimer); const revision = ++this.expressionValidationRevision; const source = this.expressionDraft.expression?.trim();
        this.expressionValid = false; this.updateExpressionSaveState();
        if (!source) { this.setExpressionStatus('empty', 'فرمول را وارد کنید؛ برای دیدن ستون‌ها [ را بزنید.'); return; }
        this.setExpressionStatus('pending', 'در حال بررسی فرمول…');
        this.expressionValidationTimer = setTimeout(() => this.validateExpressionDraft(revision), 300);
    },
    async validateExpressionDraft(revision = this.expressionValidationRevision) {
        if (revision !== this.expressionValidationRevision || !this.expressionEditorTextarea()) return null;
        const context = this.expressionEditorContext; const source = this.expressionDraft.expression;
        try {
            const result = await this.request('reports/expression/validate', 'POST', { query_definition: this.expressionCandidate(), expression_key: this.expressionDraft.key, stage_index: context.stageIndex });
            if (revision !== this.expressionValidationRevision || source !== this.expressionDraft.expression || !this.expressionEditorTextarea()) return null;
            this.expressionDraft.type = result.type; this.expressionValid = true;
            this.setExpressionStatus('valid', 'فرمول معتبر است · نوع خروجی: ' + (types[result.type] || result.type)); this.updateExpressionSaveState();
            return result;
        } catch (error) {
            if (revision !== this.expressionValidationRevision || !this.expressionEditorTextarea()) return null;
            this.expressionValid = false; this.setExpressionStatus('error', error.message); this.updateExpressionSaveState(); return null;
        }
    },
    setExpressionStatus(state, message) { const box = this.root.querySelector('[data-expression-status]'); if (box) { box.dataset.state = state; box.textContent = message; box.setAttribute('role', state === 'error' ? 'alert' : 'status'); } this.expressionEditorTextarea()?.setAttribute('aria-invalid', String(state === 'error')); },
    updateExpressionSaveState() { const save = this.root.querySelector('.mb-dialog[open] [data-action="saveExpression"]'); if (save) save.disabled = !this.expressionValid || !this.expressionDraft.label?.trim(); const format = this.root.querySelector('[data-action="formatExpressionFormula"]'); if (format) format.disabled = !this.expressionValid; },
    updateExpressionHighlight() {
        const editor = this.expressionEditorTextarea(); const layer = this.root.querySelector('[data-expression-highlight]'); if (!editor || !layer) return;
        const source = editor.value; const tokens = /"(?:""|[^"\r\n])*"|\[[^\]\r\n]+\]|[a-zA-Z_][a-zA-Z_0-9]*(?=\s*\()|\b(?:true|false|AND|OR)\b|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+\-]?\d+)?|>=|<=|!=|[=<>]/gi;
        let html = ''; let offset = 0;
        for (const match of source.matchAll(tokens)) { const token = match[0]; const kind = token[0] === '[' ? 'field' : token[0] === '"' ? 'string' : /^[.\d]/.test(token) ? 'number' : /^[a-z_]+$/i.test(token) && !/^(true|false|and|or)$/i.test(token) ? 'function' : 'operator'; html += e(source.slice(offset, match.index)) + `<span class="mb-expression-token ${kind}">${e(token)}</span>`; offset = match.index + token.length; }
        layer.innerHTML = html + e(source.slice(offset)) + '\n'; layer.scrollTop = editor.scrollTop; layer.scrollLeft = editor.scrollLeft;
    },
    formatExpressionFormula() {
        if (!this.expressionValid) return;
        const editor = this.expressionEditorTextarea(); const tokens = editor.value.match(/"(?:""|[^"\r\n])*"|\[[^\]\r\n]+\]|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+\-]?\d+)?|[a-zA-Z_][a-zA-Z_0-9]*|>=|<=|!=|[=<>()+*\/,\-]/g) || [];
        let formatted = '';
        tokens.forEach((token, index) => { if (token === ')') formatted = formatted.trimEnd() + ')'; else if (token === ',') formatted = formatted.trimEnd() + ', '; else if (token === '(') formatted += /^[a-zA-Z_]+$/.test(tokens[index - 1] || '') ? '(' : (formatted && !formatted.endsWith(' ') ? ' (' : '('); else formatted += (formatted && !formatted.endsWith(' ') && !formatted.endsWith('(') ? ' ' : '') + token; });
        editor.value = formatted; editor.focus(); editor.setSelectionRange(formatted.length, formatted.length); editor.dispatchEvent(new Event('input', { bubbles: true }));
    },
    expressionCompletionContext() {
        const editor = this.expressionEditorTextarea(); if (!editor) return null; const cursor = editor.selectionStart; const prefix = editor.value.slice(0, cursor);
        // Completion belongs to an unfinished field or function at the cursor, never inside a string literal.
        let string = false; for (let index = 0; index < prefix.length; index++) { if (prefix[index] === '"') { if (string && prefix[index + 1] === '"') index++; else string = !string; } }
        if (string) return null;
        const field = prefix.match(/\[([^\]\[\r\n]*)$/);
        if (field) { const tail = editor.value.slice(cursor).match(/^[^\]\[\r\n]*\]/); return { kind: 'field', search: field[1], start: cursor - field[0].length, end: tail ? cursor + tail[0].length : cursor }; }
        const fn = prefix.match(/([a-zA-Z_][a-zA-Z_0-9]*)$/);
        if (fn) { const tail = editor.value.slice(cursor).match(/^[a-zA-Z_0-9]*/)[0]; const end = cursor + tail.length; return { kind: 'function', search: fn[1], start: cursor - fn[1].length, end, hasCall: /^\s*\(/.test(editor.value.slice(end)) }; }
        return null;
    },
    updateExpressionSuggestions() {
        const box = this.root.querySelector('[data-expression-suggestions]'); if (!box) return; const context = this.expressionCompletionContext();
        const term = context?.search.toLocaleLowerCase(); const items = !context ? [] : context.kind === 'field' ? this.expressionEditorContext.fields.filter(row => !row.hidden && (row.label.toLocaleLowerCase().includes(term) || row.key.toLocaleLowerCase().includes(term))).map(row => ({ kind: 'field', key: row.key, label: row.label, description: types[row.type] || row.type })) : expressionFunctions.filter(row => row.key.toLocaleLowerCase().startsWith(term)).map(row => ({ kind: 'function', key: row.key, label: row.key, description: row.description }));
        this.expressionSuggestions = items.slice(0, 12); this.expressionSuggestionIndex = Math.min(this.expressionSuggestionIndex || 0, Math.max(0, this.expressionSuggestions.length - 1));
        box.hidden = !this.expressionSuggestions.length; box.innerHTML = this.expressionSuggestions.map((row, index) => `<button type="button" role="option" aria-selected="${index === this.expressionSuggestionIndex}" data-action="acceptExpressionSuggestion" data-index="${index}"><strong ${row.kind === 'function' ? 'dir="ltr"' : ''}>${row.kind === 'field' ? icon('table') : 'ƒ '}${e(row.label)}</strong><small>${e(row.description)}</small></button>`).join('');
        const editor = this.expressionEditorTextarea(); if (editor) { editor.setAttribute('aria-expanded', String(!box.hidden)); editor.setAttribute('aria-autocomplete', 'list'); }
    },
    acceptExpressionSuggestion(target) {
        const row = this.expressionSuggestions?.[Number(target.dataset.index)]; const context = this.expressionCompletionContext(); if (!row || !context) return;
        const name = readableFieldName(this.expressionEditorContext.fields.find(column => column.key === row.key), this.expressionEditorContext.fields);
        const text = row.kind === 'field' ? `[${name}]` : context.hasCall ? row.key : row.key + '()'; this.insertExpressionText(text, context.start, context.end, row.kind === 'function' && !context.hasCall ? -1 : 0);
    },
    insertExpressionText(text, start, end, cursorOffset = 0) {
        const editor = this.expressionEditorTextarea(); if (!editor) return; const from = start ?? editor.selectionStart; const to = end ?? editor.selectionEnd;
        editor.setRangeText(text, from, to, 'end'); const cursor = from + text.length + cursorOffset; editor.setSelectionRange(cursor, cursor); editor.focus(); editor.dispatchEvent(new Event('input', { bubbles: true }));
        this.root.querySelector('[data-expression-suggestions]').hidden = true;
    },
    insertExpressionField(target) { const fields = this.expressionEditorContext.fields; const name = readableFieldName(fields.find(column => column.key === target.dataset.key), fields); if (name) this.insertExpressionText('[' + name + ']'); },
    insertExpressionFunction(target) { const fn = expressionFunctions.find(row => row.key === target.dataset.key); if (fn) { this.insertExpressionText(fn.key + '()', undefined, undefined, -1); this.expressionActiveFunction = fn.key; this.updateExpressionHelp(); } },

    updateExpressionHelp() {
        const editor = this.expressionEditorTextarea(); const box = this.root.querySelector('[data-expression-help]'); if (!editor || !box) return;
        const before = editor.value.slice(0, editor.selectionStart); const functions = [...before.matchAll(/([a-zA-Z_]+)\s*\(/g)]; const name = functions.at(-1)?.[1] || this.expressionActiveFunction;
        const fn = expressionFunctions.find(row => row.key.toLowerCase() === name?.toLowerCase());
        box.innerHTML = fn ? `<div class="mb-expression-help-signature" dir="ltr"><code>${e(fn.signature)}</code></div><p class="mb-expression-help-description">${e(fn.description)}</p><div class="mb-expression-help-example"><small>مثال</small><pre dir="ltr"><code>${e(fn.example)}</code></pre></div>` : '<p class="mb-expression-help-description">برای پذیرش پیشنهاد Enter یا Tab را بزنید.</p><div class="mb-expression-help-signature" dir="ltr"><code>+ − * / = != &gt; &gt;= &lt; &lt;= AND OR</code></div>';
    },

async saveExpression() {
        clearTimeout(this.expressionValidationTimer); const editor = this.expressionEditorTextarea(); const form = this.form(); this.expressionDraft.expression = editor.value; this.expressionDraft.label = String(form.get('label') || '').trim();
        if (!this.expressionDraft.label || !this.expressionDraft.expression.trim()) throw new Error('نام و فرمول ستون را وارد کنید.');
        const context = this.expressionEditorContext; const q = this.expressionCandidate(); const stage = context.stageIndex === null ? q : q.stages[context.stageIndex]; const row = stage.expressions.find(expression => expression.key === this.expressionDraft.key);
        const names = new Set(stage.expressions.filter(expression => expression.key !== row.key).map(expression => expression.label)); const original = row.label;
        for (let suffix = 2; names.has(row.label); suffix++) row.label = original.slice(0, 140) + ' (' + suffix + ')';
        if (stage.mode === 'rows' && stage.columns && stage.columns.length < 50 && !stage.columns.includes(row.key)) stage.columns.push(row.key);
        const result = await this.request('reports/expression/validate', 'POST', { query_definition: q, expression_key: row.key, stage_index: context.stageIndex });
        const canonical = result.query_definition || q; const canonicalStage = context.stageIndex === null ? canonical : canonical.stages[context.stageIndex]; canonicalStage.expressions.find(expression => expression.key === row.key).type = result.type;
        this.expressionValidationRevision++;
        if (context.onSave) await context.onSave(canonical); else { this.report.query_definition = canonical; this.queryUpdated(); }
        if (canonicalStage.mode === 'rows' && canonicalStage.columns && !canonicalStage.columns.includes(row.key)) this.toast('ستون محاسباتی ساخته شد. برای نمایش آن، انتخاب ستون‌ها را تنظیم کنید؛ حداکثر ۵۰ ستون نمایش داده می‌شود.');
    },
};
