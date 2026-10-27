import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanDrillContext, formatDrillNumber, copyPresentationSettings, captureDrillPresentation, nextDrillPresentation, persistedPresentationSettings } from '../../resources/js/analytics/drill-presentation.js';
import { themeMethods } from '../../resources/js/analytics/theme.js';

const categoryKey = value => JSON.stringify(['category', 'status', value]);
const colors = { [categoryKey('paid')]: '#a58ad3', [categoryKey('pending')]: '#f2a86f', [categoryKey(null)]: '#509ee3', [categoryKey('null')]: '#88bf4d' };
const source = () => ({ display: 'doughnut', settings: { x: 'status', y: 'sales', legend: true, _series_colors: { ...colors } } });
const columns = [{ key: 'status', type: 'text' }, { key: 'sales', type: 'number' }];

test('trusted numeric values use the widget Persian grouping, decimals and prefix/suffix including zero', () => {
    assert.equal(formatDrillNumber(35050, { decimals: 0 }), '۳۵٬۰۵۰');
    assert.equal(formatDrillNumber(0, { decimals: 0, prefix: 'مبلغ ', suffix: ' ریال' }), 'مبلغ ۰ ریال');
    assert.equal(formatDrillNumber(35050.125, { decimals: 2, prefix: 'مبلغ ', suffix: ' ریال' }), 'مبلغ ۳۵٬۰۵۰٫۱۳ ریال');
    assert.equal(formatDrillNumber(0, { decimals: 2 }, 'number'), '۰٫۰۰');
    assert.equal(formatDrillNumber(null, { decimals: 2 }), null);
    assert.equal(formatDrillNumber(false, { decimals: 2 }), null);
    assert.equal(formatDrillNumber('2026-01-01', { decimals: 2 }), null);
});

test('selected segment preserves its exact color and typed category keys without changing source settings', () => {
    const origin = source();
    const original = JSON.stringify(origin);
    const presentation = captureDrillPresentation(origin, { color: '#ef8282', series_key: categoryKey('pending'), series_label: 'در انتظار', percentage: 25, series_colors: colors });
    assert.equal(presentation.settings._series_colors[categoryKey('pending')], '#ef8282');
    assert.equal(presentation.settings._series_colors[categoryKey(null)], '#509ee3');
    assert.equal(presentation.settings._series_colors[categoryKey('null')], '#88bf4d');
    assert.equal(presentation.selection.percentage, 25);
    presentation.settings._series_colors[categoryKey('paid')] = '#000000';
    assert.equal(JSON.stringify(origin), original);
    assert.equal(colors[categoryKey('paid')], '#a58ad3');
    const fullMap = Object.fromEntries(Array.from({ length: 12000 }, (_, index) => ['existing'+index, '#123456']));
    const pinned = captureDrillPresentation({ display: 'doughnut', settings: { _series_colors: fullMap } }, { color: '#f2a86f', series_key: categoryKey('last') });
    assert.equal(Object.keys(pinned.settings._series_colors).length, 12000);
    assert.equal(nextDrillPresentation(pinned, { display: null }).settings._series_colors[categoryKey('last')], '#f2a86f');
});

test('Donut quick filter keeps display and the surviving category color after row reduction', () => {
    const previous = captureDrillPresentation(source(), { color: colors[categoryKey('pending')], series_key: categoryKey('pending'), series_colors: colors });
    const frame = nextDrillPresentation(previous, { display: null, result: { columns, rows: [{ status: 'pending', sales: 40 }] } });
    assert.equal(frame.display, 'doughnut');
    assert.equal(frame.settings._series_colors[categoryKey('pending')], '#f2a86f');
    assert.deepEqual(frame.selection, previous.selection);
});

test('underlying table stays a table on further quick filters and history frames retain separate settings', () => {
    const original = captureDrillPresentation(source(), { color: '#f2a86f', series_key: categoryKey('pending') });
    const underlying = nextDrillPresentation(original, { display: 'table', result: { columns: [{ key: 'id' }, { key: 'status' }] } });
    const filtered = nextDrillPresentation(underlying, { display: null, result: { columns: [{ key: 'id' }, { key: 'status' }] } });
    assert.equal(filtered.display, 'table');
    assert.equal(filtered.settings._series_colors[categoryKey('pending')], '#f2a86f');
    assert.equal(underlying.settings.y, undefined);
    assert.equal(original.settings.y, 'sales');
    filtered.settings._series_colors[categoryKey('pending')] = '#000000';
    assert.equal(underlying.settings._series_colors[categoryKey('pending')], '#f2a86f');
    assert.equal(original.settings._series_colors[categoryKey('pending')], '#f2a86f');
});

test('changing output columns removes obsolete axes and table projections while retaining compatible settings', () => {
    const previous = source();
    previous.settings = { ...previous.settings, split: 'missing', visible_columns: ['status', 'sales'], decimals: 2 };
    const changed = nextDrillPresentation(previous, { display: 'number', result: { columns: [{ key: 'drill_value' }] } });
    assert.equal(changed.settings.x, undefined);
    assert.equal(changed.settings.y, undefined);
    assert.equal(changed.settings.split, undefined);
    assert.equal(changed.settings.visible_columns, undefined);
    assert.equal(changed.settings.decimals, 2);
    assert.deepEqual(changed.settings._series_colors, colors);
    assert.deepEqual(previous.settings.visible_columns, ['status', 'sales']);
});

test('API contexts contain only authorized coordinates and do not carry colors, settings, row values or functions', () => {
    const context = { column_key: 'sales', row_index: 0, kind: 'point', result_signature: 'a'.repeat(64), scope_fields: ['status'], color: '#f2a86f', series_colors: colors, series_label: 'pending', value: 40, query_definition: { sql: 'malicious' } };
    const clean = cleanDrillContext(context);
    assert.deepEqual(Object.keys(clean), ['column_key', 'row_index', 'kind', 'result_signature', 'scope_fields']);
    assert.equal(clean.row_index, 0);
    clean.scope_fields.push('extra');
    assert.deepEqual(context.scope_fields, ['status']);
    const settings = copyPresentationSettings({ ...source().settings, _field_metadata: { secret: true }, _cell_labels: () => 'runtime', _dimension_keys: ['status'] });
    assert.equal(settings._field_metadata, undefined);
    assert.equal(settings._cell_labels, undefined);
    assert.equal(settings._dimension_keys, undefined);
    assert.deepEqual(settings._series_colors, colors);
});

test('explicit save promotes runtime colors to bounded persisted overrides and rejects unsafe color strings', () => {
    const settings = { ...source().settings, series_colors: { [categoryKey('paid')]: '#123456', invalid: 'url(javascript:alert(1))' }, _field_metadata: { secret: true } };
    const saved = persistedPresentationSettings(settings);
    assert.equal(saved._series_colors, undefined);
    assert.equal(saved._field_metadata, undefined);
    assert.equal(saved.series_colors[categoryKey('paid')], '#123456');
    assert.equal(saved.series_colors[categoryKey('pending')], '#f2a86f');
    assert.equal(saved.series_colors.invalid, undefined);
    assert.equal(settings._series_colors[categoryKey('paid')], '#a58ad3');
    const oversized = Object.fromEntries(Array.from({ length: 12001 }, (_, index) => ['key'+index, '#123456']));
    assert.equal(Object.keys(persistedPresentationSettings({ _series_colors: oversized }).series_colors).length, 12000);
});

function withNativeThemeEnvironment(callback) {
    const globals = ['window', 'document', 'MutationObserver', 'CustomEvent', 'getComputedStyle'];
    const previous = globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
    class Events extends EventTarget {
        listeners = new Map();
        addEventListener(type, listener, options) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(listener); super.addEventListener(type, listener, options); }
        removeEventListener(type, listener, options) { this.listeners.get(type)?.delete(listener); super.removeEventListener(type, listener, options); }
    }
    class ThemeEvent extends Event { constructor(type, options = {}) { super(type, options); this.detail = options.detail; } }
    const win = new Events(); const doc = new Events(); const media = new Events(); media.matches = false;
    const root = new Events(); root.dataset = {}; root.style = {}; root.isConnected = true; root.closest = () => root;
    let nativeMode = 'system'; let nativeDark = false; let nextFrame = 0; const frames = new Map(); const observers = []; const reads = []; const writes = [];
    win.localStorage = { getItem(key) { reads.push(key); return key === 'theme' ? nativeMode : null; }, setItem(key, value) { writes.push([key, value]); }, removeItem(key) { writes.push([key, null]); } };
    win.matchMedia = () => media;
    win.requestAnimationFrame = listener => { frames.set(++nextFrame, listener); return nextFrame; };
    win.cancelAnimationFrame = id => frames.delete(id);
    doc.documentElement = { classList: { contains: name => name === 'dark' && nativeDark, toggle() { throw new Error('Analytics changed native html.dark'); }, add() { throw new Error('Analytics changed native html.dark'); }, remove() { throw new Error('Analytics changed native html.dark'); } } };
    doc.getElementById = () => root;
    class Observer { constructor(listener) { this.listener = listener; observers.push(this); } observe() { this.active = true; } disconnect() { this.active = false; } }
    globalThis.window = win; globalThis.document = doc; globalThis.CustomEvent = ThemeEvent; globalThis.MutationObserver = Observer;
    globalThis.getComputedStyle = node => ({ getPropertyValue: key => key === '--default-theme-mode' ? 'system' : '#123456' });
    const app = { ...themeMethods, root, render() { throw new Error('Theme follower rerendered the studio'); } };
    const environment = {
        app, root, win, doc, media, frames, observers, reads, writes,
        native(mode, dark) { nativeMode = mode; nativeDark = dark; win.dispatchEvent(new ThemeEvent('theme-changed', { detail: mode })); },
        mutate(dark) { nativeDark = dark; observers.filter(observer => observer.active).forEach(observer => observer.listener()); },
        flush() { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(listener => listener()); },
    };
    try { callback(environment); }
    finally { app.destroyAnalyticsTheme(); for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } }
}

test('native Filament theme remains authoritative and repeated notifications produce one chart refresh per resolved change', () => {
    withNativeThemeEnvironment(({ app, root, win, media, frames, reads, writes, native, mutate, flush }) => {
        const changes = []; const popup = {}; app.drillPopup = popup;
        root.addEventListener('analytics:themechange', event => changes.push(event.detail));
        app.initializeTheme();
        assert.equal(root.dataset.analyticsTheme, 'light');
        assert.equal(root.dataset.analyticsThemeMode, 'system');
        assert.equal(app.setAnalyticsTheme, undefined);
        assert.equal(app.analyticsThemeControlHtml, undefined);
        native('dark', true); mutate(true); media.dispatchEvent(new Event('change'));
        assert.equal(frames.size, 1); flush();
        assert.equal(root.dataset.analyticsTheme, 'dark');
        assert.equal(root.dataset.analyticsThemeMode, 'dark');
        assert.equal(changes.length, 1);
        media.matches = true; native('system', true); mutate(true); flush();
        assert.equal(root.dataset.analyticsThemeMode, 'system');
        assert.equal(changes.length, 1);
        media.matches = false; mutate(false); media.dispatchEvent(new Event('change')); flush();
        assert.equal(root.dataset.analyticsTheme, 'light');
        assert.equal(changes.length, 2);
        const storage = new Event('storage'); storage.key = 'analytics-theme'; win.dispatchEvent(storage);
        assert.equal(frames.size, 0);
        assert.deepEqual(writes, []);
        assert.ok(reads.every(key => key === 'theme'));
        assert.equal(app.drillPopup, popup);
    });
});

test('theme initialization and Livewire teardown remove listeners and pending refreshes without changing native state', () => {
    withNativeThemeEnvironment(({ app, root, win, doc, media, frames, observers, writes, native, mutate, flush }) => {
        const changes = []; root.addEventListener('analytics:themechange', event => changes.push(event.detail));
        app.initializeTheme(); app.initializeTheme();
        assert.equal(win.listeners.get('theme-changed').size, 1);
        assert.equal(win.listeners.get('storage').size, 1);
        assert.equal(media.listeners.get('change').size, 1);
        assert.equal(observers.filter(observer => observer.active).length, 1);
        native('dark', true); mutate(true); flush();
        assert.equal(changes.length, 1);
        native('light', false); mutate(false);
        assert.equal(frames.size, 1);
        doc.dispatchEvent(new Event('livewire:navigating'));
        assert.equal(frames.size, 0);
        assert.equal(win.listeners.get('theme-changed').size, 0);
        assert.equal(win.listeners.get('storage').size, 0);
        assert.equal(media.listeners.get('change').size, 0);
        assert.equal(observers.filter(observer => observer.active).length, 0);
        flush(); native('dark', true); mutate(true); flush();
        assert.equal(changes.length, 1);
        assert.deepEqual(writes, []);
    });
});
