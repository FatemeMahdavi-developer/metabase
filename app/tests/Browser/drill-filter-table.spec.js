import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { nativeTableTemplates } from './helpers/native-table-templates.js';
import { panelFontCss, awaitPanelFonts } from './helpers/panel-fonts.js';

// The backend suite proves query generation and signatures. This isolated contract
// fixture exercises production navigation/rendering and genuine Vendor table markup.
const aggregateFields = [
    {key:'status',label:'Status',type:'text'},
    {key:'sales',label:'Sales',type:'number'},
    {key:'customer_id',label:'Customer',type:'number',relation:{table:'customers',field:'id'}},
];
const rawFields = [
    {key:'id',label:'Order ID',type:'number',primary:true},
    {key:'status',label:'Status',type:'text'},
    {key:'total',label:'Order total',type:'number'},
    {key:'customer_id',label:'Customer',type:'number',relation:{table:'customers',field:'id'}},
    {key:'note',label:'Order note',type:'text'},
];
const definition = {
    connection_id:1,source:'orders',mode:'aggregate',
    metrics:[{key:'sales',label:'Sales',function:'sum',field:'total'}],
    dimensions:[{field:'status'},{field:'customer_id'}],filters:[],sort:[],joins:[],expressions:[],limit:100,
};
const originalSettings = {
    x:'status',y:'sales',visible_columns:['status'],decimals:2,caption:'Sales by status',
    series_colors:{'category:status:"Paid"':'#315bf5'},show_x:true,show_y:true,
};
const report = {id:41,version:1,name:'Sales by status',description:'Original saved chart',display:'bar',visualization_settings:originalSettings,query_definition:definition,available_fields:aggregateFields};
const aggregateRows = [{status:'Paid',sales:150,customer_id:1},{status:'Pending',sales:75,customer_id:2}];
const originalResult = {columns:aggregateFields,rows:aggregateRows,meta:{duration_ms:1,truncated:false,result_signature:'original-signed'},query_definition:definition};
const rawRows = Array.from({length:2505},(_,index)=>({id:index+1,status:'Paid',total:100+(index%50),customer_id:1,note:index===2504?'Late record 2505':'Order '+(index+1)}));
const parameters = {city:'Tehran',period:['2026-11-01','2026-11-30']};
const dashboard = {
    id:125,version:1,name:'Sales dashboard',description:'Original dashboard',can_edit:true,is_owner:true,
    settings:{width:'wide',auto_apply:true,refresh_interval:0},tabs:[{key:'main',name:'Overview'}],reports:[report],
    filters:[{key:'city',label:'City',type:'text',required:false,default_value:'Tehran',settings:{},bindings:[{widget_key:'sales',target:'city',operator:'eq'}]}],
    widgets:[{key:'sales',type:'report',report_id:41,tab_key:'main',x:0,y:0,w:24,h:9,settings:{title:'Widget sales',display:'bar',caption:'Widget caption'},click_behavior:{type:'menu'}}],
};
const library = {connections:[{id:1,name:'Fixture connection',driver:'pgsql',catalog:[{key:'orders',label:'Orders',fields:rawFields}]}],reports:[report],dashboards:[{id:125,name:dashboard.name}],folders:[]};
const actions = [
    {id:'filter:gt',label:'Greater than',group:'quick_filter',operator:'gt'},
    {id:'underlying',label:'See these records',group:'records',display:'table'},
    {id:'custom_filter',label:'Custom filter',group:'filter',requires_input:true},
    {id:'foreign_filter',label:'Same customer',group:'filter'},
];
const defaultPagination = {page:1,page_size:25,search:'',sort:null};
let controls, component, styles;

function filteredQuery(steps) {
    const filters=steps.filter(step=>step.action_id!=='underlying').map(step=>step.action_id==='filter:gt'?{field:'total',operator:'gt',value:75}:step.action_id==='custom_filter'?{field:'total',operator:step.input.operator,value:step.input.value}:{field:'customer_id',operator:'eq',value:1});
    return {...definition,mode:'rows',metrics:[],dimensions:[],filters,stages:[],limit:null,limit_explicit:false};
}
function resultFor(steps, requested={}) {
    if(steps.some(step=>step.action_id==='underlying'))return pageResult(steps,requested);
    if(!steps.length)return originalResult;
    const query={...definition,stages:[{mode:'rows',metrics:[],dimensions:[],filters:steps.map(step=>({field:'sales',operator:'gt',value:75})),sort:[],limit:null,limit_explicit:false}]};
    return {columns:aggregateFields,rows:[aggregateRows[0]],meta:{duration_ms:1,truncated:false,result_signature:'summary-'+steps.length},query_definition:query};
}

function pageResult(steps, requested={}) {
    const page_size=Math.max(10,Math.min(100,Number(requested.page_size)||25));
    const search=String(requested.search||''),sort=requested.sort||null;
    const term=search.trim().toLocaleLowerCase();
    const matching=rawRows.filter(row=>!term||rawFields.some(field=>String(row[field.key]??'').toLocaleLowerCase().includes(term)));
    if(sort)matching.sort((a,b)=>{const left=a[sort.key],right=b[sort.key],order=typeof left==='number'?left-right:String(left).localeCompare(String(right));return order*(sort.direction==='desc'?-1:1);});
    const total=matching.length,page=Math.max(1,Math.min(Math.ceil(total/page_size)||1,Number(requested.page)||1));
    const pagination={page,page_size,total,search,sort};
    const result_signature='raw-'+steps.length+'-page-'+page+'-size-'+page_size+'-search-'+encodeURIComponent(search)+'-sort-'+JSON.stringify(sort);
    return {columns:rawFields,rows:matching.slice((page-1)*page_size,page*page_size),meta:{duration_ms:1,truncated:false,result_signature,pagination},query_definition:filteredQuery(steps)};
}

test.use({trace:'off'});
test.beforeAll(async () => {
    controls=execFileSync(path.resolve('../.tools/php/php.exe'),['tests/Browser/helpers/export-page-theme-controls.php'],{encoding:'utf8',timeout:60000,maxBuffer:2*1024*1024})+nativeTableTemplates();
    component=(await build({entryPoints:['resources/js/analytics.js'],bundle:true,write:false,format:'iife',loader:{'.css':'empty'}})).outputFiles[0].text;
    const built=path.resolve('public/build'),manifest=JSON.parse(fs.readFileSync(path.join(built,'manifest.json'),'utf8'));
    styles=['../css/filament/support/support.css','../css/filament/forms/forms.css','../css/filament/filament/app.css',manifest['resources/css/panel-theme.css'].file,...manifest['resources/js/analytics.js'].css].map(file=>fs.readFileSync(path.join(built,file),'utf8')).join('\n');
    console.log('Drill output assets: '+manifest['resources/js/analytics.js'].file+' / '+manifest['resources/css/panel-theme.css'].file);
});

async function mount(page,mode,width,section,race=false) {
    const errors=[],requests=[],unexpected=[],deferred={releaseA:null};
    page.on('pageerror',error=>errors.push(error.message));
    await page.setViewportSize({width,height:1000});
    const view=section==='dashboard';
    const routes={dashboards:'/admin/analytics/dashboards',reports:'/admin/analytics/reports',connections:'/admin/analytics/databases',dashboard:'/admin/analytics/dashboards/__record__'+(view?'/view':''),report:'/admin/analytics/reports/__record__',browser:'/admin/analytics/databases/__record__'};
    const markup='<main class="fi-main-ctn fi-page"><div id="analytics-studio" data-api="/analytics/api" data-csrf="fixture" data-section="'+section+'" data-read-only="'+view+'" data-record="'+(view?'125':'41')+'" data-routes="'+JSON.stringify(routes).replaceAll('"','&quot;')+'" data-initial="{}"><div data-analytics-content></div>'+controls+'</div></main>';
    await page.route('http://drill-table-fixture.test/**',async route=>{
        const request=route.request(),url=new URL(request.url());
        if(!url.pathname.startsWith('/analytics/api/'))return route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><html lang="fa" dir="rtl" class="fi '+(mode==='dark'?'dark':'')+'"><head><meta charset="utf-8"></head><body>'+markup+'</body></html>'});
        const endpoint=url.pathname.slice('/analytics/api/'.length),payload=request.method()==='POST'?request.postDataJSON():null;
        requests.push({endpoint,payload});
        if(endpoint==='library')return route.fulfill({json:library});
        if(endpoint==='reports/preview')return route.fulfill({json:originalResult});
        if(endpoint==='dashboards/125')return route.fulfill({json:dashboard});
        if(endpoint==='dashboards/125/widgets/sales/query')return route.fulfill({json:originalResult});
        if(endpoint.endsWith('/interactions/options')) {
            const result=resultFor(payload.path,payload.context.pagination);
            const column=result.columns.find(field=>field.key===payload.context.column_key),row=result.rows[payload.context.row_index];
            return route.fulfill({json:{context:{...payload.context,column_label:column.label,type:column.type,value:row?.[column.key]},actions}});
        }
        if(endpoint.endsWith('/interactions/apply')) {
            const steps=[...payload.path,{action_id:payload.action_id,context:payload.context,input:payload.input}],result=resultFor(steps);
            return route.fulfill({json:{display:payload.action_id==='underlying'?'table':null,action:actions.find(action=>action.id===payload.action_id),query_definition:result.query_definition,result}});
        }
        if(endpoint.endsWith('/interactions/page')) {
            const keys=Object.keys(payload.pagination||{}).sort();
            if(JSON.stringify(keys)!==JSON.stringify(['page','page_size','search','sort'])) {
                unexpected.push('Unexpected pagination keys: '+keys.join(','));
                return route.fulfill({status:422,json:{message:'Pagination accepts page, page_size, search and sort only.'}});
            }
            if(race&&payload.pagination.search==='A')await new Promise(resolve=>{deferred.releaseA=resolve;});
            if(race&&payload.pagination.search==='AB')return route.fulfill({status:503,json:{message:'Search AB unavailable'}});
            return route.fulfill({json:pageResult(payload.path,payload.pagination)});
        }
        unexpected.push(endpoint);return route.fulfill({status:500,json:{message:'Unexpected fixture endpoint '+endpoint}});
    });
    await page.goto('http://drill-table-fixture.test/admin/analytics/'+(view?'dashboards/125/view':'reports/41'));
    await page.addStyleTag({content:styles+'\n'+panelFontCss()});await awaitPanelFonts(page);
    await page.addScriptTag({content:component});
    await expect(page.locator('canvas')).toBeVisible();
    if(view)await page.evaluate(values=>{const app=window.analyticsStudio;app.filterValues=structuredClone(values);app.appliedValues=structuredClone(values);app.dashboardNavigation=structuredClone(values);},parameters);
    // Only the PHP form transport is replaced; production custom-filter bridging
    // and value parsing remain live. Reactive form rendering has its own suite.
    await page.evaluate(()=>{
        window.formOpenings=[];
        window.analyticsStudio.workbenchWire=()=>({openWorkbenchForm:async(kind,data,context,requestId)=>window.formOpenings.push({kind,data,context,requestId}),workbenchFailed:async(id,message)=>{throw new Error(message);}});
    });
    return {errors,requests,unexpected,deferred};
}
async function snapshot(page) {
    return page.evaluate(()=>{const app=window.analyticsStudio;return {view:app.view,report:app.report??null,reportOriginal:app.reportOriginal??null,query:app.report?.query_definition,previewResult:app.previewResult??null,filterValues:app.filterValues??{},appliedValues:app.appliedValues??{},activeTab:app.activeTab??null,dashboard:app.dashboard??null,editing:app.editing,dirty:app.dirty};});
}
async function clickChart(page) {
    await expect.poll(()=>page.evaluate(()=>{const chart=window.analyticsStudio.charts[0],dataset=chart?.data.datasets.findIndex(series=>Number(series.data[1])>0);return dataset>=0&&chart.getDatasetMeta(dataset).data[1]?.height>5;})).toBe(true);
    const point=await page.evaluate(()=>{const chart=window.analyticsStudio.charts[0],dataset=chart.data.datasets.findIndex(series=>Number(series.data[1])>0),point=chart.getDatasetMeta(dataset).data[1].getCenterPoint(),rect=chart.canvas.getBoundingClientRect();return {x:rect.left+point.x,y:rect.top+point.y};});
    await page.mouse.click(point.x,point.y);await expect(page.locator('[data-drill-menu]')).toBeVisible();
}
async function apply(page,id,table=true) {
    const openings=await page.evaluate(()=>window.formOpenings.length);
    await page.locator('[data-drill-menu] [data-drill-action="'+id+'"]').click();
    if(id==='custom_filter') {
        await expect.poll(()=>page.evaluate(()=>window.formOpenings.length)).toBe(openings+1);
        await page.evaluate(()=>{const pending=window.analyticsStudio.nativeFormPending;window.dispatchEvent(new CustomEvent('analytics-form-submitted',{detail:{requestId:pending.id,command:'submit',data:{field:'total',operator:'lt',value:'160',date_mode:'specific'}}}));});
    }
    if(table) {
        await expect(page.locator('.mb-preview-body .fi-ta-table')).toBeVisible();
        await expect(page.locator('.mb-preview-body canvas')).toHaveCount(0);
    }
}
async function assertChrome(page,section) {
    const root=page.locator('#analytics-studio');
    if(section==='dashboard') {
        await expect(root.locator('.mb-toolbar,.mb-workbench-tools,.mb-native-editor,.mb-notebook,.mb-notebook-v2,.mb-preview-meta')).toHaveCount(0);
        await expect(root.locator('[data-action="reportSaveDialog"],[data-action="showSql"],[data-action="toggleNotebook"]')).toHaveCount(0);
    } else {
        await expect(root.locator('.mb-toolbar')).toBeVisible();
        await expect(root.locator('[data-action="reportSaveDialog"]')).toBeVisible();
        await expect(root.locator('[data-action="showSql"]')).toBeVisible();
    }
}
async function assertTable(page,frames,pagination=defaultPagination,total=2505) {
    await expect.poll(()=>page.evaluate(()=>window.analyticsStudio.drillSession?.frames.length)).toBe(frames);
    await expect.poll(()=>page.evaluate(()=>window.analyticsStudio.previewResult?.meta?.pagination)).toEqual({...pagination,total});
    const result=pageResult(Array(frames).fill({action_id:'filter:gt'}),pagination),table=page.locator('.mb-preview-body .fi-ta-table');
    await expect(table.locator('thead th')).toHaveCount(rawFields.length);
    await expect(table.locator('tbody tr')).toHaveCount(result.rows.length);
    await expect(table.locator('[data-column="id"]')).toHaveCount(result.rows.length);
    await expect(table.locator('[data-column="total"]').first()).toBeVisible();
    await expect(table.locator('[data-column="customer_id"]').first()).toBeVisible();
    await expect(table.locator('[data-column="sales"]')).toHaveCount(0);
    expect(await page.evaluate(()=>{const app=window.analyticsStudio;return {display:app.report.display,frames:app.drillSession.frames.map(frame=>frame.display),mode:app.report.query_definition.mode,metrics:app.report.query_definition.metrics,first:app.previewResult.rows[0]?.id,last:app.previewResult.rows.at(-1)?.id,hidden:app.report.visualization_settings.visible_columns};})).toEqual({display:'table',frames:Array(frames).fill('table'),mode:'rows',metrics:[],first:result.rows[0]?.id,last:result.rows.at(-1)?.id,hidden:undefined});
    await expect(page.locator('[data-drill-breadcrumb]')).toBeVisible();
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
}
async function restoreSource(page,source,section) {
    await page.locator('[data-action="returnFromDrill"]').click();await expect(page.locator('canvas')).toBeVisible();
    await expect(page.locator('[data-drill-breadcrumb]')).toHaveCount(0);
    expect(await snapshot(page)).toEqual(source);
    expect(await page.evaluate(()=>window.analyticsStudio.drillSession)).toBeNull();
    await assertChrome(page,section);
    if(section==='dashboard')expect(new URL(page.url()).pathname).toBe('/admin/analytics/dashboards/125/view');
}

for(const mode of ['light','dark'])for(const width of [1440,390])for(const section of ['report','dashboard']) {
    test('underlying-record tables and source restoration: '+(section==='dashboard'?'dashboard View':'report editor')+' '+mode+' '+width,async({page},testInfo)=>{
        test.setTimeout(180000);
        const state=await mount(page,mode,width,section),source=await snapshot(page);
        await clickChart(page);await apply(page,'underlying');await assertTable(page,1);await assertChrome(page,section);
        await page.locator('.mb-preview-body [data-table-cell][data-column="total"]').first().click();
        await expect(page.locator('[data-drill-menu]')).toBeVisible();
        await apply(page,'custom_filter');await assertTable(page,2);await assertChrome(page,section);
        const custom=state.requests.filter(request=>request.endpoint.endsWith('/interactions/apply')).at(-1);
        expect(custom.payload.input).toEqual({operator:'lt',value:160});
        await page.locator('.mb-preview-body [data-table-cell][data-column="customer_id"]').first().click();
        await apply(page,'foreign_filter');await assertTable(page,3);await assertChrome(page,section);
        const calls=state.requests.filter(request=>request.endpoint.endsWith('/interactions/apply'));
        expect(calls.map(request=>request.payload.action_id)).toEqual(['underlying','custom_filter','foreign_filter']);
        expect(calls.map(request=>request.payload.path.length)).toEqual([0,1,2]);
        for(const request of calls) {
            if(section==='dashboard')expect(request.payload.parameters).toEqual(parameters);
            else expect(request.payload.query_definition).toEqual(definition);
        }
        expect(calls[1].payload.context.pagination).toEqual(defaultPagination);
        expect(calls[1].payload.context.result_signature).toBe(pageResult(calls[1].payload.path).meta.result_signature);
        await page.locator('[data-action="goDrillHistory"][data-index="0"]').click();await assertTable(page,1);
        if(section==='report')await page.screenshot({path:testInfo.outputPath('raw-filtered-'+mode+'-'+width+'.png'),fullPage:false});
        await restoreSource(page,source,section);
        expect(state.errors).toEqual([]);expect(state.unexpected).toEqual([]);
    });
}

test('dashboard View remotely pages all raw matches, searches late records and preserves page-local drill/history context',async({page})=>{
    test.setTimeout(180000);
    const state=await mount(page,'dark',1440,'dashboard'),source=await snapshot(page);
    const table=page.locator('.mb-preview-body');
    const pageCalls=()=>state.requests.filter(request=>request.endpoint.endsWith('/interactions/page'));
    await clickChart(page);await apply(page,'underlying');await assertTable(page,1);await assertChrome(page,'dashboard');
    await table.locator('[data-page="next"]:visible').first().click();
    await assertTable(page,1,{...defaultPagination,page:2});
    expect(pageCalls().at(-1).payload.pagination).toEqual({...defaultPagination,page:2});
    await table.locator('[data-page="100"]:visible').click();
    const lastPage={...defaultPagination,page:101};
    await assertTable(page,1,lastPage);
    expect(pageCalls().at(-1).payload.pagination).toEqual(lastPage);
    expect(await page.evaluate(()=>window.analyticsStudio.previewResult.rows.length)).toBe(5);
    await table.locator('[data-table-cell][data-column="total"]').first().click();
    await expect(page.locator('[data-drill-menu]')).toBeVisible();
    const lastContext=state.requests.filter(request=>request.endpoint.endsWith('/interactions/options')).at(-1).payload.context;
    expect(lastContext).toMatchObject({column_key:'total',row_index:0,pagination:lastPage,result_signature:pageResult([{action_id:'filter:gt'}],lastPage).meta.result_signature});
    expect(Object.keys(lastContext.pagination).sort()).toEqual(['page','page_size','search','sort']);
    await apply(page,'custom_filter');await assertTable(page,2);
    expect(state.requests.filter(request=>request.endpoint.endsWith('/interactions/apply')).at(-1).payload.context).toEqual(lastContext);
    const beforeHistory=pageCalls().length;
    await page.locator('[data-action="goDrillHistory"][data-index="0"]').click();await assertTable(page,1,lastPage);
    expect(pageCalls()).toHaveLength(beforeHistory);
    await table.locator('[data-table-page-size]:visible').first().selectOption('100');
    const largePage={...defaultPagination,page_size:100};
    await assertTable(page,1,largePage);
    expect(pageCalls().at(-1).payload.pagination).toEqual(largePage);
    await table.locator('[data-page="next"]:visible').first().click();
    await assertTable(page,1,{...largePage,page:2});
    await table.locator('[data-result-search]').fill('Late record 2505');
    const searched={...largePage,search:'Late record 2505'};
    await assertTable(page,1,searched,1);
    await expect(table.locator('[data-column="note"]')).toHaveText('Late record 2505');
    expect(pageCalls().at(-1).payload.pagination).toEqual(searched);
    await table.locator('[data-table-cell][data-column="customer_id"]').click();
    await expect(page.locator('[data-drill-menu]')).toBeVisible();
    const searchContext=state.requests.filter(request=>request.endpoint.endsWith('/interactions/options')).at(-1).payload.context;
    expect(searchContext).toMatchObject({row_index:0,pagination:searched,result_signature:pageResult([{action_id:'filter:gt'}],searched).meta.result_signature});
    await apply(page,'foreign_filter');await assertTable(page,2);
    expect(state.requests.filter(request=>request.endpoint.endsWith('/interactions/apply')).at(-1).payload.context).toEqual(searchContext);
    await page.locator('[data-action="goDrillHistory"][data-index="0"]').click();await assertTable(page,1,searched,1);
    await expect(table.locator('[data-result-search]')).toHaveValue('Late record 2505');
    await table.locator('[data-result-search]').fill('');await assertTable(page,1,largePage);
    expect(pageCalls().every(request=>Object.keys(request.payload.pagination).sort().join(',')==='page,page_size,search,sort')).toBe(true);
    expect(pageCalls().length).toBeGreaterThanOrEqual(6);
    expect(state.requests.filter(request=>request.endpoint==='reports/preview')).toHaveLength(0);
    await assertChrome(page,'dashboard');await restoreSource(page,source,'dashboard');
    expect(state.errors).toEqual([]);expect(state.unexpected).toEqual([]);
});

test('a stale page response cannot overwrite app or history while the newer search waits for debounce and then fails',async({page})=>{
    test.setTimeout(180000);
    await page.clock.install({time:new Date('2026-11-15T12:00:00Z')});
    const state=await mount(page,'light',1440,'dashboard',true),table=page.locator('.mb-preview-body');
    try {
        await clickChart(page);await apply(page,'underlying');await assertTable(page,1);
        await table.locator('[data-page="next"]:visible').first().click();
        const previousPage={...defaultPagination,page:2};await assertTable(page,1,previousPage);
        const loaded=()=>page.evaluate(()=>{const app=window.analyticsStudio;return {preview:app.previewResult,history:app.drillSession.frames[0].result};});
        const previous=await loaded(),visible=await table.locator('tbody').innerText();
        // Freeze only scheduling; real fetch, frame commits and table rendering run unchanged.
        await page.clock.pauseAt(new Date('2026-11-15T12:10:00Z'));
        await page.evaluate(()=>{
            const app=window.analyticsStudio,fetchPage=app.fetchDrillPage;
            window.observedPageASettled=false;
            app.fetchDrillPage=async function(frame,pagination,isCurrent){
                try {return await fetchPage.call(this,frame,pagination,isCurrent);}
                finally {if(pagination.search==='A')window.observedPageASettled=true;}
            };
        });
        await table.locator('[data-result-search]').fill('A');
        await page.clock.runFor(201);
        await expect.poll(()=>typeof state.deferred.releaseA).toBe('function');
        await table.locator('[data-result-search]').fill('AB');
        expect(state.requests.some(request=>request.payload?.pagination?.search==='AB')).toBe(false);
        state.deferred.releaseA();
        await expect.poll(()=>page.evaluate(()=>window.observedPageASettled)).toBe(true);
        // AB has not started: typing it must already invalidate A's app/history commit.
        expect(state.requests.some(request=>request.payload?.pagination?.search==='AB')).toBe(false);
        expect(await loaded()).toEqual(previous);
        await expect(table.locator('tbody')).toHaveText(visible);
        await page.clock.runFor(201);
        await expect(table.locator('[data-table-error]')).toHaveText('Search AB unavailable');
        expect(state.requests.some(request=>request.payload?.pagination?.search==='AB')).toBe(true);
        expect(await loaded()).toEqual(previous);
        await assertTable(page,1,previousPage);
        await expect(table.locator('tbody')).toHaveText(visible);
        await expect(table.locator('[data-result-search]')).toHaveValue('');
        await expect(table).toHaveAttribute('aria-busy','false');
        expect(state.errors).toEqual([]);expect(state.unexpected).toEqual([]);
    } finally {state.deferred.releaseA?.();}
});

for(const mode of ['light','dark'])for(const section of ['report','dashboard']) {
    test('standard Metabase quick filter preserves all displays: '+section+' '+mode,async({page})=>{
        test.setTimeout(180000);
        const state=await mount(page,mode,1440,section);
        for(const display of ['bar','line','area','pie','doughnut','scatter','funnel','number','progress','gauge','table','pivot']) {
            await page.evaluate(({display,section})=>{
                const app=window.analyticsStudio;
                if(section==='dashboard')app.dashboard.widgets[0].settings.display=display;
                else {app.report.display=display;app.reportOriginal=structuredClone(app.report);}
                app.render();
            },{display,section});
            const source=await snapshot(page),before=state.requests.length;
            await page.evaluate(async section=>{
                const app=window.analyticsStudio;
                const context={column_key:'sales',row_index:1,kind:'point',result_signature:'original-signed',anchor:app.root};
                if(section==='dashboard')await app.cardClicked(app.dashboard.widgets[0],app.results.get('sales').rows[1],context);
                else await app.reportResultClicked(app.previewResult.rows[1],context);
            },section);
            await expect(page.locator('[data-drill-menu] [data-drill-action="filter:gt"]')).toHaveText('>');
            await apply(page,'filter:gt',false);
            await expect.poll(()=>page.evaluate(()=>window.analyticsStudio.drillSession?.frames.length)).toBe(1);
            const actual=await page.evaluate(()=>{
                const app=window.analyticsStudio;
                return {display:app.report.display,frameDisplay:app.drillSession.frames[0].display,columns:app.previewResult.columns,rows:app.previewResult.rows,mode:app.report.query_definition.mode,metrics:app.report.query_definition.metrics,visible:app.report.visualization_settings.visible_columns,settings:{x:app.report.visualization_settings.x,y:app.report.visualization_settings.y},filters:app.filterValues??{},applied:app.appliedValues??{}};
            });
            expect(actual).toEqual({display,frameDisplay:display,columns:aggregateFields,rows:[aggregateRows[0]],mode:'aggregate',metrics:definition.metrics,visible:['status'],settings:{x:'status',y:'sales'},filters:source.filterValues,applied:source.appliedValues});
            if(display==='table'||display==='pivot')await expect(page.locator('.mb-preview-body .fi-ta-table')).toBeVisible();
            else if(['number','gauge','progress'].includes(display))await expect(page.locator('.mb-preview-body .mb-stat')).toBeVisible();
            else if(display==='funnel')await expect(page.locator('.mb-preview-body .mb-funnel')).toBeVisible();
            else await expect(page.locator('.mb-preview-body canvas')).toBeVisible();
            await assertChrome(page,section);
            const calls=state.requests.slice(before).filter(request=>request.endpoint.endsWith('/interactions/apply'));
            expect(calls).toHaveLength(1);expect(calls[0].payload.action_id).toBe('filter:gt');
            expect(state.requests.slice(before).some(request=>request.endpoint.endsWith('/interactions/page'))).toBe(false);
            await page.locator('[data-action="returnFromDrill"]').click();
            await expect(page.locator('[data-drill-breadcrumb]')).toHaveCount(0);
            expect(await snapshot(page)).toEqual(source);
        }
        expect(state.errors).toEqual([]);expect(state.unexpected).toEqual([]);
    });
}
