import { copy } from "./ui";

const types = {
    menu: ['notebook', 'باز کردن منوی بررسی داده', 'فیلتر، مشاهدهٔ ردیف‌ها و بررسی بیشتر داده‌ها'],
    filter: ['filter', 'تغییر فیلترهای داشبورد', 'مقدار کلیک‌شده را به یک یا چند فیلتر متصل کنید'],
    dashboard: ['dashboard', 'رفتن به یک داشبورد', 'داشبورد مقصد را همراه با مقادیر فیلتر باز کنید'],
    report: ['chart', 'رفتن به یک پرسش ذخیره‌شده', 'پرسش مقصد را همراه با شرط‌های انتخاب‌شده باز کنید'],
    url: ['link', 'رفتن به یک آدرس اینترنتی', 'یک لینک با مقادیر ستون‌ها و فیلترها بسازید'],
    none: ['close', 'بدون عمل', 'کلیک روی این داده عملی انجام نمی‌دهد'],
};

function normalizeBehavior(behavior = {}, firstColumn = '') {
    const normalized = copy(behavior || {});
    normalized.type = !normalized.type || normalized.type === 'details' ? 'menu' : normalized.type;
    if (normalized.type === 'filter' && !normalized.mappings?.length && normalized.filter_key) {
        normalized.mappings = [{ target: normalized.filter_key, source: 'column', key: normalized.column || firstColumn }];
    }
    if (normalized.type === 'filter' && normalized.mappings?.length) { delete normalized.filter_key; delete normalized.column; }
    if (normalized.columns) normalized.columns = Object.fromEntries(Object.entries(normalized.columns).map(([key, value]) => [key, normalizeBehavior(value, key)]));
    return normalized;
}

export function resolveWidgetClickBehavior(widget, columnKey) {
    const behavior = widget.click_behavior || { type: 'menu' };
    return normalizeBehavior(behavior.columns?.[columnKey] || behavior, columnKey);
}

export function mappingSourceValue(mapping, row, context = {}) {
    if (mapping.source === 'parameter') return (context.parameters || context.appliedValues || {})[mapping.key];
    return row?.[mapping.key];
}

export function interpolateClickTemplate(template, row = {}, context = {}, settings = {}) {
    const encode = settings.encode !== false;
    return String(template || '').replace(/\{\{(column|parameter):([^{}]+)\}\}|\{\{value\}\}/g, (_, source, key) => {
        const value = source ? mappingSourceValue({ source, key: key.trim() }, row, context) : context.value ?? row[context.column_key];
        const text = value == null ? '' : Array.isArray(value) ? value.join(',') : typeof value === 'object' ? JSON.stringify(value) : String(value);
        return encode ? encodeURIComponent(text) : text;
    });
}

export function pruneClickFilterReferences(behavior, filterKey, dashboardId) {
    const normalized = copy(behavior || { type: 'menu' });
    const columns = normalized.columns;
    delete normalized.columns;
    if (normalized.mappings) {
        normalized.mappings = normalized.mappings.filter(mapping => !(mapping.source === 'parameter' && mapping.key === filterKey) && !((normalized.type === 'filter' || normalized.type === 'dashboard' && Number(normalized.dashboard_id) === Number(dashboardId)) && mapping.target === filterKey));
    }
    let clean = normalized;
    if (normalized.type === 'filter') {
        if (normalized.mappings?.length) { delete normalized.filter_key; delete normalized.column; }
        else if (normalized.filter_key === filterKey || !normalized.filter_key) clean = { type: 'none' };
    }
    const referencesParameter = template => [...String(template || '').matchAll(/\{\{parameter:([^{}]+)\}\}/g)].some(match => match[1].trim() === filterKey);
    if (normalized.type === 'url' && referencesParameter(normalized.url)) clean = { type: 'none' };
    else if (referencesParameter(normalized.link_text)) delete clean.link_text;
    if (columns) clean.columns = Object.fromEntries(Object.entries(columns).map(([key, nested]) => [key, pruneClickFilterReferences(nested, filterKey, dashboardId)]));
    return clean;
}

export const clickBehaviorMethods = {
    resolveWidgetClickBehavior,
    mappingSourceValue,
    interpolateClickTemplate,
    pruneClickFilterReferences,

validateClickBehavior(behavior) {
        if (!types[behavior.type]) throw new Error('رفتار کلیک معتبر نیست.');
        if (behavior.type === 'filter' && !behavior.mappings?.length) throw new Error('حداقل یک فیلتر مقصد را به ستون نتیجه متصل کنید.');
        if (behavior.type === 'dashboard' && !behavior.dashboard_id) throw new Error('داشبورد مقصد را انتخاب کنید.');
        if (behavior.type === 'report' && !behavior.report_id) throw new Error('پرسش مقصد را انتخاب کنید.');
        if (behavior.type === 'url') {
            if (!/^https?:\/\//i.test(behavior.url || '')) throw new Error('آدرس باید با http یا https شروع شود.');
            const columns = new Set(this.clickBehaviorEditor.columns.map(column => column.key));
            const parameters = new Set(this.dashboard.filters.map(parameter => parameter.key));
            for (const template of [behavior.url, behavior.link_text || '']) {
                for (const [token] of template.matchAll(/\{\{[^{}]+\}\}/g)) {
                    if (token === '{{value}}') continue;
                    const match = token.match(/^\{\{(column|parameter):([^{}]+)\}\}$/);
                    if (!match || !(match[1] === 'column' ? columns : parameters).has(match[2])) throw new Error('یک مقدار استفاده‌شده در لینک وجود ندارد؛ از فهرست مقادیر قابل استفاده انتخاب کنید.');
                }
            }
        }
    },

};
