import { e, copy, icon, iconButton, entries, grains } from "./ui";

const empty = value => value === null || value === undefined || value === '' || Array.isArray(value) && !value.length;
const isNull = value => value && !Array.isArray(value) && value.kind === 'null';
const isEmptyChoice = value => value && !Array.isArray(value) && value.kind === 'empty';
const special = value => isNull(value) || isEmptyChoice(value);
const units = { day: 'روز', week: 'هفته', month: 'ماه', quarter: 'فصل', year: 'سال' };

const weekdays = ['دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه', 'یکشنبه'];
const months = ['ژانویه', 'فوریه', 'مارس', 'آوریل', 'مه', 'ژوئن', 'ژوئیه', 'اوت', 'سپتامبر', 'اکتبر', 'نوامبر', 'دسامبر'];

const labelOf = value => isNull(value) ? 'خالی (NULL)' : isEmptyChoice(value) ? 'خالی یا متن تهی' : typeof value === 'boolean' ? value ? 'بله' : 'خیر' : String(value);

export const filterEnhancements = {
    filterHasNativeBinding(filter) { return filter.bindings.some(binding => { const widget = this.dashboard.widgets.find(row => row.key === binding.widget_key); return widget && this.dashboardReport(widget.report_id)?.query_definition.mode === 'native'; }); },
    filterValueLabel(filter, value) {
        const negative = ['neq', 'not_in', 'not_null', 'not_empty', 'not_contains', 'not_between'].includes(filter.bindings[0]?.operator);
        if (empty(value)) return 'همه'; if (value?.kind === 'empty') return negative ? 'به‌جز خالی یا متن تهی' : labelOf(value); if (isNull(value)) return negative ? 'به‌جز خالی (NULL)' : labelOf(value);
        if (value?.kind === 'presence') return value.empty ? 'فقط مقادیر خالی' : 'به‌جز مقادیر خالی';
        if (value?.kind === 'date_parts') return `${value.exclude === false ? 'فقط ' : 'به‌جز '}${value.values.map(item => value.part === 'day_of_week' ? weekdays[item - 1] : value.part === 'month' ? months[item - 1] : value.part === 'quarter' ? 'فصل ' + item : `${item}:00`).join('، ')}`;
        if (value?.kind === 'relative_date') return `${value.exclude ? 'به‌جز ' : ''}${value.direction === 'current' ? 'این ' + units[value.unit] : value.amount + ' ' + units[value.unit] + (value.direction === 'past' ? ' گذشته' : ' آینده')}${value.direction !== 'current' && value.include_current ? ' و این ' + units[value.unit] : ''}`;
        if (value?.kind === 'date_range') return `${value.exclude ? 'به‌جز ' : ''}${value.from} تا ${value.to}`;
        if (filter.type === 'time_grain') return grains[value] || value;
        return Array.isArray(value) ? value.map(labelOf).join(['between', 'not_between'].includes(filter.bindings[0]?.operator) ? ' تا ' : '، ') : labelOf(value);
    },
    filterHtml(filter) {
        const value = this.filterValues[filter.key]; const disabled = filter.settings.parent_key && empty(this.filterValues[filter.settings.parent_key]); const pending = JSON.stringify(value) !== JSON.stringify(this.appliedValues[filter.key]);
        return `<div class="mb-filter mb-filter-pill ${pending ? 'mb-filter-pending' : ''}"><div class="mb-filter-label">${e(filter.label)}${filter.required ? ' *' : ''}${this.editing ? iconButton('settings', 'تنظیم فیلتر', 'editDashboardFilter', `data-key="${e(filter.key)}"`) : ''}</div><button class="mb-filter-trigger ${!empty(value) ? 'has-value' : ''}" data-action="editFilterValue" data-key="${e(filter.key)}" aria-label="${e(filter.label)}" ${disabled ? 'disabled' : ''} ${pending ? 'title="تغییرات این فیلتر هنوز اعمال نشده است"' : ''}>${icon(filter.type === 'date' ? 'calendar' : 'filter')}<span>${e(this.filterValueLabel(filter, value))}</span><span class="mb-filter-chevron">⌄</span></button></div>`;
    },

    normalizeFilterChoice(filter, value) { if (special(value)) return { kind: value.kind }; if (filter.type === 'text' && value === '') return { kind: 'empty' }; if (filter.type === 'number') { const parsed = Number(value); if (empty(value) || !Number.isFinite(parsed)) throw new Error('عدد معتبر وارد کنید.'); return parsed; } if (filter.type === 'boolean') { if (![true, false, 1, 0, '1', '0', 'true', 'false'].includes(value)) throw new Error('مقدار بله یا خیر انتخاب کنید.'); return [true, 1, '1', 'true'].includes(value); } return String(value); },

setDashboardFilterValue(key, value, { fromClick = false, deferApply = false } = {}) {
        const filter = this.dashboard.filters.find(row => row.key === key); if (!filter) throw new Error('فیلتر مقصد موجود نیست.'); const operator = filter.bindings[0]?.operator || 'eq';
        if (fromClick && value === null) value = { kind: 'null' }; if (fromClick && value === '' && filter.type === 'text') value = { kind: 'empty' }; if (special(value) && this.filterHasNativeBinding(filter)) throw new Error('متغیر سادهٔ SQL مقدار خالی نمی‌پذیرد.');
        if (Array.isArray(value) && value.some(empty)) throw new Error('بازه یا مقادیر را کامل وارد کنید.'); if (value?.kind === 'date_range' && (empty(value.from) || empty(value.to) || value.from > value.to)) throw new Error('بازهٔ تاریخ را کامل و به ترتیب وارد کنید.');
        if (!empty(value) && !value?.kind) { if (fromClick && ['between', 'not_between'].includes(operator) && !Array.isArray(value)) value = [value, value]; if (['in', 'not_in'].includes(operator) && !Array.isArray(value)) value = [value]; if (Array.isArray(value)) { if (value.length > 100 || ['between', 'not_between'].includes(operator) && value.length !== 2) throw new Error('تعداد مقادیر یا بازه معتبر نیست.'); value = value.map(item => this.normalizeFilterChoice(filter, item)); if (['between', 'not_between'].includes(operator) && value[0] > value[1]) throw new Error('ابتدای بازه باید قبل از انتهای آن باشد.'); } else value = filter.type === 'time_grain' ? value : this.normalizeFilterChoice(filter, value); }
        if (filter.required && empty(value)) throw new Error('این فیلتر الزامی است.'); const nextValue = empty(value) ? null : value; const changed = JSON.stringify(this.filterValues[key]) !== JSON.stringify(nextValue); this.filterValues[key] = nextValue; if (changed) this.clearDependentFilters(key); if (!deferApply) { if (this.dashboard.settings.auto_apply !== false) this.applyFilters(); else this.render(); } return nextValue;
    },
    setDashboardFilterValues(values, { fromClick = false, deferApply = false } = {}) { const previous = copy(this.filterValues); const filters = new Map(this.dashboard.filters.map(row => [row.key, row])); const depth = key => { let count = 0; const seen = new Set(); while (filters.get(key)?.settings.parent_key) { if (seen.has(key)) throw new Error('وابستگی فیلترها حلقوی است.'); seen.add(key); key = filters.get(key).settings.parent_key; count++; } return count; }; try { const sorted = Object.entries(values).sort(([left], [right]) => depth(left) - depth(right)); for (const [key, value] of sorted) this.setDashboardFilterValue(key, value, { fromClick, deferApply: true }); } catch (error) { this.filterValues = previous; throw error; } if (!deferApply) { if (this.dashboard.settings.auto_apply !== false) this.applyFilters(); else this.render(); } },
    clearDependentFilters(key) { const visited = new Set(); const clear = parent => { if (visited.has(parent)) return; visited.add(parent); this.dashboard.filters.filter(row => row.settings.parent_key === parent).forEach(row => { this.filterValues[row.key] = null; clear(row.key); }); }; clear(key); },
    clearFilterValue() { this.setDashboardFilterValue(this.valueFilter.key, null); this.closeModal(); },
    applyFilters() { this.appliedValues = copy(this.filterValues); this.render(); },
    resetFilters() { this.filterValues = Object.fromEntries(this.dashboard.filters.map(filter => [filter.key, copy(filter.default_value)])); this.applyFilters(); },
};
