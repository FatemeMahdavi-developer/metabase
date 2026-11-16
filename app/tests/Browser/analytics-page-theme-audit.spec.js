import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { panelFontCss, awaitPanelFonts } from './helpers/panel-fonts.js';
import { nativeTableTemplates } from './helpers/native-table-templates.js';

let controls, component, panelStyles, analyticsStyles, vendorStyles;
const source = 'public.analytics_orders_with_a_long_database_identifier';
const fields = [
    { key:'id', label:'ID', type:'number', raw_type:'bigint', primary:true, nullable:false },
    { key:'category', label:'Category', type:'text', raw_type:'character varying', nullable:true },
    { key:'amount', label:'Amount', type:'number', raw_type:'numeric', nullable:false },
    { key:'ordered_at', label:'Ordered at', type:'date', raw_type:'timestamp without time zone', nullable:false },
];
const definition = {
    connection_id:1, source, mode:'rows', metrics:[], dimensions:[], filters:[], sort:[], joins:[], expressions:[], limit:100,
};
const report = { id:41, version:1, name:'Order details', description:'A saved report', display:'table', visualization_settings:{}, query_definition:definition, available_fields:fields };
const library = {
    connections:[{ id:1, name:'PostgreSQL example', driver:'pgsql', catalog:[
        { key:source, label:source, fields, kind:'table', description:'' },
        { key:'public.categories', label:'Categories', fields, kind:'view', description:'' },
    ] }],
    reports:[report], dashboards:[{id:125,name:'Sales dashboard'}], folders:[],
};
const rows = Array.from({ length:60 }, (_, i) => ({ id:i + 1, category:i % 2 ? 'Clothing' : 'Books', amount:(i + 1) * 100, ordered_at:'2026-11-14' }));
const resultFor = query => {
    const stage = query.stages?.at(-1) || query;
    const aggregate = stage.mode === 'aggregate';
    return {
        columns:aggregate ? [{key:'category',label:'Category',type:'text'}, {key:'total',label:'Total',type:'number'}] : fields,
        rows:aggregate ? [{category:'Books',total:320}, {category:'Clothing',total:540}] : rows,
        meta:{ duration_ms:1, truncated:false, limit:100 }, sql:'SELECT * FROM "public"."orders"', query_definition:query,
    };
};
const aggregate = {
    ...definition, mode:'aggregate', metrics:[{key:'total',function:'sum',field:'amount',label:'Total'}],
    dimensions:[{field:'category'}], filters:[{field:'amount',operator:'gt',value:20}],
};
const dashboardReports = [
    report,
    {...report,id:42,name:'Revenue by category',display:'bar',query_definition:aggregate},
    {...report,id:43,name:'Number of orders',display:'number'},
];
const dashboard = {
    id:125, version:1, name:'Sales dashboard', description:'All report controls use the panel theme', can_edit:true, is_owner:true,
    settings:{width:'wide',auto_apply:true,refresh_interval:0},
    tabs:[{key:'main',name:'Overview'},{key:'other',name:'Another tab'}],
    reports:dashboardReports,
    filters:[
        {key:'category',label:'Category',type:'text',default_value:null,required:false,settings:{},
            bindings:[{widget_key:'orders',target:'category',operator:'eq'}]},
        {key:'date',label:'Date range',type:'date',default_value:null,required:false,settings:{},
            bindings:[{widget_key:'orders',target:'ordered_at',operator:'eq'}]},
    ],
    widgets:[
        {key:'chart',type:'report',report_id:42,tab_key:'main',x:0,y:0,w:12,h:8,settings:{},click_behavior:{type:'none'}},
        {key:'count',type:'report',report_id:43,tab_key:'main',x:12,y:0,w:12,h:8,settings:{},click_behavior:{type:'none'}},
        {key:'orders',type:'report',report_id:41,tab_key:'main',x:0,y:8,w:24,h:16,settings:{},click_behavior:{type:'none'}},
    ],
};
const compositions = [
    'new-report-empty', 'notebook-new', 'notebook-rows', 'notebook-aggregate', 'notebook-stages',
    'report-preview', 'report-pivot', 'sql-editor-preview', 'database-schema', 'database-data',
    'dashboard-edit', 'dashboard-readonly', 'drill-report',
];

test.beforeAll(async () => {
    controls = execFileSync(path.resolve('../.tools/php/php.exe'), ['tests/Browser/helpers/export-page-theme-controls.php'],
        {encoding:'utf8',timeout:60000,maxBuffer:2 * 1024 * 1024}) + nativeTableTemplates();
    // Bundle the production entry point without changing its constructor or renderer.
    // CSS is loaded separately in the same order as the actual Filament page.
    const bundle = await build({
        entryPoints:['resources/js/analytics.js'], bundle:true,write:false,format:'iife',loader:{'.css':'empty'},
    });
    component = bundle.outputFiles[0].text;
    const built = path.resolve('public/build'), manifest = JSON.parse(fs.readFileSync(path.join(built,'manifest.json'),'utf8'));
    const read = file => fs.readFileSync(path.join(built,file),'utf8');
    vendorStyles = ['../css/filament/support/support.css','../css/filament/forms/forms.css','../css/filament/filament/app.css'].map(read).join('\n');
    panelStyles = read(manifest['resources/css/panel-theme.css'].file);
    analyticsStyles = manifest['resources/js/analytics.js'].css.map(read).join('\n');
});

async function mount(page, mode, width) {
    const errors = [], unexpected = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({width,height:1100});
    const routes = {
        dashboards:'/admin/analytics/dashboards',reports:'/admin/analytics/reports',connections:'/admin/analytics/databases',
        dashboard:'/admin/analytics/dashboards/__record__',report:'/admin/analytics/reports/__record__',browser:'/admin/analytics/databases/__record__',
    };
    const markup = '<main class="fi-main-ctn fi-page"><div id="analytics-studio" data-api="/analytics/api" data-csrf="fixture" data-section="report" data-record="41" data-read-only="false" data-routes="' +
        JSON.stringify(routes).replaceAll('"','&quot;') + '" data-initial="{}"><div data-analytics-content></div>' + controls +
        '</div></main>';
    await page.route('http://page-theme-fixture.test/**', async route => {
        const url = new URL(route.request().url()), request = route.request();
        if (!url.pathname.startsWith('/analytics/api/')) return route.fulfill({
            contentType:'text/html; charset=utf-8',
            body:'<!doctype html><html lang="fa" dir="rtl" class="fi ' + (mode === 'dark' ? 'dark' : '') + '"><head><meta charset="utf-8"></head><body>' + markup + '</body></html>',
        });
        const endpoint = url.pathname.slice('/analytics/api/'.length);
        if (endpoint === 'library') return route.fulfill({json:library});
        if (endpoint === 'reports/preview') return route.fulfill({json:resultFor(request.postDataJSON().query_definition)});
        if (endpoint === 'dashboards/125') return route.fulfill({json:dashboard});
        if (/^dashboards\/125\/widgets\/[^/]+\/(?:query|preview)$/.test(endpoint)) {
            const widget = dashboard.widgets.find(widget => endpoint.includes('/' + widget.key + '/'));
            return route.fulfill({json:resultFor(dashboardReports.find(item => item.id === widget.report_id).query_definition)});
        }
        unexpected.push(request.method() + ' ' + endpoint);
        return route.fulfill({status:500,json:{message:'Unexpected fixture request: ' + endpoint}});
    });
    await page.goto('http://page-theme-fixture.test/admin/analytics/reports/41');
    await page.addStyleTag({content:vendorStyles + '\n' + panelStyles});
    // This rule precedes analytics CSS so a later analytics override would be caught.
    const override = await page.addStyleTag({content:'/* shared panel rule mutation */'});
    await page.addStyleTag({content:analyticsStyles});
    await page.addStyleTag({content:'body{margin:0;padding:24px;background:var(--soar-page-bg)}.fi-main-ctn{padding:0!important;min-height:0}#analytics-studio{min-height:0;min-width:0}@media(max-width:767px){body{padding:12px}}'});
    await page.addStyleTag({content:panelFontCss()});
    await awaitPanelFonts(page);
    await page.addScriptTag({content:component});
    await expect(page.locator('.mb-preview-body .mb-native-table')).toBeVisible();
    return {errors,unexpected,override};
}

async function show(page, name) {
    await page.evaluate(async ({name,library,definition,report,aggregate,rows,fields}) => {
        const app = window.analyticsStudio, root = app.root;
        app.dirty = false; app.drillSession = null; app.dashboardReadOnly = false;
        root.dataset.readOnly = 'false'; root.dataset.section = 'report';
        app.library = structuredClone(library);
        app.sqlSchemaOpen = false; app.notebookOpen = false; app.editing = false;
        app.report = structuredClone(report); app.previewResult = null;
        app.notebookSections = new Set();
        if (name.startsWith('database-')) {
            root.dataset.section = 'browser';
            app.browserMode = name === 'database-data' ? 'data' : 'schema';
            await app.browseConnection({dataset:{id:'1'}});
            return;
        }
        if (name.startsWith('dashboard-')) {
            root.dataset.section = 'dashboard';
            app.dashboardReadOnly = name === 'dashboard-readonly';
            root.dataset.readOnly = String(app.dashboardReadOnly);
            await app.openDashboard({dataset:{id:'125'}});
            if (name === 'dashboard-edit') app.editDashboard();
            return;
        }
        if (name === 'new-report-empty') {
            app.library.connections = [];
            app.view = 'start-report';
        } else {
            app.view = 'report';
            if (name.startsWith('notebook-')) {
                app.notebookOpen = true;
                if (name === 'notebook-new') delete app.report.id;
                if (name === 'notebook-aggregate' || name === 'notebook-stages') {
                    app.report.query_definition = structuredClone(aggregate);
                    app.notebookSections = new Set(['0:filter','0:summarize','0:sort','0:limit']);
                }
                if (name === 'notebook-stages') app.report.query_definition.stages = [{
                    mode:'rows',metrics:[],dimensions:[],filters:[{field:'total',operator:'gt',value:10}],
                    sort:[{key:'total',direction:'desc'}],joins:[],expressions:[],limit:50,
                }];
            }
            if (name === 'sql-editor-preview') {
                app.report.query_definition = {...structuredClone(definition),mode:'native',
                    sql:'SELECT ' + Array.from({length:35},(_,i) => '"a_long_selected_column_' + i + '"').join(', ') + '\nFROM "public"."orders"\nWHERE category = {{category}}',
                    parameters:[{key:'category',type:'text',default:'Books',required:false}]};
                app.sqlSchemaOpen = true;
            }
            if (name === 'report-preview' || name === 'report-pivot' || name === 'sql-editor-preview' || name === 'drill-report') {
                app.previewResult = {columns:fields,rows,meta:{duration_ms:1,truncated:false,limit:100},sql:'SELECT * FROM orders'};
            }
            if (name === 'report-pivot') {
                app.report.display = 'pivot';
                app.report.visualization_settings = {x:'category',split:'ordered_at',y:'amount'};
            }
            if (name === 'drill-report') app.drillSession = {
                currentIndex:0,origin:{kind:'report',name:'Order details'},
                frames:[{label:'Category: Books',selection:{color:'#2563eb'}}],
            };
        }
        app.render();
    }, {name,library,definition,report,aggregate,rows,fields});
    if (name.startsWith('database-')) await expect(page.locator('.mb-browser-preview .mb-native-table')).toBeVisible();
    if (name.startsWith('dashboard-')) {
        await expect(page.locator('[data-widget="orders"] .mb-native-table')).toBeVisible();
        await expect(page.locator('[data-widget="chart"] canvas')).toBeVisible();
    }
}

for (const mode of ['light','dark']) for (const width of [1440,390]) {
    test('all analytics page compositions inherit the shared panel theme: ' + mode + ' ' + width, async ({page}, testInfo) => {
        test.setTimeout(240000);
        const {errors,unexpected,override} = await mount(page,mode,width);
        for (const name of compositions) {
            await test.step(name, async () => {
                await show(page,name);
                await expect(page.locator('#analytics-studio')).toHaveCSS('direction','rtl');
                await expect(page.locator('.mb-load-error,.mb-error,.mb-toast.error')).toHaveCount(0);
                await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
                    {message:name + ' must contain wide tables, identifiers and SQL inside the page'}).toBe(true);

                // One panel theme edit must reach every composition through shared tokens.
                const surfaces = await page.evaluate(() => {
                    const root = document.querySelector('#analytics-studio');
                    root.style.setProperty('--soar-surface','#e9f6ef');
                    root.style.setProperty('--soar-widget-bg','#e9f6ef');
                    root.style.setProperty('--soar-input-bg','#eaf1ff');
                    const paint = selector => [...root.querySelectorAll(selector)].map(node => getComputedStyle(node).backgroundColor);
                    return {
                        toolbar:paint('.mb-toolbar'),preview:paint('.mb-question-result'),
                        sidebar:paint('.mb-schema-tables'),editor:paint('.mb-native-editor'),cards:paint('.mb-card'),
                    };
                });
                for (const key of ['toolbar','preview','sidebar','cards']) {
                    for (const background of surfaces[key]) expect(background,name + ' ' + key).toBe('rgb(233, 246, 239)');
                }
                for (const background of surfaces.editor) expect(background).toBe('rgb(234, 241, 255)');

                // Native table cell rules belong to the shared panel even when loaded first.
                await override.evaluate(node => node.textContent = '.dark body:not(:has(.fi-simple-layout)):not(:has(.glass-form)):not(:has([data-soar-auth-page])) .fi-ta-table tbody .fi-ta-cell .fi-ta-text-item-label, body:not(:has(.fi-simple-layout)):not(:has(.glass-form)):not(:has([data-soar-auth-page])) .fi-ta-table tbody .fi-ta-cell .fi-ta-text-item-label{color:rgb(10,120,80)!important}');
                const tableLabels = page.locator('#analytics-studio .fi-ta-table tbody .fi-ta-text-item-label');
                if (await tableLabels.count()) await expect(tableLabels.first()).toHaveCSS('color','rgb(10, 120, 80)');
                await override.evaluate(node => node.textContent = '');
                await page.locator('#analytics-studio').evaluate(root => {
                    for (const property of ['--soar-surface','--soar-widget-bg','--soar-input-bg']) root.style.removeProperty(property);
                });

                if (name === 'report-preview' || name === 'report-pivot') {
                    const cell = page.locator('.mb-preview-body .fi-ta-table .mb-data-clickable').first();
                    await expect(cell).toBeVisible();
                    await page.mouse.move(0, 0);
                    await page.evaluate(() => document.activeElement?.blur());
                    await expect(cell).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
                    await cell.hover();
                    await expect(cell).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
                    if (name === 'report-preview') {
                        const row = cell.locator('xpath=ancestor::tr[1]');
                        await expect(row).toHaveCSS('background-color', mode === 'dark' ? 'rgba(0, 0, 0, 0)' : 'rgb(244, 246, 255)');
                    }
                    await page.mouse.move(0, 0);
                    await cell.focus();
                    await expect(cell).toBeFocused();
                    await expect(cell).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
                    await page.evaluate(() => document.activeElement?.blur());
                }
                if (name === 'report-preview') {
                    const search = page.locator('.mb-preview-body [data-result-search]');
                    await search.fill('Books');
                    await expect(page.locator('.mb-preview-body .fi-ta-table tbody tr')).toHaveCount(25);
                    await expect(page.locator('.mb-preview-body .fi-ta-table tbody')).not.toContainText('Clothing');
                    await search.fill('');
                    await page.locator('.mb-preview-body [data-page="next"]:visible').first().click();
                    await expect(page.locator('.mb-preview-body [data-page="1"]')).toHaveAttribute('aria-current','page');
                }
                if (name === 'report-pivot') {
                    await expect(page.locator('.mb-preview-body .mb-pivot.fi-ta-table')).toBeVisible();
                    await expect(page.locator('.mb-pivot [data-pivot-grand-total]')).toHaveText('\u06f1\u06f8\u06f3\u066c\u06f0\u06f0\u06f0');
                }
                if (name === 'database-schema') {
                    await expect(page.locator('.mb-schema-metadata .fi-ta-table')).toBeVisible();
                    await expect(page.locator('.mb-schema-metadata [data-action="editDataMetadata"]')).toHaveCount(fields.length);
                    const search = page.locator('[data-schema-search]');
                    await search.fill('Categories');
                    await expect(page.locator('.mb-schema-tables [data-action="selectTable"]:visible')).toHaveCount(1);
                    await search.fill('');
                    await page.locator('.mb-schema-tables [data-key="public.categories"]').click();
                    await expect(page.locator('.mb-schema-tables button.active')).toHaveAttribute('data-key','public.categories');
                }
                if (name === 'database-data') {
                    await expect(page.locator('.mb-schema-metadata')).toHaveCount(0);
                    await expect(page.locator('.mb-schema-details [data-action="tableFilter"]')).toBeVisible();
                }
                if (name === 'sql-editor-preview') {
                    const sql = page.locator('[data-sql-preview]');
                    await sql.focus();
                    await expect(sql).toBeFocused();
                    for(let step=0;step<4;step++) await sql.press('ArrowRight');
                    await expect.poll(() => sql.evaluate(node => node.scrollWidth > node.clientWidth && node.scrollLeft > 0)).toBe(true);
                    await expect(page.locator('.mb-sql-schema')).toBeVisible();
                }
                if (name === 'dashboard-readonly') {
                    await expect(page.locator('.mb-editbar,.mb-toolbar,.mb-workbench-tools')).toHaveCount(0);
                    await page.locator('[data-action="switchTab"][data-key="other"]').click();
                    await expect(page.locator('.grid-stack-item')).toHaveCount(0);
                    await page.locator('[data-action="switchTab"][data-key="main"]').click();
                    await expect(page.locator('[data-widget="orders"] .mb-native-table')).toBeVisible();
                    await page.locator('[data-action="resetFilters"]').click();
                    await expect(page.locator('[data-widget="orders"] .mb-native-table')).toBeVisible();
                }
                if (name === 'drill-report') await expect(page.locator('.mb-drill-breadcrumb [data-action="returnFromDrill"]')).toHaveClass(/fi-btn/);
                if (name === 'dashboard-readonly') await page.screenshot({path:testInfo.outputPath(name + '.png'),fullPage:true});
            });
        }
        expect(unexpected).toEqual([]);
        expect(errors).toEqual([]);
        await page.evaluate(() => window.analyticsStudio.destroy());
    });
}
