import { GridStack } from 'gridstack';
import { e, copy, uid, icon, button, iconButton, markdown, tableHtml } from "./ui";

export const dashboardMethods = {

async openDashboard(target, navigation = null) {
        if (this.dirty) { this.confirm('تغییرات ذخیره‌نشده', 'تغییرات ذخیره نشده کنار گذاشته شود؟', async () => { this.dirty = false; await this.openDashboard(target, navigation); }); return false; }
        const opening = ++this.navigationEpoch;
        const dashboard = await this.request(`dashboards/${target.dataset.id}`);
        if (opening !== this.navigationEpoch) return false;
        this.drillSession = null;
        this.dashboard = dashboard;
        if (this.dashboardReadOnly) {
            this.dashboard.can_edit = false;
            this.dashboard.is_owner = false;
        }
        this.dashboard.settings = { ...this.dashboard.settings };
        this.dashboard.widgets.forEach(widget => { widget.settings = { ...widget.settings }; widget.click_behavior = { ...widget.click_behavior }; });
        this.dashboard.filters.forEach(filter => filter.settings = { ...filter.settings });
        this.dashboardNavigation = navigation;
        this.mappingFilter = null; this.savedDashboard = copy(this.dashboard); this.activeTab = this.dashboard.tabs[0].key; this.editing = false; this.dirty = false; this.filterValues = { ...Object.fromEntries(this.dashboard.filters.map(filter => [filter.key, copy(filter.default_value)])), ...(navigation || {}) }; this.appliedValues = copy(this.filterValues); this.results.clear(); this.view = 'dashboard'; this.render();
        return true;
    },
    dashboardReport(id) { return this.dashboard.reports?.find(row => row.id === id) || this.library.reports.find(row => row.id === id); },
    dashboardHtml() {
        const dashboard = this.dashboard; const editing = this.editing;
        const toolbar = this.dashboardReadOnly ? '' : `<header class="mb-toolbar"><div><h1>${e(dashboard.name)}</h1>${dashboard.description ? `<small>${e(dashboard.description)}</small>` : ''}</div><div class="mb-actions">${editing ? '' : iconButton('refresh', 'تازه‌سازی داده', 'refreshDashboard') + iconButton('expand', 'تمام صفحه', 'toggleFullscreen')}${!editing && dashboard.can_edit ? button(icon('edit') + 'ویرایش داشبورد', 'editDashboard') + iconButton('history', 'تاریخچه', 'showRevisions') : ''}${!editing && dashboard.is_owner ? iconButton('copy', 'کپی داشبورد', 'copyDashboard') + button(icon('share') + 'اشتراک‌گذاری', 'shareDashboard') : ''}</div></header>`;
        return `${toolbar}
        ${editing ? `<div class="mb-editbar"><div class="mb-actions">${button(icon('plus') + 'افزودن گزارش', 'addReportCard')}${button(icon('text') + 'متن', 'addTextCard')}${button(icon('link') + 'لینک', 'addLinkCard')}${button(icon('filter') + 'فیلتر', 'addDashboardFilter')}${button(icon('settings') + 'تنظیمات', 'dashboardSettings')}</div><div class="mb-actions"><span class="mb-dirty">${this.dirty ? 'تغییرات ذخیره نشده' : 'حالت ویرایش'}</span>${button('انصراف', 'cancelDashboard')}${button('ذخیره', 'saveDashboard', 'primary', window.innerWidth < 768 ? 'disabled title="چیدمان را در نمایش دسکتاپ ذخیره کنید"' : '')}</div></div>` : ''}
        ${dashboard.filters.length ? `<div class="mb-filterbar">${dashboard.filters.map(filter => this.filterHtml(filter)).join('')}${!editing && dashboard.settings.auto_apply === false ? button('اعمال فیلترها', 'applyFilters', 'primary') : ''}${button('بازنشانی', 'resetFilters', 'small')}</div>` : ''}
        <nav class="mb-tabs">${dashboard.tabs.map(tab => `<div class="mb-tab ${this.activeTab === tab.key ? 'active' : ''}"><button data-action="switchTab" data-key="${e(tab.key)}">${e(tab.name)}</button>${editing ? iconButton('edit', 'تنظیم تب', 'editTab', `data-key="${e(tab.key)}"`) : ''}</div>`).join('')}${editing ? iconButton('plus', 'تب جدید', 'addTab') : ''}</nav>
        <div class="mb-canvas ${editing ? 'editing' : ''}" ${dashboard.settings.width === 'fixed' ? 'style="max-width:1200px;margin:auto"' : ''}><div class="grid-stack">${dashboard.widgets.filter(widget => widget.tab_key === this.activeTab).map(widget => this.cardHtml(widget)).join('')}</div>${!dashboard.widgets.some(widget => widget.tab_key === this.activeTab) ? `<div class="mb-empty">${icon('dashboard')}<strong>گزارش‌ها را کنار هم قرار دهید</strong>${editing ? 'از «افزودن گزارش» برای ساخت این صفحه استفاده کنید.' : 'این تب هنوز کارتی ندارد.'}</div>` : ''}</div>`;
    },

    cardHtml(widget) {
        const report = this.dashboardReport(widget.report_id); const title = widget.settings.title || report?.name || ({ text: 'متن', heading: 'عنوان', link: 'لینک' })[widget.type];
        return `<div class="grid-stack-item" gs-id="${e(widget.key)}" gs-x="${widget.x}" gs-y="${widget.y}" gs-w="${widget.w}" gs-h="${widget.h}" gs-min-w="2" gs-min-h="2"><article class="grid-stack-item-content mb-card" data-widget="${e(widget.key)}"><header class="mb-card-header"><span class="mb-card-title">${e(title)}</span><div class="mb-card-tools">${this.editing ? iconButton('settings', 'تنظیم کارت', 'cardSettings', `data-key="${e(widget.key)}"`) + iconButton('copy', 'کپی کارت', 'duplicateCard', `data-key="${e(widget.key)}"`) + iconButton('trash', 'حذف کارت', 'removeCard', `data-key="${e(widget.key)}"`) : widget.type === 'report' ? iconButton('download', 'خروجی کارت', 'exportCard', `data-key="${e(widget.key)}"`) + iconButton('refresh', 'تازه‌سازی کارت', 'refreshCard', `data-key="${e(widget.key)}"`) : ''}</div></header><div class="mb-card-body">${widget.type === 'report' ? '<div class="mb-loading">در حال خواندن داده…</div>' : widget.type === 'link' ? `<a class="mb-btn" href="${/^https?:\/\//i.test(widget.content) ? e(widget.content) : '#'}" target="_blank" rel="noopener noreferrer">${icon('link')}${e(widget.settings.title || widget.content)}</a>` : `<div class="mb-markdown">${markdown(widget.content)}</div>`}</div></article></div>`;
    },
    mountDashboard() {
        const epoch = this.epoch;
        this.grid = GridStack.init({ column: 24, minRow: 12, cellHeight: 36, margin: 7, mode: 'float', rtl: true, staticGrid: !this.editing || window.innerWidth < 768, handle: '.mb-card-title', resizable: { handles: 'sw,se' }, columnOpts: { columnMax: 24, breakpointForWindow: true, breakpoints: [{ w: 767, c: 1 }] } }, this.root.querySelector('.grid-stack'));
        this.grid.on('change', (_, items) => { if (!this.editing || window.innerWidth < 768) return; for (const node of items) { const widget = this.dashboard.widgets.find(row => row.key === node.id); if (widget) Object.assign(widget, { x: node.x, y: node.y, w: node.w, h: node.h }); } this.markDirty(); });
        const refresh = !!this.nextRefresh; this.nextRefresh = false;
        this.dashboard.widgets.filter(widget => widget.tab_key === this.activeTab && widget.type === 'report').forEach(widget => this.loadCard(widget, refresh, epoch));
        const seconds = Number(this.dashboard.settings.refresh_interval || 0); if (!this.editing && seconds >= 30) this.refreshTimer = setInterval(() => this.refreshDashboard(), seconds * 1000);
    },
    async loadCard(widget, refresh = false, epoch = this.epoch) {
        const container = this.root.querySelector(`[data-widget="${widget.key}"] .mb-card-body`); if (!container) return;
        const report = this.dashboardReport(widget.report_id);
        const filters = this.dashboard.filters.filter(filter => filter.bindings.some(binding => binding.widget_key === widget.key));
        const signature = JSON.stringify([this.dashboard.id, report.id, report.version, filters, Object.fromEntries(filters.map(filter => [filter.key, this.appliedValues[filter.key]]))]);
        const cached = this.cardCache.get(widget.key);
        const paint = result => { this.results.set(widget.key, result); this.draw(container, result, widget.settings.display || report.display, this.runtimeVisualizationSettings(result, report.query_definition, { ...report.visualization_settings, ...widget.settings }, widget), this.editing ? null : (row, context) => this.cardClicked(widget, row, context)); };
        if (!refresh && cached?.signature === signature && Date.now() - cached.time < 30000) { paint(cached.result); return; }
        try {
            let pending = !refresh && this.cardPromises.get(signature);
            if (!pending) {
                const query = this.editing ? this.request(`dashboards/${this.dashboard.id}/widgets/${widget.key}/preview`, 'POST', { dashboard: copy(this.dashboard), parameters: copy(this.appliedValues) }) : this.request(`dashboards/${this.dashboard.id}/widgets/${widget.key}/query`, 'POST', { parameters: copy(this.appliedValues), refresh });
                pending = query.then(result => { this.cardCache.set(widget.key, { signature, result, time: Date.now() }); return result; }).finally(() => { if (this.cardPromises.get(signature) === pending) this.cardPromises.delete(signature); });
                this.cardPromises.set(signature, pending);
            }
            const result = await pending;
            if (epoch !== this.epoch || !container.isConnected) return;
            paint(result);
        } catch (error) { if (epoch === this.epoch && container.isConnected) container.innerHTML = `<div class="mb-error" role="alert">${e(error.message)}</div>`; }
    },
    editDashboard() { if (!this.dashboard.can_edit) return; this.navigationEpoch++; this.savedDashboard = copy(this.dashboard); this.editing = true; this.dirty = false; this.render(); },
    async saveDashboard() { if (this.mappingFilter) throw new Error('ابتدا اتصال فیلتر را تمام کنید یا انصراف دهید.'); if (window.innerWidth < 768) throw new Error('برای حفظ چیدمان ۲۴ ستونی، ذخیره را در نمایش دسکتاپ انجام دهید.'); const saved = await this.request(`dashboards/${this.dashboard.id}`, 'PUT', copy(this.dashboard)); this.dashboard = { ...this.dashboard, ...saved }; this.dashboard.settings = { ...this.dashboard.settings }; this.dashboard.widgets.forEach(widget => { widget.settings = { ...widget.settings }; widget.click_behavior = { ...widget.click_behavior }; }); this.dashboard.filters.forEach(filter => { filter.settings = { ...filter.settings }; }); this.savedDashboard = copy(this.dashboard); this.dirty = false; this.editing = false; const index = this.library.dashboards.findIndex(row => row.id === this.dashboard.id); if (index >= 0) this.library.dashboards[index] = { ...this.library.dashboards[index], ...saved }; this.render(); this.toast('داشبورد ذخیره شد.'); },
    cancelDashboard() { const cancel = () => { this.mappingFilter = null; this.dashboard = copy(this.savedDashboard); this.editing = false; this.dirty = false; this.activeTab = this.dashboard.tabs.some(tab => tab.key === this.activeTab) ? this.activeTab : this.dashboard.tabs[0].key; this.filterValues = Object.fromEntries(this.dashboard.filters.map(filter => [filter.key, copy(filter.default_value)])); this.appliedValues = copy(this.filterValues); this.render(); }; if (this.dirty) this.confirm('لغو ویرایش', 'چیدمان، کارت‌ها و فیلترها به نسخهٔ ذخیره‌شده برمی‌گردند.', cancel); else cancel(); },
    switchTab(target) { this.activeTab = target.dataset.key; this.render(); },

saveTab() { const name = String(this.form().get('name')).trim(); if (!name) throw new Error('نام تب را وارد کنید.'); if (this.tabDraft) this.tabDraft.name = name; else { if (this.dashboard.tabs.length >= 12) throw new Error('حداکثر ۱۲ تب مجاز است.'); const tab = { key: uid(), name }; this.dashboard.tabs.push(tab); this.activeTab = tab.key; } this.markDirty(); this.render(); },
    duplicateTab() { if (this.dashboard.tabs.length >= 12) throw new Error('حداکثر ۱۲ تب مجاز است.'); const key = uid(); const old = this.tabDraft.key; this.dashboard.tabs.push({ key, name: this.tabDraft.name + ' — کپی' }); for (const widget of [...this.dashboard.widgets].filter(row => row.tab_key === old)) this.cloneWidget(widget, key); this.activeTab = key; this.markDirty(); this.render(); },
    deleteTab() { if (this.dashboard.tabs.length === 1) throw new Error('حداقل یک تب باید باقی بماند.'); const key = this.tabDraft.key; this.confirm('حذف تب', 'تب و کارت‌های آن از پیش‌نویس حذف می‌شوند.', () => { this.dashboard.tabs = this.dashboard.tabs.filter(tab => tab.key !== key); for (const widget of [...this.dashboard.widgets].filter(row => row.tab_key === key)) this.removeWidget(widget.key); this.activeTab = this.dashboard.tabs[0].key; this.markDirty(); this.render(); }); },

    pickReport(target) { this.addWidget({ type: 'report', report_id: Number(target.dataset.id), settings: {}, click_behavior: { type: 'details' } }); this.addReportCard(); },
    addWidget(data) { if (this.dashboard.widgets.length >= 60) throw new Error('حداکثر ۶۰ کارت مجاز است.'); const y = Math.max(0, ...this.dashboard.widgets.filter(row => row.tab_key === this.activeTab).map(row => row.y + row.h)); this.dashboard.widgets.push({ key: uid(), tab_key: this.activeTab, x: 0, y, w: 12, h: data.type === 'report' ? 8 : 4, report_id: null, content: null, settings: {}, click_behavior: {}, ...data }); this.markDirty(); this.closeModal(); this.render(); },

saveTextCard() { this.persistTextCard('text'); },
    saveLinkCard() { this.persistTextCard('link'); },
    persistTextCard(type) { const form = this.form(); const content = form.get('content'); if (type === 'link' && !/^https?:\/\//i.test(content)) throw new Error('آدرس باید با http یا https شروع شود.'); const data = { type, content, settings: { ...(this.textDraft?.settings || {}), title: form.get('title') } }; if (this.textDraft) { Object.assign(this.textDraft, data); this.markDirty(); this.closeModal(); this.render(); } else this.addWidget(data); },
    cloneWidget(widget, tabKey = widget.tab_key) { const duplicate = { ...copy(widget), key: uid(), tab_key: tabKey, y: Math.max(0, ...this.dashboard.widgets.filter(row => row.tab_key === tabKey).map(row => row.y + row.h)) }; this.dashboard.widgets.push(duplicate); for (const filter of this.dashboard.filters) { const binding = filter.bindings.find(row => row.widget_key === widget.key); if (binding) filter.bindings.push({ ...binding, widget_key: duplicate.key }); } },
    duplicateCard(target) { if (this.dashboard.widgets.length >= 60) throw new Error('حداکثر ۶۰ کارت مجاز است.'); this.cloneWidget(this.dashboard.widgets.find(row => row.key === target.dataset.key)); this.markDirty(); this.render(); },
    removeWidget(key) { this.dashboard.widgets = this.dashboard.widgets.filter(widget => widget.key !== key); this.dashboard.filters.forEach(filter => filter.bindings = filter.bindings.filter(binding => binding.widget_key !== key)); },
    removeCard(target) { this.removeWidget(target.dataset.key); this.markDirty(); this.render(); },

saveDashboardSettings() { const form = this.form(); Object.assign(this.dashboard, { name: form.get('name'), description: form.get('description'), folder_id: this.dashboard.is_owner ? (form.get('folder_id') ? Number(form.get('folder_id')) : null) : this.dashboard.folder_id, settings: { width: form.get('width'), auto_apply: form.has('auto_apply'), refresh_interval: Number(form.get('refresh_interval')) } }); this.markDirty(); this.render(); },

editDashboardFilter(target) { this.filterDraft = copy(this.dashboard.filters.find(filter => filter.key === target.dataset.key)); this.filterIsNew = false; this.filterDialog(); },

dashboardFilterFields(report) { const q = report.query_definition; return q.mode === 'native' ? q.parameters || [] : report.available_fields || this.reportFields(q).map(column => ({ ...column, is_dimension: q.dimensions.some(row => row.field === column.key) })); },

removeDashboardFilter() { const key = this.filterDraft.key; this.dashboard.filters = this.dashboard.filters.filter(filter => filter.key !== key); this.dashboard.filters.forEach(filter => { if (filter.settings.parent_key === key) filter.settings.parent_key = null; }); this.dashboard.widgets.forEach(widget => { if (widget.click_behavior?.filter_key === key) widget.click_behavior = { type: 'none' }; }); delete this.filterValues[key]; this.markDirty(); this.render(); },
    filterValueChanged(target) {
        const key = target.dataset.filterValue; const filter = this.dashboard.filters.find(row => row.key === key); const operator = filter.bindings[0]?.operator;
        if (target.dataset.range !== undefined) { const value = [...(this.filterValues[key] || ['', ''])]; value[Number(target.dataset.range)] = target.value; this.filterValues[key] = value; if (!value[0] || !value[1]) return; }
        else this.filterValues[key] = ['in', 'not_in'].includes(operator) && target.value ? target.value.split(',').map(item => item.trim()) : target.value || null;
        const visited = new Set(); const clearChildren = parent => { if (visited.has(parent)) return; visited.add(parent); for (const child of this.dashboard.filters.filter(row => row.settings.parent_key === parent)) { this.filterValues[child.key] = null; clearChildren(child.key); } }; clearChildren(key);
        if (this.dashboard.settings.auto_apply !== false) this.applyFilters(); else if (this.dashboard.filters.some(row => row.settings.parent_key === key)) this.render();
    },
    applyFilters() { this.appliedValues = copy(this.filterValues); this.render(); },
    resetFilters() { this.filterValues = Object.fromEntries(this.dashboard.filters.map(filter => [filter.key, copy(filter.default_value)])); this.applyFilters(); },
    refreshDashboard() { this.nextRefresh = true; this.render(); },
    refreshCard(target) { const widget = this.dashboard.widgets.find(row => row.key === target.dataset.key); this.loadCard(widget, true); },
    exportCard(target) { const widget = this.dashboard.widgets.find(row => row.key === target.dataset.key); const result = this.results.get(widget.key); if (!result) throw new Error('نتیجه هنوز آماده نیست.'); this.exportResult(result, widget.settings.title || this.dashboardReport(widget.report_id).name); },
    toggleFullscreen() { this.fullscreen = !this.fullscreen; this.render(); },
    async cardClicked(widget, row) {
        if (this.editing) return; const click = widget.click_behavior || { type: 'details' }; const value = row[click.column || Object.keys(row)[0]];
        try {
            if (click.type === 'filter') { this.filterValues[click.filter_key] = value; this.applyFilters(); }
            else if (click.type === 'dashboard') await this.openDashboard({ dataset: { id: click.dashboard_id } });
            else if (click.type === 'url' && /^https?:\/\//i.test(click.url)) window.open(click.url.replaceAll('{{value}}', encodeURIComponent(value)), '_blank', 'noopener,noreferrer');
            else if (click.type === 'details') { const result = await this.request(`dashboards/${this.dashboard.id}/widgets/${widget.key}/query`, 'POST', { parameters: { ...this.appliedValues, _clicked: row }, details: true }); this.detailResult = result; this.modal('ردیف‌های مرتبط', tableHtml(result), button('دریافت CSV', 'exportDetails'), true); }
        } catch (error) { this.toast(error.message, true); }
    },
    exportDetails() { this.exportResult(this.detailResult, 'details'); },
    async showRevisions() { const revisions = await this.request(`dashboards/${this.dashboard.id}/revisions`); this.modal('تاریخچهٔ داشبورد', revisions.map(revision => `<div class="mb-list-row"><div class="mb-grow"><strong>نسخهٔ ${revision.version}</strong><p class="mb-help">${e(revision.created_at)}</p></div>${button('بازیابی', 'restoreRevision', 'small', `data-id="${revision.id}"`)}</div>`).join('')); },
    async restoreRevision(target) { await this.request(`dashboards/${this.dashboard.id}/revisions/${target.dataset.id}/restore`, 'POST', { version: this.dashboard.version }); this.closeModal(); await this.openDashboard({ dataset: { id: this.dashboard.id } }); this.toast('نسخه بازیابی شد.'); },

    async saveDashboardCopy() { const result = await this.request(`dashboards/${this.dashboard.id}/copy`, 'POST', { copy_reports: this.form().has('copy_reports') }); this.closeModal(); await this.refreshLibrary(); await this.openDashboard({ dataset: { id: result.id } }); },

    async saveShare() { const form = this.form(); await this.request(`dashboards/${this.dashboard.id}/share`, 'POST', { email: form.get('email'), role: form.get('role') }); this.closeModal(); this.toast('دسترسی کاربر به‌روز شد.'); },
};
