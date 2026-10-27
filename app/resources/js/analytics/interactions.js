import { e, copy, icon, button, iconButton, columnValueText, operators } from "./ui";
import { notebookFlowMethods } from "./notebook-flow";
import { cleanDrillContext as cleanContext, formatDrillNumber, copyPresentationSettings, clickPresentation, captureDrillPresentation, nextDrillPresentation } from './drill-presentation';
import { isCurrentFilamentModal } from './filament-modal';

const groups = { records: 'رکوردها', quick_filter: 'فیلتر این مقدار', filter: 'فیلتر', zoom: 'بزرگ‌نمایی زمانی', breakout: 'تفکیک بر اساس', sort: 'مرتب‌سازی', distribution: 'توزیع', summarize: 'خلاصه‌سازی' };

const drillColorDot = context => { const color = clickPresentation(context).color; return color ? '<span class="mb-drill-color-dot" data-drill-color="' + color + '" style="background-color:' + color + '" aria-hidden="true"></span>' : ''; };
export const interactionMethods = {
    initializeInteractions() {
        this.root.addEventListener('input', event => { if (event.target.matches('[data-drill-action-search]')) this.root.querySelectorAll('[data-drill-menu] [data-drill-action]').forEach(node => { node.hidden = !node.textContent.toLocaleLowerCase().includes(event.target.value.toLocaleLowerCase()); }); });
        this.drillOutsideHandler = event => { if (!event.target.closest('[data-drill-menu]') && !event.target.closest('.mb-data-clickable') && !event.target.closest('[data-table-sort]') && !event.target.closest('.fi-theme-switcher') && !event.target.closest('.fi-user-menu .fi-dropdown-trigger')) this.closeDrillMenu(); };
        document.addEventListener('pointerdown', this.drillOutsideHandler);
        this.drillKeydownHandler = event => { if (event.key === 'Escape' && !event.target.closest?.('.fi-dropdown-panel, .fi-user-menu') && this.root.isConnected && this.root.querySelector('[data-drill-menu]')) { event.preventDefault(); this.closeDrillMenu(true); } };
        document.addEventListener('keydown', this.drillKeydownHandler);
    },
    closeDrillMenu(restoreFocus = false) { this.drillMenuRevision = (this.drillMenuRevision || 0) + 1; this.root.querySelector('[data-drill-menu]')?.remove(); if (restoreFocus === true) this.drillAnchor?.focus({ preventScroll: true }); },
    runtimeVisualizationSettings(result, definition, settings = {}, widget = null) {
        let dimensions = [];
        for (const stage of [definition, ...(definition?.stages || [])]) if (stage?.mode === 'aggregate') dimensions = stage.dimensions || [];
        const keys = new Set(result.columns.map(column => column.key));
        const metadata = Object.fromEntries(result.columns.map(column => [column.key, column]));
        const connection = this.library.connections.find(row => row.id === definition?.connection_id);
        for (const column of connection?.catalog?.find(table => table.key === definition?.source)?.fields || []) metadata[column.key] = { ...column, ...metadata[column.key] };
        const runtime = { ...settings, _dimension_keys: definition?.mode === 'native' ? undefined : dimensions.map(dimension => dimension.field).filter(key => keys.has(key)), _field_metadata: metadata };
        if (widget) {
            runtime._can_click_column = key => this.resolveWidgetClickBehavior(widget, key).type !== 'none';
            runtime._cell_labels = (row, key) => {
                const behavior = this.resolveWidgetClickBehavior(widget, key);
                return behavior.link_text ? this.interpolateClickTemplate(behavior.link_text, row, { parameters: this.appliedValues, column_key: key, value: row[key] }, { encode: false }) : null;
            };
            runtime._cell_title = key => ({ filter: 'تغییر فیلترهای داشبورد', dashboard: 'رفتن به داشبورد', report: 'رفتن به پرسش', url: 'باز کردن لینک', menu: 'بررسی این مقدار' })[this.resolveWidgetClickBehavior(widget, key).type] || '';
        }
        return runtime;
    },
    renderPreview() {
        this.charts.forEach(chart => chart.destroy()); this.charts = [];
        if (!this.previewResult) return;
        const result = this.previewResult;
        this.draw(this.root.querySelector('.mb-preview-body'), result, this.report.display, this.runtimeVisualizationSettings(result, this.report.query_definition, this.report.visualization_settings), (row, context) => this.reportResultClicked(row, context));
        const meta = this.root.querySelector('.mb-result-meta');
        if (meta) meta.textContent = result.rows.length + ' ردیف • ' + (result.meta?.duration_ms ?? 0) + ' ms' + (result.meta?.truncated ? ' • نتیجه محدود شده' : '');
    },
    reportHtml() {
        const readonly = this.drillSession && !this.library.connections.some(connection => connection.id === this.report.query_definition.connection_id);
        const content = readonly ? '<header class="mb-toolbar"><h1>' + e(this.report.name) + '</h1>' + button(icon('code') + 'SQL', 'showSql') + '</header><section class="mb-preview mb-question-result"><div class="mb-preview-body"></div><footer class="mb-preview-meta"><span class="mb-result-meta"></span>' + button(icon('download') + 'دریافت نتیجه', 'exportReport', 'small') + '</footer></section>' : notebookFlowMethods.reportHtml.call(this);
        if (!this.drillSession || this.drillSession.currentIndex < 0 || this.view !== 'report') return content;
        const frames = this.drillSession.frames;
        return '<div class="mb-drill-view"><nav class="mb-drill-breadcrumb" data-drill-breadcrumb aria-label="مسیر بررسی داده"><button class="mb-btn" data-action="returnFromDrill">' + icon('back') + 'بازگشت به ' + (this.drillSession.origin.kind === 'widget' ? 'داشبورد' : 'پرسش') + '</button><div>' + frames.map((frame, index) => '<button data-action="goDrillHistory" data-index="' + index + '" class="' + (index === this.drillSession.currentIndex ? 'active' : '') + '">' + drillColorDot(frame.selection) + e(frame.label) + '</button>').join('<span> / </span>') + '</div></nav>' + content + '</div>';
    },
    sourceSnapshot() {
        return { view: this.view, report: this.report ? copy(this.report) : null, reportOriginal: this.reportOriginal ? copy(this.reportOriginal) : null, previewResult: this.previewResult, notebookOpen: this.notebookOpen, dirty: this.dirty, editing: this.editing, activeTab: this.activeTab, filterValues: this.filterValues ? copy(this.filterValues) : {}, appliedValues: this.appliedValues ? copy(this.appliedValues) : {}, hash: window.location.hash };
    },
    startDrillSession(origin) {
        this.drillSession = { origin: { ...origin, settings: copyPresentationSettings(origin.settings) }, source: this.sourceSnapshot(), path: [], frames: [], currentIndex: -1 };
        return this.drillSession;
    },
    currentDrillPresentation(session) {
        const frame = session.frames[session.currentIndex];
        if (this.root.querySelector('.mb-dialog[data-object-detail][open]') && this.objectDetailFrame) return { display: this.objectDetailFrame.display || 'table', settings: this.objectDetailFrame.settings || frame?.settings || session.origin.settings, selection: this.objectDetailFrame.selection || frame?.selection };
        if (this.view === 'report' && session === this.drillSession && session.currentIndex >= 0) return { display: this.report.display, settings: this.report.visualization_settings, selection: frame?.selection };
        return { display: frame?.display || session.origin.display, settings: frame?.settings || session.origin.settings, selection: frame?.selection };
    },
    rebaseEditedDrill(result) {
        const session = this.drillSession;
        if (!session || session.currentIndex < 0 || JSON.stringify(result.query_definition) === JSON.stringify(session.frames[session.currentIndex]?.query_definition)) return;
        session.origin = { kind: 'report', definition: copy(result.query_definition), name: this.report.name, display: this.report.display, settings: copy(this.report.visualization_settings) };
        session.path = []; session.frames = [{ query_definition: result.query_definition, result, display: this.report.display, settings: copyPresentationSettings(this.report.visualization_settings), selection: session.frames[session.currentIndex]?.selection, label: 'پرسش ویرایش‌شده', path: [] }]; session.currentIndex = 0;
    },
    async reportResultClicked(row, context) {
        try {
            const session = this.drillSession && this.drillSession.currentIndex >= 0 ? this.drillSession : this.startDrillSession({ kind: 'report', definition: copy(this.report.query_definition), name: this.report.name, display: this.report.display, settings: copy(this.report.visualization_settings) });
            await this.openDrillMenu(session, context);
        } catch (error) { this.toast(error.message, true); }
    },
    async cardClicked(widget, row, context = {}) {
        if (this.editing) return;
        const sourceEpoch = this.epoch; const sourceDashboardId = this.dashboard.id;
        try {
            const report = this.dashboardReport(widget.report_id); const result = this.results.get(widget.key);
            if (!context.column_key) context = { column_key: Object.keys(row || {})[0], row_index: result?.rows.findIndex(item => JSON.stringify(item) === JSON.stringify(row)) ?? 0, kind: 'cell', result_signature: result?.meta?.result_signature };
            const behavior = context.kind === 'header' ? { type: 'menu' } : this.resolveWidgetClickBehavior(widget, context.column_key);
            if (behavior.type === 'none') return;
            if (behavior.type === 'filter') {
                const values = {};
                for (const mapping of behavior.mappings || []) {
                    const filter = this.dashboard.filters.find(filter => filter.key === mapping.target);
                    if (!filter) throw new Error('فیلتر مقصد وجود ندارد.');
                    const value = this.mappingSourceValue(mapping, row, { parameters: this.appliedValues });
                    values[filter.key] = this.clickFilterValue(filter, value, mapping, report, result);
                }
                this.setDashboardFilterValues(values);
                return;
            }
            if (behavior.type === 'dashboard') {
                const destination = await this.request('dashboards/' + behavior.dashboard_id);
                if (sourceEpoch !== this.epoch || sourceDashboardId !== this.dashboard?.id) return;
                const values = {};
                for (const mapping of behavior.mappings || []) {
                    const filter = destination.filters.find(filter => filter.key === mapping.target);
                    if (!filter) throw new Error('فیلتر مقصد وجود ندارد.');
                    values[filter.key] = this.clickFilterValue(filter, this.mappingSourceValue(mapping, row, { parameters: this.appliedValues }), mapping, report, result);
                }
                await this.openDashboard({ dataset: { id: destination.id } }, values);
                return;
            }
            if (behavior.type === 'report') { await this.navigateClickReport(widget, behavior, row, context); return; }
            if (behavior.type === 'url') {
                const url = this.interpolateClickTemplate(behavior.url, row, { parameters: this.appliedValues, column_key: context.column_key, value: row?.[context.column_key] });
                const parsed = new URL(url); if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('لینک معتبر نیست.');
                window.open(parsed.href, '_blank', 'noopener,noreferrer'); return;
            }
            const session = this.startDrillSession({ kind: 'widget', dashboard_id: this.dashboard.id, widget_key: widget.key, parameters: copy(this.appliedValues), name: widget.settings.title || report.name, display: widget.settings.display || report.display, settings: { ...report.visualization_settings, ...widget.settings } });
            await this.openDrillMenu(session, context);
        } catch (error) { this.toast(error.message, true); }
    },
    clickFilterValue(filter, value, mapping, report, result = null) {
        if (value === undefined) throw new Error('مقدار ستون کلیک‌شده پیدا نشد.');
        if (value === null) return mapping.source === 'parameter' ? null : { kind: 'null' };
        if (value === '' && mapping.source === 'column' && filter.type === 'text') return { kind: 'empty' };
        if (value?.kind || Array.isArray(value)) return copy(value);
        const operator = filter.bindings[0]?.operator || 'eq';
        if (['in', 'not_in'].includes(operator)) return [value];
        if (['between', 'not_between'].includes(operator)) {
            const outputColumn = result?.columns.find(column => column.key === mapping.key);
            const dimension = [report.query_definition, ...(report.query_definition.stages || [])].reverse().map(stage => (stage.dimensions || []).find(dimension => dimension.field === mapping.key)).find(Boolean);
            const grain = outputColumn && Object.hasOwn(outputColumn, 'grain') ? outputColumn.grain : dimension?.grain;
            if (filter.type === 'date' && grain) return this.clickedDateRange(value, grain);
            return [value, value];
        }
        return filter.type === 'date' ? String(value).slice(0, 10) : value;
    },
    clickedDateRange(value, grain) {
        const start = new Date(String(value).slice(0, 10) + 'T00:00:00Z'); const end = new Date(start);
        if (grain === 'week') end.setUTCDate(end.getUTCDate() + 6);
        if (grain === 'month') end.setUTCMonth(end.getUTCMonth() + 1, 0);
        if (grain === 'quarter') { end.setUTCMonth(end.getUTCMonth() + 3, 0); }
        if (grain === 'year') end.setUTCFullYear(end.getUTCFullYear() + 1, 0, 0);
        return [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)];
    },
    async navigateClickReport(widget, behavior, row, context) {
        const sourceEpoch = this.epoch; const sourceDashboardId = this.dashboard.id; const parameters = copy(this.appliedValues);
        const navigationContext = cleanContext(context);
        const navigation = await this.request('dashboards/' + sourceDashboardId + '/widgets/' + widget.key + '/click-report', 'POST', { parameters, context: navigationContext });
        if (sourceEpoch !== this.epoch || sourceDashboardId !== this.dashboard?.id) return;
        const target = navigation.report;
        this.startDrillSession({ kind: 'widget', dashboard_id: this.dashboard.id, widget_key: widget.key, parameters: copy(this.appliedValues), navigation_context: navigationContext, name: target.name, display: target.display, settings: target.visualization_settings });
        this.showDrillFrame({ query_definition: navigation.query_definition, result: navigation.result, display: target.display, label: target.name }, []);
    },
    async interactionRequest(session, suffix, context, actionId = null, inputData = null, requestPath = session.path) {
        const origin = session.origin;
        const path = origin.kind === 'widget' ? 'dashboards/' + origin.dashboard_id + '/widgets/' + origin.widget_key + '/interactions/' + suffix : 'reports/interactions/' + suffix;
        const data = { context: cleanContext(context), path: requestPath.slice(0, 8) };
        if (origin.kind === 'widget') { data.parameters = origin.parameters; if (origin.navigation_context) data.navigation_context = origin.navigation_context; }
        else data.query_definition = origin.definition;
        if (actionId) data.action_id = actionId;
        if (inputData) data.input = inputData;
        return this.request(path, 'POST', data);
    },
    positionDrillMenu(menu, context) {
        const rect = context.anchor?.getBoundingClientRect();
        const event = context.event;
        const x = event?.clientX || rect?.left || window.innerWidth / 2;
        const y = event?.clientY || rect?.bottom || 130;
        const width = Math.min(330, window.innerWidth - 24);
        menu.style.width = width + 'px'; menu.style.left = Math.max(12, Math.min(x - width / 2, window.innerWidth - width - 12)) + 'px';
        menu.style.top = Math.max(12, Math.min(y + 8, window.innerHeight - Math.min(menu.scrollHeight, 540) - 12)) + 'px';
    },
    async openDrillMenu(session, context) {
        this.closeDrillMenu(); const revision = this.drillMenuRevision;
        const presentation = captureDrillPresentation(this.currentDrillPresentation(session), context);
        const displayContext = clickPresentation(context);
        this.drillAnchor = context.anchor;
        this.drillMenuAnchorContext = context;
        const menu = document.createElement('div'); menu.className = 'mb-drill-menu'; menu.dataset.drillMenu = ''; menu.setAttribute('role', 'dialog'); menu.setAttribute('aria-label', 'بررسی داده'); menu.innerHTML = '<div class="mb-drill-loading" role="status">در حال بررسی عملیات این ستون…</div>';
        menu.addEventListener('keydown', event => { if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || event.target.tagName === 'INPUT') return; const items = [...menu.querySelectorAll('[data-drill-action]:not([hidden]):not(:disabled)')]; if (!items.length) return; event.preventDefault(); const index = items.indexOf(document.activeElement); const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length; items[next].focus(); });
        (this.root.querySelector('.mb-dialog[open]') || this.root).append(menu); this.positionDrillMenu(menu, context);
        try {
            const response = await this.interactionRequest(session, 'options', context);
            if (revision !== this.drillMenuRevision || !menu.isConnected) return;
            this.drillMenuData = { session, path: copy(session.path), context: cleanContext(response.context), response, presentation, display_context: displayContext };
            menu.innerHTML = this.drillOptionsHtml(response, context);
            this.positionDrillMenu(menu, context);
            menu.querySelector('[data-drill-action]')?.focus({ preventScroll: true });
        } catch (error) { if (revision === this.drillMenuRevision) { menu.innerHTML = '<p role="alert">' + e(error.message) + '</p>' + button('بستن', 'closeDrillMenu'); } }
    },
    drillOptionsHtml(response, context, breakoutOnly = false) {
        const order = ['records', 'zoom', 'sort', 'breakout', 'distribution', 'summarize', 'filter', 'quick_filter'];
        const actions = breakoutOnly ? response.actions.filter(action => action.group === 'breakout') : response.actions;
        const sectionKeys = [...new Set(actions.map(action => action.group))].sort((left, right) => order.indexOf(left) - order.indexOf(right));
        const label = action => ['number', 'date', 'boolean'].includes(response.context.type) && action.group === 'quick_filter' ? ({ 'filter:lt': '<', 'filter:gt': '>', 'filter:eq': '=', 'filter:neq': '≠' })[action.id] || action.label : action.label;
        const actionHtml = (action, group) => '<button type="button" data-action="applyDrill" data-drill-action="' + e(action.id) + '" title="' + e(action.label) + '" aria-label="' + e(action.label) + '">' + (group === 'quick_filter' ? '' : icon(({ records: 'table', sort: 'sort', zoom: 'calendar', filter: 'filter', breakout: 'join', summarize: 'number', distribution: 'bar' })[group])) + e(label(action)) + '</button>';
        const selection = clickPresentation(context);
        const presentation = this.drillMenuData?.presentation || { settings: this.report?.visualization_settings || {}, display: this.report?.display };
        const formatted = response.context.type === 'number' ? formatDrillNumber(response.context.value, presentation.settings, presentation.display) : null;
        const value = response.context.row_index == null && response.context.kind !== 'total' ? 'عملیات ستون' : formatted ?? columnValueText({ type: response.context.type }, response.context.value);
        const percentage = selection.percentage == null ? '' : ' · ' + new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 }).format(selection.percentage) + '٪';
        return '<header>' + drillColorDot(selection) + '<div><strong>' + e(breakoutOnly ? 'تفکیک بر اساس' : selection.series_label || response.context.column_label || context.column_key) + '</strong><small>' + e(value + percentage) + '</small></div>' + (breakoutOnly ? iconButton('back', 'بازگشت به عملیات', 'returnDrillMenu') : iconButton('close', 'بستن منوی بررسی', 'closeDrillMenu')) + '</header>' + (breakoutOnly ? '<label class="mb-search">' + icon('search') + '<input data-drill-action-search placeholder="جست‌وجوی ستون…" aria-label="جست‌وجوی ستون برای تفکیک"></label>' : '') + sectionKeys.map(group => '<section class="mb-drill-group"><h3>' + e(groups[group] || group) + '</h3><div class="' + (group === 'quick_filter' || group === 'sort' ? 'mb-drill-quick' : '') + '">' + (group === 'breakout' && !breakoutOnly ? '<button type="button" data-action="showDrillBreakouts">' + icon('join') + 'تفکیک بر اساس…' + '</button>' : actions.filter(action => action.group === group).map(action => actionHtml(action, group)).join('')) + '</div></section>').join('') + (!actions.length ? '<p class="mb-help">عملیاتی برای این ستون در دسترس نیست.</p>' : '');
    },
    showDrillBreakouts() {
        const menu = this.root.querySelector('[data-drill-menu]'); if (!menu || !this.drillMenuData) return;
        menu.innerHTML = this.drillOptionsHtml(this.drillMenuData.response, { ...this.drillMenuData.context, ...this.drillMenuData.display_context }, true); this.positionDrillMenu(menu, this.drillMenuAnchorContext || {});
        menu.querySelector('input')?.focus({ preventScroll: true });
    },
    returnDrillMenu() {
        const menu = this.root.querySelector('[data-drill-menu]'); if (!menu || !this.drillMenuData) return;
        menu.innerHTML = this.drillOptionsHtml(this.drillMenuData.response, { ...this.drillMenuData.context, ...this.drillMenuData.display_context }); this.positionDrillMenu(menu, this.drillMenuAnchorContext || {});
        menu.querySelector('[data-drill-action]')?.focus({ preventScroll: true });
    },
    async applyDrill(target) {
        const actionId = target.dataset.drillAction; const data = target.closest('[data-object-related]') ? this.objectRelatedData : this.drillMenuData;
        if (!data) throw new Error('مقدار انتخاب‌شده دیگر در دسترس نیست؛ دوباره کلیک کنید.');
        const action = data.response.actions.find(action => action.id === actionId);
        if (!action) throw new Error('عملیات بررسی معتبر نیست.');
        if (action.requires_input) { this.drillFilterData = { ...data, action }; this.closeDrillMenu(); this.drillFilterDialog(); return; }
        await this.performDrill(data, action);
    },
    async performDrill(data, action, inputData = null) {
        if (this.drillApplying) return;
        const requestPath = data.path || data.session.path;
        if (requestPath.length >= 8) throw new Error('این مسیر به هشت مرحله رسیده است؛ به مرحلهٔ قبل برگردید.');
        this.drillApplying = true;
        const sourceEpoch = this.epoch;
        const sourceIndex = data.session.currentIndex;
        let result;
        try { result = await this.interactionRequest(data.session, 'apply', data.context, action.id, inputData, requestPath); }
        finally { this.drillApplying = false; }
        if (data.session !== this.drillSession || sourceEpoch !== this.epoch || sourceIndex !== data.session.currentIndex) return;
        const path = [...requestPath, { context: data.context, action_id: action.id, ...(inputData ? { input: inputData } : {}) }];
        this.closeDrillMenu(); this.closeModal();
        const presentation = nextDrillPresentation(data.presentation || this.currentDrillPresentation(data.session), result);
        const frame = { ...result, ...presentation, label: inputData?.operator ? (data.response.context.column_label || data.context.column_key) + ' ' + (operators[inputData.operator] || action.label) : action.label, path };
        if (['object_details', 'foreign_details'].includes(action.id)) { data.session.path = path; await this.showObjectDetails(frame); }
        else this.showDrillFrame(frame, path);
    },
    showDrillFrame(frame, path) {
        this.navigationEpoch++;
        const session = this.drillSession;
        const presentation = nextDrillPresentation(this.currentDrillPresentation(session), frame);
        frame = { ...frame, ...presentation };
        session.frames = session.frames.slice(0, session.currentIndex + 1); session.frames.push({ ...frame, path }); session.currentIndex = session.frames.length - 1; session.path = path;
        this.report = { name: session.origin.name + ' — بررسی', description: '', folder_id: null, display: frame.display, visualization_settings: copyPresentationSettings(frame.settings), query_definition: frame.query_definition };
        this.reportOriginal = copy(this.report); this.previewResult = frame.result; this.notebookOpen = false; this.notebookSections = new Set(); this.stepPreviewResults = {}; this.view = 'report'; this.editing = false; this.dirty = false;
        this.render();
    },
    goDrillHistory(target) {
        const index = Number(target.dataset.index); const session = this.drillSession; const frame = session?.frames[index]; if (!frame) return;
        session.frames = session.frames.slice(0, index); session.currentIndex = index - 1;
        this.showDrillFrame(frame, frame.path);
    },
    returnFromDrill() {
        const session = this.drillSession; if (!session) return;
        const source = session.source;
        Object.assign(this, source); delete this.hash; this.drillSession = null; this.closeModal(); this.closeDrillMenu();
        this.render();
    },
    async showObjectDetails(frame) {
        this.objectDetailFrame = frame;
        const result = frame.result; const row = result.rows[0];
        if (!row) throw new Error('این رکورد دیگر وجود ندارد.');
        this.modal(frame.record.table_label + ' — جزئیات رکورد', '<div class="mb-object-details">' + result.columns.map(column => '<div class="mb-object-field"><strong>' + e(column.label) + '</strong><button type="button" class="mb-object-value" data-action="objectFieldClicked" data-column="' + e(column.key) + '">' + e(columnValueText(column, row[column.key])) + '</button></div>').join('') + '</div><section class="mb-object-related"><h3>رکوردهای مرتبط</h3><div data-object-related>در حال بررسی ارتباط‌ها…</div></section>', button(icon('download') + 'دریافت CSV', 'exportObjectDetails'), false, true);
        const dialog = this.root.querySelector('.mb-dialog'); dialog.dataset.objectDetail = '';
        const modalGeneration = dialog.dataset.analyticsModalGeneration;
        const connection = this.library.connections.find(connection => connection.id === frame.query_definition.connection_id);
        const primary = connection?.catalog?.find(table => table.key === frame.record.table_key)?.fields.find(column => column.primary)?.key || result.columns.find(column => column.primary)?.key || 'id';
        let response;
        try { response = await this.interactionRequest(this.drillSession, 'options', { column_key: primary, row_index: 0, kind: 'cell', result_signature: result.meta?.result_signature }); }
        catch (error) {
            if (!isCurrentFilamentModal(dialog, modalGeneration)) return;
            throw error;
        }
        if (!isCurrentFilamentModal(dialog, modalGeneration)) return;
        this.drillMenuData = { session: this.drillSession, path: copy(this.drillSession.path), context: cleanContext(response.context), response, presentation: captureDrillPresentation({ display: frame.display || 'table', settings: frame.settings, selection: frame.selection }) };
        this.objectRelatedData = this.drillMenuData;
        dialog.querySelector('[data-object-related]').innerHTML = response.actions.filter(action => action.id.startsWith('related:')).map(action => button(icon('table') + e(action.label), 'applyDrill', '', 'data-drill-action="' + e(action.id) + '"')).join('') || '<p class="mb-help">جدول مرتبطی برای این رکورد تعریف نشده است.</p>';
    },
    objectDetailClosed() { const session = this.drillSession; if (session) session.path = session.frames[session.currentIndex]?.path || []; this.objectRelatedData = null; },
    async objectFieldClicked(target) {
        const frame = this.objectDetailFrame;
        await this.openDrillMenu(this.drillSession, { column_key: target.dataset.column, row_index: 0, kind: 'cell', anchor: target, result_signature: frame.result.meta?.result_signature });
    },
    exportObjectDetails() { this.exportResult(this.objectDetailFrame.result, this.objectDetailFrame.record.table_label); },

};

