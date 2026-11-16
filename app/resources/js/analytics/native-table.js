let searchIdentifier = 0;

// These nodes are rendered by Filament's Blade components once per workbench page.
export function nativeTablePart(name) {
    const template = document.getElementById('analytics-native-table-' + name);
    if (!template?.content.firstElementChild) throw new Error('کامپوننت جدول فیلامنت بارگذاری نشده است.');
    const root = template.content.firstElementChild.cloneNode(true);
    // Preserve Vendor markup while the client handles external query results.
    for (const node of [root, ...root.querySelectorAll('*')]) {
        if (node.classList.contains('animate-spin') && [...node.attributes].some(attr => attr.name.startsWith('wire:loading'))) { node.remove(); continue; }
        for (const attr of [...node.attributes]) if (attr.name.startsWith('wire:') || attr.name.startsWith('x-')) node.removeAttribute(attr.name);
    }
    return root;
}

export function nativeTableElement({ result, columns, rows, formatCell, settings = {}, search = null, sort = null, pagination = null, columnActions = false, rowAction = '', interactive = true }) {
    const root = nativeTablePart('shell');
    const toolbar = root.querySelector('.mb-native-table-toolbar');
    if (search === null) toolbar.remove();
    else {
        const input = toolbar.querySelector('.fi-input');
        input.dataset.resultSearch = ''; input.value = search;
        input.id = 'analytics-result-search-' + ++searchIdentifier;
        toolbar.querySelector('label').htmlFor = input.id;
    }
    const table = root.querySelector('.fi-ta-table');
    table.querySelector('thead tr').replaceChildren(...columns.map(column => {
        const direction = sort?.key === column.key ? (sort.direction === 1 ? 'asc' : 'desc') : 'none';
        const header = nativeTablePart('header-' + direction);
        const control = header.querySelector('[data-table-sort]');
        control.dataset.tableSort = column.key;
        control.title = (columnActions ? 'عملیات ستون ' : 'مرتب‌سازی ') + column.label;
        control.setAttribute('aria-label', control.title);
        control.querySelector('[data-native-header-label]').textContent = column.label;
        if (!interactive) {
            const label = document.createElement('span');
            label.textContent = column.label;
            control.replaceWith(label);
        }
        return header;
    }));
    table.querySelector('tbody').replaceChildren(...rows.map(row => {
        const record = nativeTablePart('row');
        const index = result.rows.indexOf(row);
        if (rowAction) { record.dataset.action = rowAction; record.dataset.row = index; record.style.cursor = 'pointer'; }
        record.replaceChildren(...columns.map(column => {
            const cell = nativeTablePart('cell');
            cell.dataset.column = column.key;
            cell.dataset.rowIndex = index;
            cell.title = settings._cell_title?.(column.key) || '';
            const label = cell.querySelector('[data-native-cell-label]');
            label.textContent = formatCell(row, column);
            if (column.type === 'number') { cell.classList.add('mb-number'); label.dir = 'ltr'; }
            return cell;
        }));
        return record;
    }));
    root.querySelector('.fi-ta-empty-state').hidden = rows.length > 0;
    if (pagination) root.append(pagination);
    return root;
}
