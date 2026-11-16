import Chart from 'chart.js/auto';
import { marked } from 'marked';
import { analyticsPalette } from './theme';
import { chartAxes, chartSeriesKey, chartCategoryLabel, chartDefaultPalette, resolveSeriesColors, validChartColor, hasCustomChartColor, chartAreaFill, applyChartTheme } from './chart-style';
import { uid } from './uid';
import { nativeTableElement, nativeTablePart } from './native-table';

export { uid };

export const e = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
export const copy = value => JSON.parse(JSON.stringify(value));
export const displayNames = { table: 'جدول', number: 'عدد', bar: 'ستونی', line: 'خطی', area: 'ناحیه‌ای', pie: 'دایره‌ای', doughnut: 'حلقه‌ای', scatter: 'پراکندگی', pivot: 'جدول محوری', funnel: 'قیف', progress: 'پیشرفت', gauge: 'گیج' };
export const grains = { day: 'روز', week: 'هفته', month: 'ماه', quarter: 'فصل', year: 'سال' };
export const operators = { eq: 'برابر با', neq: 'برابر نیست', in: 'یکی از', not_in: 'هیچ‌کدام از', contains: 'شامل', not_contains: 'شامل نیست', starts_with: 'شروع با', ends_with: 'پایان با', between: 'بین', not_between: 'خارج از بازه', gt: 'بزرگ‌تر از', gte: 'بزرگ‌تر یا مساوی', lt: 'کوچک‌تر از', lte: 'کوچک‌تر یا مساوی', is_null: 'خالی است (NULL)', not_null: 'خالی نیست (NULL)', is_empty: 'خالی یا متن تهی است', not_empty: 'خالی یا متن تهی نیست' };
const paths = {
    dashboard: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
    chart: 'M4 20V10 M10 20V4 M16 20v-7 M22 20H2', table: 'M3 4h18v16H3z M3 10h18 M9 4v16',
    plus: 'M12 5v14 M5 12h14', close: 'M6 6l12 12 M6 18L18 6', edit: 'M4 20l4-1L20 7l-3-3L5 16z M14 7l3 3',
    search: 'M16 16l5 5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0', database: 'M3 6v12c0 5 18 5 18 0V6 M3 6c0-5 18-5 18 0s-18 5-18 0 M3 12c0 5 18 5 18 0',
    folder: 'M3 6h7l2 3h9v11H3z', filter: 'M3 4h18l-7 8v7l-4 2v-9z', settings: 'M4 7h16 M4 17h16 M8 4v6 M16 14v6',
    copy: 'M8 8h13v13H8z M16 8V3H3v13h5', trash: 'M4 6h16 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7',
    back: 'M14 5l7 7-7 7 M21 12H3', refresh: 'M20 7v5h-5 M4 17v-5h5 M20 12a8 8 0 0 0-14-5 M4 12a8 8 0 0 0 14 5',
    download: 'M12 3v12 M7 10l5 5 5-5 M4 16v5h16v-5', number: 'M9 3L7 21 M17 3l-2 18 M3 8h18 M2 16h18',
    text: 'M4 5h16 M12 5v15 M8 20h8', link: 'M9 15l6-6 M7 14l-3 3a4 4 0 0 0 6 4l4-4 M10 7l4-4a4 4 0 0 1 6 6l-3 3',
    history: 'M4 6v5h5 M4 11a8 8 0 1 1 1 6 M12 7v5l3 2', share: 'M8 12l8-5 M8 12l8 5 M8 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M22 5a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M22 19a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    expand: 'M8 3H3v5 M16 3h5v5 M3 16v5h5 M21 16v5h-5', code: 'M8 5l-6 7 6 7 M16 5l6 7-6 7 M14 3l-4 18',
    line: 'M3 20V4 M3 20h18 M5 15l4-7 5 4 5-9', area: 'M3 20V4 M3 20h18 M5 18v-3l4-7 5 4 5-9v15z',
    pie: 'M12 3v9h9 M9 3a9 9 0 1 0 12 12 M15 3a9 9 0 0 1 6 6h-6z', join: 'M9 7h6 M9 17h6 M3 4h6v6H3z M15 14h6v6h-6z M12 7v10',
    notebook: 'M5 3h15v18H5z M2 7h6 M2 12h6 M2 17h6 M10 7h6 M10 12h6', play: 'M8 4l13 8-13 8z', check: 'M4 12l5 5L20 6', sort: 'M7 4v16 M3 16l4 4 4-4 M14 5h7 M14 10h5 M14 15h3',
    calendar: 'M3 5h18v16H3z M3 10h18 M7 3v4 M17 3v4 M7 14h2 M13 14h2',
    funnel: 'M3 4h18l-3 5H6z M6 11h12l-3 5H9z M9 18h6l-3 4z', progress: 'M3 8h18v8H3z M3 8h11v8H3', gauge: 'M3 19a9 9 0 0 1 18 0 M12 17l5-8 M10 19h4', pivot: 'M3 4h18v16H3z M3 9h18 M9 4v16 M9 14h12', doughnut: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6', scatter: 'M3 3v18h18 M7 14h1 M11 7h1 M16 10h1 M18 5h1',
};
export const icon = name => `<svg class="mb-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.chart}"/></svg>`;
export const button = (label, action, kind = '', attrs = '') => {
    const color = kind.includes('primary') ? 'primary' : kind.includes('danger') ? 'danger' : kind.includes('green') ? 'success' : 'gray';
    const prototype = globalThis.document?.getElementById(`analytics-native-button-${color}`)?.content.firstElementChild;
    if (!prototype) return `<button type="button" class="mb-btn ${kind}" data-action="${action}" ${attrs}>${label}</button>`;
    const control = prototype.cloneNode(true);
    control.classList.add('mb-btn', ...kind.split(/\s+/).filter(Boolean));
    control.dataset.action = action;
    const attributes = document.createElement('template');
    attributes.innerHTML = `<button ${attrs}></button>`;
    for (const attribute of attributes.content.firstElementChild.attributes) control.setAttribute(attribute.name, attribute.value);
    const labelElement = control.querySelector('.fi-btn-label');
    labelElement.innerHTML = label;
    // Filament places the icon beside the label in its button grid.
    for (const iconElement of labelElement.querySelectorAll(':scope > svg.mb-icon')) {
        iconElement.classList.add('fi-btn-icon');
        control.insertBefore(iconElement, labelElement);
    }
    if (!labelElement.textContent.trim() && !labelElement.childElementCount) labelElement.remove();
    return control.outerHTML;
};
// The field itself comes from Filament's input and input.wrapper Blade components.
export function searchField(attribute, placeholder, value = '') {
    const field = document.getElementById('analytics-native-search-field').content.firstElementChild.cloneNode(true);
    const input = field.querySelector('input');
    input.setAttribute(attribute, '');
    input.setAttribute('placeholder', placeholder);
    input.setAttribute('aria-label', placeholder);
    input.setAttribute('value', value);
    return field.outerHTML;
}

export const iconButton = (name, label, action, attrs = '') => `<button type="button" class="mb-icon-btn" title="${e(label)}" aria-label="${e(label)}" data-action="${action}" ${attrs}>${icon(name)}</button>`;
export const options = (items, selected, placeholder = null) => (placeholder !== null ? `<option value="">${e(placeholder)}</option>` : '') + items.map(item => {
    const key = typeof item === 'string' ? item : item.key;
    const label = typeof item === 'string' ? item : item.label;
    return `<option value="${e(key)}" ${String(selected ?? '') === String(key) ? 'selected' : ''}>${e(label)}</option>`;
}).join('');
export const entries = object => Object.entries(object).map(([key, label]) => ({ key, label }));
export function markdown(text) {
    const document = new DOMParser().parseFromString(marked.parse(String(text ?? ''), { breaks: true }), 'text/html');
    const allowed = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'STRONG', 'EM', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'CODE', 'BR', 'HR', 'A', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD']);
    for (const node of [...document.body.querySelectorAll('*')]) {
        if (!allowed.has(node.tagName)) { node.replaceWith(document.createTextNode(node.textContent)); continue; }
        const href = node.getAttribute('href');
        for (const attribute of [...node.attributes]) node.removeAttribute(attribute.name);
        if (node.tagName === 'A' && /^https?:\/\//i.test(href || '')) {
            node.setAttribute('href', href); node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer');
        }
    }
    return document.body.innerHTML;
}
export function tableHtml(result, action = '') {
    return nativeTableElement({
        result, columns: result.columns, rows: result.rows,
        formatCell: (row, column) => columnValueText(column, row[column.key]),
        rowAction: action, interactive: false,
    }).outerHTML;
}
const resultValueText = value => value === null || value === undefined ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);
export const columnValueText = (column, value) => column?.type === 'boolean' && value !== null && value !== undefined ? [true, 1, '1', 'true'].includes(value) ? 'بله' : 'خیر' : resultValueText(value);
const sameValue = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const clickable = (node, handler) => {
    node.tabIndex = 0; node.setAttribute('role', 'button'); node.classList.add('mb-data-clickable');
    node.addEventListener('click', event => { event.stopPropagation(); handler(event); });
    node.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); handler(event); } });
};
function tablePagination(page, pageSize, total, truncated) {
    const last = Math.max(1, Math.ceil(total / pageSize)), current = page + 1;
    const footer = nativeTablePart('pagination');
    const format = value => new Intl.NumberFormat(footer.dataset.numberLocale).format(value);
    const range = (start, end) => Array.from({ length: end - start + 1 }, (_, i) => start + i);
    // Match Filament's LengthAwarePaginator::onEachSide(0) window.
    const pages = last < 8 ? range(1, last)
        : current <= 4 ? [...range(1, 4), '…', last - 1, last]
        : current > last - 4 ? [1, 2, '…', ...range(last - 3, last)]
        : [1, 2, '…', current, '…', last - 1, last];
    const arrow = direction => {
        const item = nativeTablePart('pagination-' + direction);
        item.querySelector('button').dataset.page = direction;
        return item;
    };
    const items = pages.map(value => {
        const item = nativeTablePart('pagination-' + (typeof value !== 'number' ? 'ellipsis' : value === current ? 'active' : 'page'));
        const control = item.querySelector('button');
        item.querySelector('.fi-pagination-item-label').textContent = typeof value === 'number' ? String(value) : '…';
        if (typeof value === 'number') {
            control.dataset.page = value - 1;
            control.setAttribute('aria-label', 'صفحه ' + value);
            if (value === current) control.setAttribute('aria-current', 'page');
        } else item.setAttribute('aria-hidden', 'true');
        return item;
    });
    const numbered = footer.querySelector('.fi-pagination-items');
    numbered.replaceChildren(...(page > 0 ? [arrow('previous')] : []), ...items, ...(current < last ? [arrow('next')] : []));
    if (last === 1) numbered.hidden = true;
    for (const direction of ['previous', 'next']) {
        const control = footer.querySelector('.fi-pagination-' + direction + '-btn');
        if ((direction === 'previous' && page === 0) || (direction === 'next' && current >= last)) control.remove();
        else control.dataset.page = direction;
    }
    const values = { first: format(total ? page * pageSize + 1 : 0), last: format(Math.min(current * pageSize, total)), total: format(total) };
    footer.querySelector('.fi-pagination-overview').textContent = footer.dataset.overviewTemplate.replace(/\{(first|last|total)\}/g, (_, key) => values[key]) + (truncated ? ' (نتیجه محدود شده)' : '');
    const sizes = [...new Set([10, 25, 50, 100, pageSize])].sort((a, b) => a - b);
    footer.querySelectorAll('.fi-pagination-records-per-page-select select').forEach(select => {
        select.dataset.tablePageSize = '';
        select.setAttribute('aria-label', footer.dataset.pageSizeLabel);
        select.replaceChildren(...sizes.map(size => {
            const option = document.createElement('option');
            option.value = size; option.textContent = String(size); option.selected = size === pageSize;
            return option;
        }));
    });
    return footer;
}

export function mountTable(container, result, settings = {}, onClick = null) {
    const remote = !!result.meta?.pagination && typeof settings._fetch_page === 'function';
    let page = remote ? result.meta.pagination.page - 1 : 0;
    let sort = remote && result.meta.pagination.sort ? { key: result.meta.pagination.sort.key, direction: result.meta.pagination.sort.direction === 'desc' ? -1 : 1 } : null;
    let search = remote ? result.meta.pagination.search : '';
    let busy = false; let revision = 0; let searchTimer;
    let pageSize = Math.max(5, Math.min(100, Math.trunc(Number(settings.page_size) || 25)));
    if (remote) pageSize = result.meta.pagination.page_size;
    const columns = settings.visible_columns?.length ? result.columns.filter(column => settings.visible_columns.includes(column.key)) : result.columns;
    const pageOptions = () => ({ page: page + 1, page_size: pageSize, search, sort: sort ? { key: sort.key, direction: sort.direction === -1 ? 'desc' : 'asc' } : null });
    const context = (column, row, event, anchor) => ({ column_key: column.key, row_index: row ? result.rows.indexOf(row) : null, kind: row ? 'cell' : 'header', event, anchor, result_signature: result.meta?.result_signature, ...(remote ? { pagination: pageOptions() } : {}) });
    const setBusy = value => {
        busy = value;
        container.setAttribute('aria-busy', String(value));
        container.querySelectorAll('[data-page], [data-table-page-size], [data-table-sort]').forEach(node => { node.disabled = value; });
        container.querySelectorAll('[data-table-cell]').forEach(node => node.setAttribute('aria-disabled', String(value)));
    };
    const refresh = async (restoreSearch = false) => {
        clearTimeout(searchTimer);
        const requestRevision = ++revision;
        setBusy(true);
        container.querySelector('[data-table-error]')?.remove();
        try {
            const next = await settings._fetch_page(pageOptions(), () => revision === requestRevision && container.isConnected);
            if (!next || revision !== requestRevision || !container.isConnected) return false;
            result = next;
            const pagination = result.meta.pagination;
            page = pagination.page - 1; pageSize = pagination.page_size; search = pagination.search;
            sort = pagination.sort ? { key: pagination.sort.key, direction: pagination.sort.direction === 'desc' ? -1 : 1 } : null;
            paint(restoreSearch);
            return true;
        } catch (error) {
            if (revision === requestRevision && container.isConnected) {
                // Keep the previously loaded page usable if a request fails.
                const pagination = result.meta.pagination;
                page = pagination.page - 1; pageSize = pagination.page_size; search = pagination.search;
                sort = pagination.sort ? { key: pagination.sort.key, direction: pagination.sort.direction === 'desc' ? -1 : 1 } : null;
                paint();
                const message = document.createElement('div');
                message.dataset.tableError = ''; message.setAttribute('role', 'alert');
                message.textContent = error.message;
                container.prepend(message);
            }
            return false;
        } finally {
            if (revision === requestRevision && container.isConnected) setBusy(false);
        }
    };
    const paint = (restoreSearch = false) => {
        const selection = container.querySelector('[data-result-search]')?.selectionStart;
        const term = search.trim().toLocaleLowerCase();
        const rows = remote ? result.rows : result.rows.filter(row => !term || columns.some(column => columnValueText(column, row[column.key]).toLocaleLowerCase().includes(term)));
        if (sort && !remote) rows.sort((a, b) => { const x = a[sort.key], y = b[sort.key]; const numeric = columns.find(column => column.key === sort.key)?.type === 'number'; const comparison = x == null && y == null ? 0 : x == null ? -1 : y == null ? 1 : numeric && Number.isFinite(Number(x)) && Number.isFinite(Number(y)) ? Number(x) - Number(y) : String(x).localeCompare(String(y), 'fa'); return comparison * sort.direction; });
        const total = remote ? result.meta.pagination.total : rows.length;
        page = Math.max(0, Math.min(page, Math.max(0, Math.ceil(total / pageSize) - 1)));
        const slice = remote ? rows : rows.slice(page * pageSize, (page + 1) * pageSize);
        const formatCell = (row, column) => {
            const value = row[column.key];
            return settings._cell_labels?.(row, column.key) ?? (column.type === 'number' && Number.isFinite(Number(value)) && value !== null
                ? new Intl.NumberFormat('fa-IR', { maximumFractionDigits: settings.decimals ?? 6, useGrouping: !settings._field_metadata?.[column.key]?.primary }).format(value)
                : columnValueText(column, value));
        };
        container.replaceChildren(nativeTableElement({
            result, columns, rows: slice, formatCell, settings, sort,
            search: settings.table_search === false ? null : search,
            pagination: tablePagination(page, pageSize, total, result.meta?.truncated),
            columnActions: !!onClick,
        }));
        container.querySelectorAll('[data-table-sort]').forEach(node => { node.onclick = event => {
            if (busy) return;
            const column = columns.find(item => item.key === node.dataset.tableSort);
            if (onClick) { event.stopPropagation(); onClick(null, context(column, null, event, node)); }
            else { sort = { key: column.key, direction: sort?.key === column.key ? -sort.direction : 1 }; page = 0; if (remote) refresh(); else paint(); }
        }; });
        container.querySelectorAll('[data-page]').forEach(control => {
            control.onclick = async event => {
                if (busy) return;
                const target = control.dataset.page;
                page = Math.max(0, Math.min(Math.max(0, Math.ceil(total / pageSize) - 1), target === 'previous' ? page - 1 : target === 'next' ? page + 1 : Number(target)));
                if (remote) { if (!await refresh()) return; } else paint();
                if (event.detail === 0) {
                    const visible = selector => [...container.querySelectorAll(selector)].find(node => node.getClientRects().length);
                    (visible('[data-page="' + target + '"]') || visible('[aria-current="page"], [data-table-page-size]'))?.focus({ preventScroll: true });
                }
            };
        });
        container.querySelectorAll('[data-table-page-size]').forEach(select => { select.onchange = async event => {
            if (busy) return;
            const compact = event.target.closest('label').classList.contains('fi-compact');
            pageSize = Number(event.target.value); page = 0;
            if (remote) { if (!await refresh()) return; } else paint();
            container.querySelector('.fi-pagination-records-per-page-select' + (compact ? '.fi-compact' : ':not(.fi-compact)') + ' select')?.focus({ preventScroll: true });
        }; });
        const input = container.querySelector('[data-result-search]');
        if (input) {
            input.addEventListener('input', () => {
                search = input.value; page = 0;
                if (remote) {
                    clearTimeout(searchTimer); ++revision; setBusy(true);
                    searchTimer = setTimeout(() => { if (container.isConnected) refresh(true); }, 200);
                } else paint(true);
            });
            if (restoreSearch) { input.focus(); input.setSelectionRange(selection ?? search.length, selection ?? search.length); }
        }
        if (onClick) container.querySelectorAll('[data-table-cell]').forEach(node => {
            if (settings._can_click_column && !settings._can_click_column(node.dataset.column)) return;
            const row = result.rows[Number(node.dataset.rowIndex)]; const column = columns.find(item => item.key === node.dataset.column);
            clickable(node, event => { if (!busy) onClick(row, context(column, row, event, node)); });
        });
    };
    paint();
}
function mountPivot(container, result, settings, onClick) {
    const dimensions = result.columns.filter(column => settings._dimension_keys ? settings._dimension_keys.includes(column.key) : column.type !== 'number');
    const measure = result.columns.find(column => column.key === settings.y) || result.columns.find(column => column.type === 'number' && !dimensions.includes(column));
    const rowColumn = result.columns.find(column => column.key === settings.x) || dimensions[0];
    const columnColumn = result.columns.find(column => column.key === settings.split) || dimensions.find(column => column.key !== rowColumn?.key);
    if (!rowColumn || !columnColumn || !measure) { container.innerHTML = '<div class="mb-note">برای جدول محوری، دو ستون گروه‌بندی و یک مقدار عددی انتخاب کنید.</div>'; mountTable(container.appendChild(document.createElement('div')), result, settings, onClick); return; }
    const unique = values => [...new Map(values.map(value => [JSON.stringify(value), value])).values()];
    const rows = unique(result.rows.map(row => row[rowColumn.key])); const columns = unique(result.rows.map(row => row[columnColumn.key]));
    const matches = (row, column) => result.rows.filter(item => sameValue(item[rowColumn.key], row) && sameValue(item[columnColumn.key], column));
    const sum = values => { const present = values.filter(value => value !== null && value !== undefined); return present.length ? present.reduce((total, value) => total + Number(value), 0) : null; };
    const value = (row, column) => sum(matches(row, column).map(item => item[measure.key]));
    const format = number => number === null ? '—' : new Intl.NumberFormat('fa-IR', { maximumFractionDigits: Number(settings.decimals || 0) }).format(number);
    const matrixColumns = [
        { key: 'dimension', label: rowColumn.label + ' / ' + columnColumn.label },
        ...columns.map((column, index) => ({ key: 'value-' + index, label: resultValueText(column), type: 'number' })),
        { key: 'total', label: 'مجموع', type: 'number' },
    ];
    const matrixRows = rows.map(row => ({
        dimension: row,
        ...Object.fromEntries(columns.map((column, index) => ['value-' + index, value(row, column)])),
        total: sum(columns.map(column => value(row, column))),
    }));
    matrixRows.push({
        dimension: 'مجموع',
        ...Object.fromEntries(columns.map((column, index) => ['value-' + index, sum(rows.map(row => value(row, column)))])),
        total: sum(result.rows.map(row => row[measure.key])),
    });
    const root = nativeTableElement({
        result: { rows: matrixRows }, columns: matrixColumns, rows: matrixRows, interactive: false,
        formatCell: (row, column) => column.type === 'number' ? format(row[column.key]) : resultValueText(row[column.key]),
    });
    const table = root.querySelector('.fi-ta-table');
    table.classList.add('mb-pivot');
    table.querySelectorAll('thead th').forEach((header, index) => {
        header.scope = 'col';
        if (index > 0 && index <= columns.length) header.dataset.pivotColumn = index - 1;
    });
    table.querySelectorAll('tbody tr').forEach((record, rowIndex) => {
        const isTotal = rowIndex === rows.length;
        const heading = nativeTablePart('header-none');
        const label = document.createElement(isTotal ? 'strong' : 'span');
        label.textContent = resultValueText(matrixRows[rowIndex].dimension);
        heading.querySelector('[data-table-sort]').replaceWith(label);
        heading.scope = 'row';
        if (!isTotal) heading.dataset.pivotRow = rowIndex;
        record.firstElementChild.replaceWith(heading);
        [...record.children].slice(1).forEach((cell, columnIndex) => {
            const isRowTotal = columnIndex === columns.length;
            if (isTotal && isRowTotal) cell.dataset.pivotGrandTotal = '';
            else if (isTotal) cell.dataset.pivotTotalColumn = columnIndex;
            else if (isRowTotal) cell.dataset.pivotTotalRow = rowIndex;
            else {
                cell.dataset.pivotCell = '';
                cell.dataset.pivotRowIndex = rowIndex;
                cell.dataset.pivotColumnIndex = columnIndex;
            }
            if (isTotal || isRowTotal) {
                const label = cell.querySelector('[data-native-cell-label]');
                const total = document.createElement('strong');
                total.textContent = label.textContent;
                label.replaceChildren(total);
            }
        });
    });
    container.replaceChildren(root);
    const emit = (node, row, key, scope, total = false) => {
        if (!onClick || !row && !total) return;
        if (settings._can_click_column && !settings._can_click_column(key)) return;
        const matching = total ? result.rows.filter(item => !row || scope.every(field => sameValue(item[field], row[field]))) : [];
        const clickedRow = total ? Object.fromEntries([...scope.map(field => [field, row[field]]), ...result.columns.filter(column => column.key === measure.key || settings._dimension_keys && column.role === 'metric').map(column => [column.key, sum(matching.map(item => item[column.key]))])]) : row;
        clickable(node, event => onClick(clickedRow, { column_key: key, row_index: row ? result.rows.indexOf(row) : null, kind: total ? 'total' : 'cell', scope_fields: scope, event, anchor: node, result_signature: result.meta?.result_signature }));
    };
    container.querySelectorAll('[data-pivot-cell]').forEach(node => { const matching = matches(rows[Number(node.dataset.pivotRowIndex)], columns[Number(node.dataset.pivotColumnIndex)]); emit(node, matching[0], measure.key, [rowColumn.key, columnColumn.key], matching.length > 1); });
    container.querySelectorAll('[data-pivot-row]').forEach(node => emit(node, result.rows.find(item => sameValue(item[rowColumn.key], rows[Number(node.dataset.pivotRow)])), rowColumn.key, [rowColumn.key]));
    container.querySelectorAll('[data-pivot-column]').forEach(node => emit(node, result.rows.find(item => sameValue(item[columnColumn.key], columns[Number(node.dataset.pivotColumn)])), columnColumn.key, [columnColumn.key]));
    container.querySelectorAll('[data-pivot-total-row]').forEach(node => emit(node, result.rows.find(item => sameValue(item[rowColumn.key], rows[Number(node.dataset.pivotTotalRow)])), measure.key, [rowColumn.key], true));
    container.querySelectorAll('[data-pivot-total-column]').forEach(node => emit(node, result.rows.find(item => sameValue(item[columnColumn.key], columns[Number(node.dataset.pivotTotalColumn)])), measure.key, [columnColumn.key], true));
    emit(container.querySelector('[data-pivot-grand-total]'), null, measure.key, [], true);
}
export function visualize(container, result, display, settings = {}, onClick = null) {
    const oldCanvas = container.querySelector('canvas'); if (oldCanvas) Chart.getChart(oldCanvas)?.destroy();
    container.replaceChildren(); container.dataset.visualization = display;
    container._analyticsVisualization = { result, display, settings, onClick };
    container.classList.toggle('chart', ['bar', 'line', 'area', 'pie', 'doughnut', 'scatter'].includes(display));
    if (result.meta?.waiting_for_filter) { container.innerHTML = '<div class="mb-empty">فیلتر «' + e(result.meta.waiting_for_filter) + '» را انتخاب کنید.</div>'; return null; }
    if (!result.rows.length) { if (['table', 'pivot'].includes(display) && result.columns.length) mountTable(container, result, settings, onClick); else container.innerHTML = '<div class="mb-empty">داده‌ای برای این انتخاب وجود ندارد.</div>'; return null; }
    const { x, metrics: allMetrics, numeric, split } = chartAxes(result, settings);
    const circular = ['pie', 'doughnut'].includes(display);
    const metrics = circular ? allMetrics.slice(0, 1) : allMetrics;
    const colors = resolveSeriesColors(result, display, settings, container);
    settings._series_colors = colors;
    const palette = () => analyticsPalette(container);
    const primaryColor = hasCustomChartColor(settings) ? settings.color : chartDefaultPalette(display, container, settings)[0];
    const keyColor = key => colors[key] || primaryColor;
    const canClick = column => onClick && (!settings._can_click_column || settings._can_click_column(column.key));
    const emit = (row, column, event, anchor, extra = {}) => canClick(column) && onClick(row, { column_key: column.key, row_index: result.rows.indexOf(row), kind: 'point', event, anchor, result_signature: result.meta?.result_signature, color: primaryColor, series_colors: colors, ...extra });
    const formatNumber = value => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: Number(settings.decimals || 0) }).format(value);
    if (display === 'table' || !metrics.length && display !== 'number') { mountTable(container, result, settings, onClick); return null; }
    if (display === 'pivot') { mountPivot(container, result, settings, onClick); return null; }
    if (['progress', 'gauge', 'funnel'].includes(display)) {
        const column = metrics[0] || numeric[0] || result.columns[0];
        if (display === 'funnel') {
            const max = Math.max(...result.rows.map(row => Math.abs(Number(row[column.key]))), 1);
            container.innerHTML = '<div class="mb-funnel">' + result.rows.map((row, index) => '<div data-funnel-row="' + index + '"><strong>' + e(columnValueText(x, row[x.key])) + '</strong><span style="width:' + Math.max(3, Math.abs(Number(row[column.key])) / max * 100) + '%;background:' + e(keyColor(chartSeriesKey('category', x.key, row[x.key]))) + '">' + e(formatNumber(row[column.key])) + '</span></div>').join('') + '</div>';
            if (canClick(column)) container.querySelectorAll('[data-funnel-row]').forEach(node => { const row = result.rows[Number(node.dataset.funnelRow)]; const key = chartSeriesKey('category', x.key, row[x.key]); clickable(node, event => emit(row, column, event, node, { color: keyColor(key), series_key: key, series_label: columnValueText(x, row[x.key]) })); });
        } else {
            const value = Number(result.rows[0][column.key]); const target = Number(settings.target || 100);
            const rawPercentage = value / target * 100; const percentage = Math.min(100, Math.max(0, rawPercentage));
            const valueText = e(settings.prefix || '') + e(formatNumber(value)) + e(settings.suffix || '');
            const gradientId = 'mb-gauge-' + uid();
            const endpointAngle = (135 + percentage * 2.7) * Math.PI / 180;
            const ringGauge = '<div class="mb-gauge-face mb-gauge-ring-face"><svg class="mb-gauge mb-gauge-ring" viewBox="0 0 200 200" aria-hidden="true"><defs><linearGradient id="' + gradientId + '" gradientUnits="userSpaceOnUse" x1="44.85" y1="155.15" x2="' + (100 + 78 * Math.cos(endpointAngle)) + '" y2="' + (100 + 78 * Math.sin(endpointAngle)) + '"><stop offset="0%" stop-color="var(--mb-gauge-start)"/><stop offset="50%" stop-color="var(--mb-gauge-mid)"/><stop offset="100%" stop-color="' + e(primaryColor) + '"/></linearGradient></defs><path d="M44.85 155.15 A78 78 0 1 1 155.15 155.15" fill="none" stroke="var(--mb-chart-track)" stroke-width="12" stroke-linecap="round" pathLength="100"/><path d="M44.85 155.15 A78 78 0 1 1 155.15 155.15" fill="none" stroke="url(#' + gradientId + ')" stroke-width="12" stroke-linecap="round" pathLength="100" stroke-dasharray="' + percentage + ' 100"/><circle cx="' + (100 + 78 * Math.cos(endpointAngle)) + '" cy="' + (100 + 78 * Math.sin(endpointAngle)) + '" r="8" fill="var(--mb-card-bg)" stroke="' + e(primaryColor) + '" stroke-width="5"/></svg><div class="mb-stat-value mb-gauge-value">' + valueText + '</div></div>';
            container.innerHTML = display === 'gauge'
                ? '<div class="mb-stat mb-gauge-stat">' + (settings.gauge_style === 'ring' ? ringGauge : '<div class="mb-gauge-face"><svg class="mb-gauge" viewBox="0 0 200 124" aria-hidden="true"><path class="mb-gauge-track" d="M22 100 A78 78 0 0 1 178 100" fill="none" stroke="var(--mb-chart-track)" stroke-width="30" pathLength="100"/><path d="M22 100 A78 78 0 0 1 178 100" fill="none" stroke="' + e(primaryColor) + '" stroke-width="30" pathLength="100" stroke-dasharray="' + percentage + ' 100"/><path class="mb-gauge-needle" d="M100 8 L100 43" transform="rotate(' + (percentage * 1.8 - 90) + ' 100 100)" stroke="' + e(primaryColor) + '" stroke-width="4" stroke-linecap="round"/></svg><div class="mb-stat-value mb-gauge-value">' + valueText + '</div></div>') + '<div class="mb-stat-caption">' + e(settings.caption || 'از هدف') + ' ' + e(formatNumber(target)) + ' · ' + e(formatNumber(rawPercentage)) + '%</div></div>'
                : '<div class="mb-stat mb-progress-stat"><div class="mb-stat-value">' + valueText + '</div><div class="mb-progress-track"><div style="width:' + percentage + '%;background:' + e(primaryColor) + '"></div></div><div class="mb-stat-caption">' + e(settings.caption || 'از هدف') + ' ' + e(formatNumber(target)) + ' · ' + e(formatNumber(rawPercentage)) + '%</div></div>';
            if (canClick(column)) clickable(container.querySelector('.mb-stat'), event => emit(result.rows[0], column, event, container.querySelector('.mb-stat'), { series_key: chartSeriesKey('metric', column.key, null), color: keyColor(chartSeriesKey('metric', column.key, null)), series_label: column.label }));
        }
        return null;
    }
    if (display === 'number') {
        const column = result.columns.find(item => item.key === settings.y) || metrics[0] || numeric[0] || result.columns[0];
        const value = result.rows[0][column.key];
        const formatted = column.type === 'boolean' ? columnValueText(column, value) : value === null || value === undefined ? '—' : Number.isFinite(Number(value)) ? new Intl.NumberFormat('fa-IR', { minimumFractionDigits: Number(settings.decimals || 0), maximumFractionDigits: Number(settings.decimals || 0) }).format(value) : String(value);
        container.innerHTML = '<div class="mb-stat"><div class="mb-stat-value">' + e(settings.prefix || '') + e(formatted) + e(settings.suffix || '') + '</div><div class="mb-stat-caption">' + e(settings.caption || 'نتیجهٔ گزارش') + '</div></div>';
        if (canClick(column)) clickable(container.querySelector('.mb-stat'), event => emit(result.rows[0], column, event, container.querySelector('.mb-stat'), { series_key: chartSeriesKey('metric', column.key, null), color: keyColor(chartSeriesKey('metric', column.key, null)), series_label: column.label }));
        return null;
    }
    if (circular && result.rows.some(row => Number(row[metrics[0].key]) < 0)) { container.innerHTML = '<div class="mb-note">برای نمودار دایره‌ای یا حلقه‌ای، مقدارهای عددی باید صفر یا مثبت باشند.</div>'; return null; }
    const canvas = document.createElement('canvas'); container.append(canvas);
    const center = display === 'doughnut' && settings.show_total !== false && settings.center_mode !== 'none' ? document.createElement('div') : null;
    if (center) { center.className = 'mb-donut-center'; center.dataset.donutCenter = ''; center.setAttribute('aria-live', 'polite'); container.append(center); }
    const tooltip = circular ? document.createElement('div') : null;
    if (tooltip) { tooltip.className = 'mb-chart-tooltip'; tooltip.dataset.chartTooltip = ''; tooltip.hidden = true; tooltip.setAttribute('role', 'tooltip'); container.append(tooltip); }
    const chartType = ['area', 'line'].includes(display) ? 'line' : display === 'scatter' ? 'scatter' : display;
    let labelValues = result.rows.map(row => row[x.key]); let labels = labelValues.map(value => circular ? chartCategoryLabel(value, x) : columnValueText(x, value)); let datasets;
    const chartNumber = value => value === null || value === undefined ? null : Number(value);
    const splitChart = split && ['bar', 'line', 'area'].includes(display);
    if (splitChart) {
        labelValues = [...new Map(labelValues.map(value => [JSON.stringify(value), value])).values()]; labels = labelValues.map(value => columnValueText(x, value));
        const series = [...new Map(result.rows.map(row => [JSON.stringify(row[split.key]), row[split.key]])).values()];
        datasets = series.flatMap(seriesValue => metrics.map(metric => {
            const seriesKey = chartSeriesKey('series', split.key, seriesValue, metric.key); const color = keyColor(seriesKey);
            return { label: columnValueText(split, seriesValue) + (metrics.length > 1 ? ' · ' + metric.label : ''), _seriesValue: seriesValue, _seriesKey: seriesKey, _columnKey: metric.key, data: labelValues.map(value => chartNumber(result.rows.find(row => sameValue(row[x.key], value) && sameValue(row[split.key], seriesValue))?.[metric.key])), borderColor: color, _analyticsThemeFill: display === 'area' && series.length === 1 && metrics.length === 1 && !hasCustomChartColor(settings) && !validChartColor(settings.series_colors?.[seriesKey]) && Number.isInteger(settings._series_color_indexes?.[seriesKey]), backgroundColor: display === 'area' && series.length === 1 && metrics.length === 1 && !hasCustomChartColor(settings) && !validChartColor(settings.series_colors?.[seriesKey]) && Number.isInteger(settings._series_color_indexes?.[seriesKey]) ? context => chartAreaFill(context, container) : color + (display === 'area' ? '22' : ''), fill: display === 'area', tension: settings.smooth === false ? 0 : .35, borderWidth: 2, pointRadius: settings.points === true ? 2 : 0, pointHoverRadius: 5, borderRadius: display === 'bar' ? 11 : 0, borderSkipped: false, maxBarThickness: settings.horizontal ? 6 : 44 };
        }));
    } else {
        const categories = circular || display === 'bar' && metrics.length === 1 && (settings.color_by_category ?? !settings.horizontal);
        datasets = metrics.map(metric => {
            const seriesKey = chartSeriesKey('metric', metric.key, null); const color = keyColor(seriesKey);
            const categoryColors = result.rows.map(row => keyColor(chartSeriesKey('category', x.key, row[x.key])));
            const themedFill = display === 'area' && metrics.length === 1 && !hasCustomChartColor(settings) && !validChartColor(settings.series_colors?.[seriesKey]) && Number.isInteger(settings._series_color_indexes?.[seriesKey]);
            return { label: metric.label, _seriesKey: seriesKey, _columnKey: metric.key, _categoryColors: categories, _analyticsThemeFill: themedFill, data: result.rows.map(row => display === 'scatter' ? { x: chartNumber(row[x.key]), y: chartNumber(row[metric.key]) } : chartNumber(row[metric.key])), backgroundColor: categories ? categoryColors : themedFill ? context => chartAreaFill(context, container) : color + (display === 'area' ? '22' : ''), hoverBackgroundColor: categories ? categoryColors : undefined, borderColor: categories ? categoryColors : color, borderWidth: circular || display === 'bar' ? 0 : 2, hoverBorderWidth: circular || display === 'bar' ? 0 : 2, hoverOffset: circular ? 5 : 0, fill: display === 'area', tension: settings.smooth === false ? 0 : .35, pointRadius: settings.points === true ? 2 : 0, pointHoverRadius: 5, pointBackgroundColor: color, borderRadius: display === 'bar' ? 11 : 0, borderSkipped: false, maxBarThickness: settings.horizontal ? 6 : 44 };
        });
    }
    const percentFormat = value => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 }).format(value) + '%';
    const sameYear = new Set(labelValues.filter(value => typeof value === 'string').map(value => value.slice(0, 4))).size === 1;
    const compactTimeTick = label => {
        if (x.type !== 'date' || !x.grain || typeof label !== 'string') return label;
        const match = label.match(/^(\d{4})-(\d{2})-(\d{2})/); if (!match) return label;
        if (x.grain === 'year') return match[1];
        if (x.grain === 'quarter') return 'Q' + Math.ceil(Number(match[2]) / 3) + (sameYear ? '' : ' ' + match[1]);
        return new Intl.DateTimeFormat('en-US', { month: 'short', ...(x.grain === 'month' ? {} : { day: 'numeric' }), ...(sameYear ? {} : { year: '2-digit' }), timeZone: 'UTC' }).format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))));
    };
    const categoryTicks = x.type === 'date' && x.grain && display !== 'scatter' ? { maxRotation: 0, callback: function (value) { return compactTimeTick(this.getLabelForValue(value)); } } : {};
    const circularRow = (chart, index) => {
        const row = result.rows[index]; const value = Number(row[metrics[0].key]) || 0;
        const total = result.rows.reduce((sum, item, rowIndex) => sum + (chart.getDataVisibility(rowIndex) ? Number(item[metrics[0].key]) || 0 : 0), 0);
        const key = chartSeriesKey('category', x.key, row[x.key]);
        return { label: chartCategoryLabel(row[x.key], x), value, total, percentage: total ? value / total * 100 : 0, color: keyColor(key), series_key: key, index };
    };
    const paintCenter = chart => {
        if (!center) return;
        const elements = chart.getDatasetMeta(0).data; const arc = elements[0]; if (!arc) return;
        center.style.left = canvas.offsetLeft + arc.x + 'px'; center.style.top = canvas.offsetTop + arc.y + 'px'; center.style.maxWidth = Math.max(0, arc.innerRadius * 1.65) + 'px';
        const active = chart.$selectedSlice;
        const visible = result.rows.map((_, index) => circularRow(chart, index)).filter(item => chart.getDataVisibility(item.index));
        const configured = settings.center_key ? visible.find(item => item.series_key === settings.center_key) : null;
        const fallback = settings.center_mode === 'percentage' ? configured || visible.reduce((best, item) => !best || item.value > best.value ? item : best, null) : null;
        const selected = active != null && chart.getDataVisibility(active) ? circularRow(chart, active) : fallback;
        const total = visible.reduce((sum, item) => sum + item.value, 0);
        const text = selected ? settings.center_mode === 'percentage' ? percentFormat(selected.percentage) : formatNumber(selected.value) : formatNumber(total);
        const caption = selected ? selected.label + (settings.center_mode === 'percentage' ? '' : ' · ' + percentFormat(selected.percentage)) : settings.caption || 'مجموع';
        center.innerHTML = '<strong>' + e(settings.prefix || '') + e(text) + e(settings.suffix || '') + '</strong><span>' + (selected ? '<i data-chart-color style="background-color:' + e(selected.color) + '"></i>' : '') + e(caption) + '</span>';
    };
    const externalTooltip = ({ chart, tooltip: model }) => {
        if (container.closest('#analytics-studio')?.querySelector('[data-drill-menu]')) { if (tooltip) tooltip.hidden = true; return; }
        if (!tooltip || model.opacity === 0 || !model.dataPoints?.length) { if (tooltip) tooltip.hidden = true; return; }
        const selected = model.dataPoints[0].dataIndex;
        const visible = result.rows.map((_, index) => circularRow(chart, index)).filter(item => chart.getDataVisibility(item.index));
        const showPercent = true;
        tooltip.innerHTML = '<div class="mb-chart-tooltip-title">' + e(metrics[0].label) + '</div><div class="mb-chart-tooltip-rows">' + visible.map(item => '<div data-chart-tooltip-row class="' + (item.index === selected ? 'focused' : '') + '"><span><i data-chart-color style="background-color:' + e(item.color) + '"></i>' + e(item.label) + '</span><strong>' + e(formatNumber(item.value)) + '</strong>' + (showPercent ? '<small>' + e(percentFormat(item.percentage)) + '</small>' : '') + '</div>').join('') + '</div><div class="mb-chart-tooltip-total"><span>مجموع</span><strong>' + e(formatNumber(visible.reduce((sum, item) => sum + item.value, 0))) + '</strong></div>';
        tooltip.hidden = false;
        const width = Math.min(340, container.clientWidth - 12); tooltip.style.width = width + 'px';
        tooltip.style.left = Math.max(6, Math.min(canvas.offsetLeft + model.caretX + 12, container.clientWidth - width - 6)) + 'px';
        tooltip.style.top = Math.max(6, Math.min(canvas.offsetTop + model.caretY + 12, container.clientHeight - Math.min(tooltip.offsetHeight, container.clientHeight - 12) - 6)) + 'px';
    };
    const theme = palette();
    const centerPlugin = { id: 'analytics-donut-center', afterDraw: currentChart => {
        paintCenter(currentChart);
        if (!circular || !['inside', 'both'].includes(settings.percent_visibility)) return;
        const context = currentChart.ctx; context.save(); context.textAlign = 'center'; context.textBaseline = 'middle'; context.font = `bold 10px ${palette().fontFamily}`;
        currentChart.getDatasetMeta(0).data.forEach((arc, index) => {
            if (!currentChart.getDataVisibility(index)) return;
            const row = circularRow(currentChart, index); if (row.percentage < 4 || arc.outerRadius - arc.innerRadius < 16) return;
            const point = arc.tooltipPosition(); const rgb = row.color.slice(1).match(/../g).map(part => parseInt(part, 16)); context.fillStyle = rgb[0] * .299 + rgb[1] * .587 + rgb[2] * .114 > 165 ? '#241b3a' : '#ffffff'; context.fillText(percentFormat(row.percentage), point.x, point.y);
        }); context.restore();
    } };
    const valueLabels = { id: 'analytics-soar-value-labels', afterDatasetsDraw: currentChart => {
        if (display !== 'bar') return;
        const ctx = currentChart.ctx;
        const area = currentChart.chartArea;
        ctx.save();
        if (!settings.horizontal) {
            ctx.strokeStyle = palette().grid;
            ctx.setLineDash([5, 5]);
            ctx.beginPath(); ctx.moveTo(area.left, area.bottom); ctx.lineTo(area.right, area.bottom); ctx.stroke();
            ctx.setLineDash([]);
        }
        if (settings.stacked) { ctx.restore(); return; }
        ctx.fillStyle = palette().muted;
        ctx.font = `9px ${palette().fontFamily}`;
        ctx.textBaseline = 'middle';
        currentChart.data.datasets.forEach((dataset, datasetIndex) => {
            if (!currentChart.isDatasetVisible(datasetIndex)) return;
            const meta = currentChart.getDatasetMeta(datasetIndex);
            meta.data.forEach((bar, index) => {
                const value = dataset.data[index];
                if (value == null || !Number.isFinite(Number(value))) return;
                if (settings.horizontal) {
                    if (meta.data.length > 25) return;
                    ctx.textAlign = 'right';
                    ctx.fillText(formatNumber(value), area.left - 8, bar.y);
                } else if (bar.width >= 18) {
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'bottom';
                    ctx.fillText(formatNumber(value), bar.x, Math.max(12, bar.y - 12));
                }
            });
        });
        ctx.restore();
    } };
    const chart = new Chart(canvas, {
        type: chartType, data: { labels, datasets }, plugins: circular ? [centerPlugin] : display === 'bar' ? [valueLabels] : [],
        options: {
            responsive: true, maintainAspectRatio: false, animation: false, color: theme.muted, font: { family: theme.fontFamily },
            cutout: display === 'doughnut' ? (100 - Math.min(45, Math.max(10, Number(settings.ring_thickness) || 28))) + '%' : undefined,
            layout: { padding: circular ? 7 : { top: display === 'bar' && !settings.horizontal ? 26 : display === 'bar' ? 14 : 6, right: 4, bottom: 2, left: settings.horizontal ? 42 : 2 } },
            indexAxis: settings.horizontal && display === 'bar' ? 'y' : 'x',
            elements: { point: { radius: settings.points === true ? 2 : 0 }, line: { tension: settings.smooth === false ? 0 : .35 } },
            plugins: {
                legend: { display: settings.legend !== false && (datasets.length > 1 || circular), position: display === 'bar' && settings.horizontal && settings.stacked ? 'top' : 'bottom', rtl: true, labels: { color: theme.muted, usePointStyle: true, pointStyle: 'circle', boxWidth: 7, boxHeight: 7, padding: 15, font: { family: theme.fontFamily, size: 10 }, ...(circular ? { generateLabels: chart => Chart.overrides[chartType].plugins.legend.labels.generateLabels(chart).map(item => { const row = circularRow(chart, item.index); return { ...item, text: row.label + (['legend', 'both'].includes(settings.percent_visibility) ? ' (' + percentFormat(row.percentage) + ')' : ''), fillStyle: row.color, strokeStyle: row.color }; }) } : {}) } },
                tooltip: { enabled: !circular, external: circular ? externalTooltip : undefined, rtl: true, backgroundColor: theme.tooltipBg, titleColor: theme.tooltipText, bodyColor: theme.tooltipText, borderColor: theme.grid, borderWidth: 1, cornerRadius: 10, padding: 12, titleFont: { family: theme.fontFamily }, bodyFont: { family: theme.fontFamily }, footerFont: { family: theme.fontFamily } },
            },
            ...(!circular ? { scales: {
                x: { display: settings.show_x !== false, reverse: display === 'bar' && !!settings.horizontal, stacked: !!settings.stacked, title: { display: !!settings.x_label, text: settings.x_label, color: theme.text, font: { family: theme.fontFamily } }, grid: { display: !!settings.horizontal, color: theme.grid, drawTicks: false }, border: { display: false, color: theme.grid, dash: [5, 5] }, ticks: { color: theme.muted, font: { family: theme.fontFamily, size: 10 }, padding: 7, ...(!settings.horizontal ? categoryTicks : { maxRotation: 0, autoSkip: true, autoSkipPadding: 10 }) } },
                y: { display: settings.show_y !== false, position: settings.horizontal ? 'right' : 'left', stacked: !!settings.stacked, min: settings.y_min === '' || settings.y_min == null ? undefined : Number(settings.y_min), max: settings.y_max === '' || settings.y_max == null ? undefined : Number(settings.y_max), beginAtZero: settings.y_min === '' || settings.y_min == null, title: { display: !!settings.y_label, text: settings.y_label, color: theme.text, font: { family: theme.fontFamily } }, grid: { color: theme.grid, display: display === 'scatter', drawTicks: false }, border: { display: false }, ticks: { color: theme.muted, font: { family: theme.fontFamily, size: 10 }, padding: 7, ...(settings.horizontal ? categoryTicks : {}) } },
            } } : {}),
            onHover: (_, elements, currentChart) => {
                const key = elements.length ? datasets[elements[0].datasetIndex]?._columnKey : null;
                canvas.style.cursor = key && canClick({ key }) ? 'pointer' : 'default';
                if (center) { currentChart.$selectedSlice = elements[0]?.index; paintCenter(currentChart); }
            },
            onClick: (event, elements, currentChart) => {
                if (!onClick || !elements[0]) return;
                const item = elements[0]; const dataset = datasets[item.datasetIndex];
                const row = splitChart ? result.rows.find(row => sameValue(row[x.key], labelValues[item.index]) && sameValue(row[split.key], dataset._seriesValue)) : result.rows[item.index];
                const column = result.columns.find(column => column.key === dataset._columnKey);
                const key = dataset._categoryColors ? chartSeriesKey('category', x.key, row?.[x.key]) : dataset._seriesKey;
                if (tooltip) tooltip.hidden = true;
                if (row && column) emit(row, column, event.native || event, canvas, { color: keyColor(key), series_key: key, series_label: circular ? chartCategoryLabel(row[x.key], x) : dataset.label, ...(circular ? { percentage: circularRow(currentChart, item.index).percentage } : {}) });
            },
        },
    });
    canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', (settings.caption || displayNames[display]) + ' · ' + metrics.map(metric => metric.label).join('، '));
    canvas.addEventListener('mouseleave', () => { if (tooltip) tooltip.hidden = true; if (center) { chart.$selectedSlice = null; paintCenter(chart); } });
    chart.$analyticsTheme = () => applyChartTheme(chart, container);
    chart.$analyticsColors = colors;
    return chart;
}
