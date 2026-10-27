import test from 'node:test';
import assert from 'node:assert/strict';
import { projectMetadataNames, metadataSearchText, normalizeMetadataSearch, joinedMetadataField } from '../../resources/js/analytics/metadata-labels.js';

const physical = (key, fa, en) => ({ key, label: fa, original_name: key, label_kind: 'physical', display_names: { original: key, fa, en } });

test('database-prefixed table labels retain physical source keys in every language and remain searchable', () => {
    const table = { ...physical('public.users', 'unisq.کاربران', 'unisq.Users'), display_names: { original: 'unisq.users', fa: 'unisq.کاربران', en: 'unisq.Users' }, fields: [physical('id', 'شناسه', 'ID')] };
    const source = { catalog: [table], query_definition: { source: 'public.users' } };
    for (const [language, label] of Object.entries(table.display_names)) {
        const projected = projectMetadataNames(source, language);
        assert.equal(projected.catalog[0].label, label);
        assert.equal(projected.catalog[0].key, 'public.users');
        assert.equal(projected.catalog[0].original_name, 'public.users');
        assert.equal(projected.query_definition.source, 'public.users');
        assert.equal(projected.catalog[0].fields[0].key, 'id');
    }
    assert.ok(metadataSearchText(table).includes('unisq.users'));
    assert.ok(metadataSearchText(table).includes('public.users'));
});

test('database identifiers are the default and explicit Persian/English names leave field keys unchanged', () => {
    const source = { catalog: [{ ...physical('orders', 'سفارش‌ها', 'Sales orders'), fields: [physical('customer_id', 'شناسهٔ مشتری', 'Customer ID')] }] };
    const original = projectMetadataNames(source);
    assert.equal(original.catalog[0].label, 'orders');
    assert.equal(original.catalog[0].fields[0].label, 'customer_id');
    assert.equal(projectMetadataNames(source, 'fa').catalog[0].fields[0].label, 'شناسهٔ مشتری');
    assert.equal(projectMetadataNames(source, 'en').catalog[0].fields[0].label, 'Customer ID');
    assert.equal(projectMetadataNames(source, 'en').catalog[0].fields[0].key, 'customer_id');
    assert.equal(source.catalog[0].label, 'سفارش‌ها');
    assert.equal(projectMetadataNames(projectMetadataNames(source, 'fa'), 'original').catalog[0].label, 'orders');
});

test('changing display names preserves raw rows, query definitions, aliases and literal SQL bindings', () => {
    const field = physical('city', 'شهر', 'City');
    const source = {
        columns: [field, { key: 'my_total', label: 'جمع دلخواه', label_kind: 'alias', display_names: { original: 'جمع دلخواه', fa: 'wrong', en: 'wrong' } }],
        rows: [{ city: 'تهران', nested: field, json: { display_names: field.display_names, label_kind: 'physical', label: 'دادهٔ واقعی' } }],
        query_definition: { source: 'orders', filters: [{ field: 'city', value: 'تهران' }], expressions: [{ label: 'عنوان کاربر', expression: '[city]' }] },
        parameters: { value: 'تهران' }, settings: { x_label: 'عنوان شخصی' },
    };
    const english = projectMetadataNames(source, 'en');
    assert.equal(english.columns[0].label, 'City');
    assert.equal(english.columns[1].label, 'جمع دلخواه');
    assert.strictEqual(english.rows, source.rows);
    assert.strictEqual(english.query_definition, source.query_definition);
    assert.strictEqual(english.parameters, source.parameters);
    assert.strictEqual(english.settings, source.settings);
    assert.equal(english.rows[0].city, 'تهران');
    assert.equal(english.rows[0].json.label, 'دادهٔ واقعی');
});

test('Drill and record compatibility labels use the same display names and missing translations fall back to identifiers', () => {
    const source = { context: { ...physical('customer_id', 'شناسهٔ مشتری', 'Customer ID'), column_label: 'شناسهٔ مشتری', value: { ...physical('literal', 'واقعی', 'Real'), label: 'داده' } }, record: { ...physical('customers', 'مشتریان', 'Customers'), table_label: 'مشتریان', row: { name: 'علی' } } };
    const english = projectMetadataNames(source, 'en');
    assert.equal(english.context.column_label, 'Customer ID');
    assert.equal(english.record.table_label, 'Customers');
    assert.strictEqual(english.context.value, source.context.value);
    assert.strictEqual(english.record.row, source.record.row);
    assert.equal(projectMetadataNames(physical('order_date', null, ''), 'fa').label, 'order_date');
    assert.equal(projectMetadataNames(physical('order_date', null, ''), 'invalid').label, 'order_date');
});

test('table search covers raw identifiers and both translations without changing source names', () => {
    const field = physical('customer_id', 'شناسه مشتري', 'Customer reference');
    const text = metadataSearchText(field);
    for (const search of ['customer_id', 'Customer reference', 'مشتری']) assert.ok(text.includes(normalizeMetadataSearch(search)));
    assert.equal(field.display_names.fa, 'شناسه مشتري');
});

test('joined fields retain their qualified identifier and table context when switching languages', () => {
    const table = physical('customer_records', 'مشتریان', 'Customers');
    const field = physical('city_name', 'شهر', 'City');
    const joined = joinedMetadataField(field, table, 'customer_id.city_name');
    assert.equal(joined.label, 'customer_id.city_name');
    assert.equal(joined.original_name, 'customer_id.city_name');
    assert.equal(projectMetadataNames(joined, 'fa').label, 'مشتریان → شهر');
    assert.equal(projectMetadataNames(projectMetadataNames(joined, 'fa'), 'en').label, 'Customers → City');
    assert.equal(joinedMetadataField(field, table, 'join_1.city_name', 'en').label, 'Customers → City');
    assert.equal(field.key, 'city_name');
    assert.equal(field.display_names.original, 'city_name');
});
