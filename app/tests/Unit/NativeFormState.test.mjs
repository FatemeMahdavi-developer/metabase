import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeFormData, filterFormState, valueFormState, readValueState } from '../../resources/js/analytics/native-form-state.js';

test('multi-selection keeps every choice instead of treating the first two as a range', () => {
    const state = valueFormState(['open', 'closed', 'waiting'], 'in');
    assert.equal(state.value_mode, 'specific');
    assert.deepEqual(readValueState(state, 'text', 'in'), ['open', 'closed', 'waiting']);
});

test('numeric zero and boolean false survive native forms', () => {
    assert.equal(readValueState(valueFormState(0), 'number', 'eq'), 0);
    assert.equal(readValueState(valueFormState(false), 'boolean', 'eq'), false);
    assert.equal(readValueState(valueFormState('true'), 'boolean', 'eq'), true);
});

test('numeric ranges preserve zero and reject reversed bounds', () => {
    assert.deepEqual(readValueState(valueFormState([0, 10], 'between'), 'number', 'between'), [0, 10]);
    assert.throws(() => readValueState({ value_mode: 'range', from: 10, to: 0 }, 'number', 'between'));
});

test('relative date and excluded date parts round-trip through the form', () => {
    for (const value of [
        { kind: 'relative_date', amount: 3, unit: 'month', direction: 'past', include_current: true, exclude: false },
        { kind: 'date_parts', part: 'day_of_week', values: [1, 6, 7], exclude: true },
        { kind: 'date_range', from: '2026-10-01', to: '2026-10-19', exclude: true },
        { kind: 'presence', empty: false },
    ]) assert.deepEqual(readValueState(valueFormState(value), 'date', 'between'), value);
});

test('null and empty choices remain distinct from no filter', () => {
    assert.equal(readValueState(valueFormState(null), 'text', 'eq'), null);
    for (const kind of ['null', 'empty']) assert.deepEqual(readValueState(valueFormState({ kind }), 'text', 'eq'), { kind });
});

test('date and relative query filters initialize their own typed state', () => {
    const source = { field: 'created_at', operator: 'between', value: ['2026-01-01', '2026-02-01'] };
    const state = filterFormState(source);
    assert.equal(state.from, '2026-01-01');
    assert.equal(state.to, '2026-02-01');
    assert.deepEqual(source.value, ['2026-01-01', '2026-02-01']);
});

test('date calendars round-trip canonical scalar, range and excluded range values', () => {
    const scalar = valueFormState('2026-11-10', 'eq');
    assert.equal(scalar.date_value, '2026-11-10');
    assert.equal(readValueState({ value_mode: 'specific', date_value: '2026-11-10' }, 'date', 'eq'), '2026-11-10');
    const range = valueFormState(['2026-11-01', '2026-11-15'], 'between');
    assert.equal(range.date_from, '2026-11-01');
    assert.equal(range.date_to, '2026-11-15');
    assert.deepEqual(readValueState({ value_mode: 'range', date_from: range.date_from, date_to: range.date_to }, 'date', 'between'), ['2026-11-01', '2026-11-15']);
    const excluded = { kind: 'date_range', from: '2026-11-01', to: '2026-11-15', exclude: true };
    assert.deepEqual(readValueState(valueFormState(excluded), 'date', 'between'), excluded);
    assert.throws(() => readValueState({ value_mode: 'range', date_from: '2026-11-15', date_to: '2026-11-01' }, 'date', 'between'));
    assert.throws(() => readValueState({ value_mode: 'range', date_from: null, date_to: '2026-11-15' }, 'date', 'between'));
});

test('a specific dashboard date stays a scalar for each binding to interpret independently', () => {
    const date = '2026-11-04';
    for (const operator of ['eq', 'between', 'not_between']) {
        const draft = valueFormState(date, operator);
        assert.equal(draft.value_mode, 'specific');
        assert.equal(draft.date_value, date);
        assert.equal(readValueState(draft, 'date', operator), date);
        assert.equal(readValueState({ value_mode: 'specific', date_value: date }, 'date', operator), date);
        assert.equal(readValueState({ value_mode: 'specific', value: date }, 'date', operator), date);
    }
});

test('calendar drafts reject malformed saved dates without changing text or numeric values', () => {
    for (const value of ['not-a-date', '2026-02-30', '2026-13-01', '2026-11-01 extra']) {
        const state = valueFormState(value);
        assert.equal(state.date_value, null);
        assert.equal(state.value, value);
    }
    assert.equal(valueFormState('2028-02-29').date_value, '2028-02-29');
    const state = filterFormState({ field: 'ordered_at', operator: 'between', value: ['2026-11-01', '2026-11-15'] });
    assert.equal(state.date_value, null);
    assert.equal(state.date_from, '2026-11-01');
    assert.equal(state.date_to, '2026-11-15');
    assert.equal(readValueState(valueFormState('a date-like text'), 'text', 'eq'), 'a date-like text');
    assert.deepEqual(readValueState(valueFormState([0, 10], 'between'), 'number', 'between'), [0, 10]);
});

test('date lists retain every selection rather than using the scalar calendar value', () => {
    for (const operator of ['in', 'not_in']) {
        const dates = ['2026-11-01', '2026-11-05', '2026-11-15'];
        assert.deepEqual(readValueState(valueFormState(dates, operator), 'date', operator), dates);
    }
});

test('FormData adapter preserves repeated values and checkbox semantics', () => {
    const data = nativeFormData({ columns: ['one', 'two'], auto_apply: true, required: false, limit: 0 });
    assert.deepEqual(data.getAll('columns'), ['one', 'two']);
    assert.equal(data.has('auto_apply'), true);
    assert.equal(data.has('required'), false);
    assert.equal(data.get('limit'), '0');
});
