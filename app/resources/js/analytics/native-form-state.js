const list = value => String(value ?? '').split(',').map(item => item.trim()).filter(Boolean);

export function nativeFormData(data) {
    const form = new FormData();
    for (const [key, value] of Object.entries(data)) {
        if (value === false || value == null) continue;
        for (const item of Array.isArray(value) ? value : [value]) form.append(key, item === true ? '1' : String(item));
    }
    return form;
}
export function filterFormState(row) {
    return { ...row, value: Array.isArray(row.value) ? row.value.join(', ') : row.value, date_value: row.value, boolean_value: row.value === false || row.value === 0 ? 'false' : 'true', from: Array.isArray(row.value) ? row.value[0] : '', to: Array.isArray(row.value) ? row.value[1] : '', date_mode: row.relative_date ? 'relative' : 'specific', relative_amount: row.relative_date?.amount ?? 1, relative_unit: row.relative_date?.unit ?? 'month', relative_direction: row.relative_date?.direction ?? 'past', include_current: !!row.relative_date?.include_current };
}
export function valueFormState(value, operator = 'eq') {
    const defaults = { value_mode: value == null ? 'none' : 'specific', value: Array.isArray(value) ? value.join(', ') : value, relative_amount: 1, relative_unit: 'month', relative_direction: 'past', include_current: false, exclude: false };
    if (Array.isArray(value)) return ['between', 'not_between'].includes(operator) ? { ...defaults, value_mode: 'range', from: value[0], to: value[1] } : defaults;
    if (value?.kind === 'relative_date') return { ...defaults, value_mode: 'relative', relative_amount: value.amount, relative_unit: value.unit, relative_direction: value.direction, include_current: !!value.include_current, exclude: !!value.exclude };
    if (value?.kind === 'date_range') return { ...defaults, value_mode: 'range', from: value.from, to: value.to, exclude: !!value.exclude };
    if (value?.kind === 'date_parts') return { ...defaults, value_mode: 'parts', date_part: value.part, part_values: value.values.join(', '), exclude: !!value.exclude };
    if (value?.kind === 'presence') return { ...defaults, value_mode: 'presence', presence_empty: !!value.empty };
    if (['null', 'empty'].includes(value?.kind)) return { ...defaults, value_mode: value.kind };
    return defaults;
}
export function readValueState(data, type, operator) {
    if (data.value_mode === 'none') return null;
    if (['null', 'empty'].includes(data.value_mode)) return { kind: data.value_mode };
    if (data.value_mode === 'presence') return { kind: 'presence', empty: !!data.presence_empty };
    if (data.value_mode === 'relative') return { kind: 'relative_date', amount: data.relative_direction === 'current' ? 1 : Number(data.relative_amount), unit: data.relative_unit, direction: data.relative_direction, include_current: !!data.include_current, exclude: !!data.exclude };
    if (data.value_mode === 'parts') return { kind: 'date_parts', part: data.date_part, values: list(data.part_values).map(Number), exclude: !!data.exclude };
    if (data.value_mode === 'range') {
        if (data.from === '' || data.to === '') throw new Error('بازه را کامل وارد کنید.');
        const value = type === 'number' ? [Number(data.from), Number(data.to)] : [data.from, data.to];
        if (value[0] > value[1]) throw new Error('ابتدای بازه باید قبل از انتهای آن باشد.');
        return type === 'date' && data.exclude ? { kind: 'date_range', from: value[0], to: value[1], exclude: true } : value;
    }
    let value = data.suggestions?.length ? data.suggestions : ['in', 'not_in'].includes(operator) ? list(data.value) : data.value;
    if (!['in', 'not_in'].includes(operator) && Array.isArray(value)) value = value[0];
    if (type === 'number') value = Array.isArray(value) ? value.map(Number) : Number(value);
    if (type === 'boolean') value = Array.isArray(value) ? value.map(item => ['1', 'true', true, 1].includes(item)) : ['1', 'true', true, 1].includes(value);
    return value;
}

