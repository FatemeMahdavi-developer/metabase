import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { build } from 'esbuild';
import { panelFontCss, awaitPanelFonts } from './helpers/panel-fonts.js';

let backend, fixtures, scripts, styles;
const waiting = [];
function requestComponent(payload) {
    return new Promise((resolve,reject) => {
        const timer = setTimeout(() => reject(new Error('Local filter Livewire transport timed out')),60000);
        waiting.push({resolve:value => {clearTimeout(timer);resolve(value);},reject:error => {clearTimeout(timer);reject(error);}});
        backend.stdin.write(JSON.stringify(payload)+'\n');
    });
}

test.use({trace:'off'});
test.beforeAll(async () => {
    backend = spawn(path.resolve('../.tools/php/php.exe'),['tests/Browser/helpers/reactive-filter-component.php'],{cwd:process.cwd(),stdio:['pipe','pipe','pipe']});
    let output = '', stderr = '';
    backend.stdout.setEncoding('utf8');
    backend.stderr.setEncoding('utf8');
    backend.stderr.on('data',chunk => {stderr+=chunk;});
    backend.stdout.on('data',chunk => {
        output += chunk;
        let end;
        while ((end=output.indexOf('\n')) !== -1) {
            const line=output.slice(0,end).trim();output=output.slice(end+1);
            if (!line) continue;
            const pending=waiting.shift();
            try {
                const result=JSON.parse(line);
                if (result.fixtureError) pending.reject(new Error(result.fixtureError));
                else pending.resolve(result);
            } catch (error) {pending?.reject(new Error(error.message+' '+line.slice(0,250)));}
        }
    });
    backend.on('error',error => waiting.splice(0).forEach(item=>item.reject(error)));
    backend.on('exit',code => waiting.splice(0).forEach(item=>item.reject(new Error('Filter fixture exited '+code+': '+stderr))));
    fixtures={};
    for(const scenario of ['dashboard-date','report-date','dashboard-number']) fixtures[scenario]=await requestComponent({command:'initial',fixture:'date',scenario});
    const bundle=await build({stdin:{resolveDir:process.cwd(),contents:[
        'import {Livewire,Alpine} from "./vendor/livewire/livewire/dist/livewire.esm.js";',
        'import select from "./public/js/filament/forms/components/select.js";',
        'import datePicker from "./public/js/filament/forms/components/date-time-picker.js";',
        'import {soarFloatingField} from "./resources/js/filament-forms.js";',
        'import {nativeFormMethods} from "./resources/js/analytics/native-forms.js";',
        'import {filterEnhancements} from "./resources/js/analytics/filter-enhancements.js";',
        'import {dashboardMethods} from "./resources/js/analytics/dashboards.js";',
        'window.dateFilterBridgeMethods={nativeFormMethods,filterEnhancements,dashboardMethods};',
        'window.Livewire=Livewire;window.Alpine=Alpine;',
        'Alpine.data("selectFormComponent",select);Alpine.data("dateTimePickerFormComponent",datePicker);Alpine.data("soarFloatingField",soarFloatingField);',
        'document.querySelectorAll("[x-load]").forEach(node=>{node.removeAttribute("x-load");node.removeAttribute("x-load-src");});',
        'window.dateSubmissions=[];addEventListener("analytics-form-submitted",event=>window.dateSubmissions.push(event.detail));',
        'window.fixtureMorphs=0;Livewire.hook("morphed",()=>window.fixtureMorphs++);',
        'Livewire.start();dispatchEvent(new CustomEvent("open-modal",{detail:{id:"analytics-native-form"}}));',
    ].join('\n')},bundle:true,write:false,format:'iife'});
    scripts=[fs.readFileSync('vendor/filament/support/dist/index.js','utf8'),bundle.outputFiles[0].text];
    const built=path.resolve('public/build'),manifest=JSON.parse(fs.readFileSync(path.join(built,'manifest.json'),'utf8'));
    console.log('Date filter assets: '+manifest['resources/css/panel-theme.css'].file+' / '+manifest['resources/js/analytics.js'].css.join(','));
    styles=['../css/filament/support/support.css','../css/filament/forms/forms.css','../css/filament/filament/app.css',manifest['resources/css/panel-theme.css'].file,...manifest['resources/js/analytics.js'].css].map(file=>fs.readFileSync(path.join(built,file),'utf8')).join('\n');
});
test.afterAll(async () => {
    backend?.stdin.end();
    if(backend?.exitCode===null) await new Promise(resolve=>{
        const timer=setTimeout(()=>{backend.kill();resolve();},5000);
        backend.once('exit',()=>{clearTimeout(timer);resolve();});
    });
});

const field=(form,key)=>form.locator('[data-fixture-filter-field="'+key+'"]');
let currentScenario='dashboard-date',nextPostUpdates=null;
async function choose(page,form,key,value) {
    const before=await page.evaluate(()=>window.fixtureMorphs),wrapper=field(form,key);
    await wrapper.locator('.choices__inner').click();
    await wrapper.locator('.choices__item--choice[data-value="'+value+'"]').click();
    await expect(wrapper.locator('select')).toHaveValue(value);
    await expect.poll(()=>page.evaluate(()=>window.fixtureMorphs)).toBeGreaterThan(before);
}
async function pickDay(page,form,key,day,testInfo,screenshot) {
    const wrapper=field(form,key),picker=wrapper.locator('.fi-fo-date-time-picker');
    await expect(picker).toBeVisible();
    const display=picker.locator('.fi-fo-date-time-picker-display-text-input');
    await expect(display).toHaveAttribute('readonly');
    const trigger=picker.locator('button[x-ref="button"]'),panel=picker.locator('.fi-fo-date-time-picker-panel');
    await trigger.click();await expect(panel).toBeVisible();
    // Seeded November2026 values make the genuine day grid deterministic.
    await expect(panel.locator('select')).toHaveValue('10');
    await expect(panel.locator('input[type="number"]').first()).toHaveValue('2026');
    await expect.poll(()=>panel.evaluate(node=>{
        const r=node.getBoundingClientRect();return r.left>=-1&&r.right<=innerWidth+1&&r.top>=-1&&r.bottom<=innerHeight+1;
    })).toBe(true);
    if(screenshot)await page.screenshot({path:testInfo.outputPath(screenshot),fullPage:false});
    await panel.locator('[role="grid"] [role="option"]').filter({hasText:new RegExp('^'+day+'$')}).click();
    await expect(display).toHaveValue('2026-11-'+String(day).padStart(2,'0'));
    if(await panel.isVisible())await trigger.click();
    await expect(panel).toBeHidden();await expect(form).toBeVisible();
}
async function submit(page,form,expected,invalid=false) {
    const before=await page.evaluate(()=>({events:window.dateSubmissions.length,morphs:window.fixtureMorphs}));
    await form.locator('button[type="submit"]').click();
    await expect.poll(()=>page.evaluate(()=>window.fixtureMorphs)).toBeGreaterThan(before.morphs);
    if(invalid) {
        await expect(form.locator('.fi-fo-field-wrp-error-message').first()).toBeVisible();
        expect(await page.evaluate(()=>window.dateSubmissions.length)).toBe(before.events);
        await expect(form).toBeVisible();
    } else {
        await expect.poll(()=>page.evaluate(()=>window.dateSubmissions.length)).toBe(before.events+1);
        const result=await page.evaluate(()=>window.dateSubmissions.at(-1));
        expect(result.command).toBe('submit');expect(result.data).toMatchObject(expected);
        await expect(form.locator('.fi-fo-field-wrp-error-message')).toHaveCount(0);
        return result.data;
    }
}
async function mount(page,scenario,mode,width) {
    currentScenario=scenario;nextPostUpdates=null;
    await page.setViewportSize({width,height:1100});await page.goto('http://date-filter-fixture.test/');
    await page.locator('html').evaluate((node,mode)=>node.classList.toggle('dark',mode==='dark'),mode);
    await page.addStyleTag({content:styles+'\n'+fixtures[scenario].palette+'\n'+panelFontCss()});await awaitPanelFonts(page);
    for(const content of scripts)await page.addScriptTag({content});
    const form=page.locator('#analytics-native-form-body');await expect(form).toBeVisible();return form;
}

// Reuse this genuine rendered form; only the wire opener and the surrounding app
// host are adapted. The callback, submit listener, value conversion, filter apply
// and widget request construction all run their production implementations.
async function armScalarWidgetBridge(page) {
    await page.evaluate(async () => {
        const {nativeFormMethods,filterEnhancements,dashboardMethods}=window.dateFilterBridgeMethods;
        const fixtureRoot=document.querySelector('#analytics-studio');
        const wire=window.Livewire.find(fixtureRoot.getAttribute('wire:id'));
        const host=document.createElement('div');document.body.append(host);
        const widgets=['between','eq','native'].map((key,index)=>({key,type:'report',report_id:index+1,settings:{}}));
        for(const widget of widgets) {
            const card=document.createElement('article');card.dataset.widget=widget.key;
            card.append(Object.assign(document.createElement('div'),{className:'mb-card-body'}));host.append(card);
        }
        const filter={key:'period',type:'date',required:false,settings:{},bindings:widgets.map(widget=>({widget_key:widget.key,target:'created_at',operator:widget.key==='between'?'between':'eq'}))};
        const app=Object.assign({},nativeFormMethods,filterEnhancements,dashboardMethods,{
            root:host,epoch:0,editing:false,filterValues:{period:null},appliedValues:{period:null},
            dashboard:{id:125,settings:{auto_apply:true},filters:[filter],widgets},
            library:{reports:widgets.map(widget=>({id:widget.report_id,version:1,query_definition:{mode:widget.key==='native'?'native':'rows'}}))},
            results:new Map(),cardCache:new Map(),cardPromises:new Map(),bridgeErrors:[],
            closeModal(){},draw(){},runtimeVisualizationSettings(result,query,settings){return settings;},
            workbenchWire(){return {
                openWorkbenchForm:async(kind,data,context,requestId)=>{
                    this.bridgeOpening={kind,data,context};
                    // Keep the signed genuine form and route its real submit event
                    // to the request ID generated by production nativeForm().
                    await wire.$set('workbenchRequest',requestId,false);
                },
                workbenchFailed:async(id,message)=>this.bridgeErrors.push(message),
            };},
            async request(endpoint,method,data){
                const response=await fetch('/analytics/api/'+endpoint,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
                if(!response.ok)throw new Error('Widget fixture request failed '+response.status);
                return response.json();
            },
            render(){this.bridgeLoading=Promise.all(this.dashboard.widgets.map(widget=>this.loadCard(widget)));},
        });
        app.initializeNativeForms();window.scalarWidgetBridge=app;
        await app.openNativeFilterValue(filter);
    });
    expect(await page.evaluate(()=>window.scalarWidgetBridge.bridgeOpening.context.operator)).toBe('between');
}
async function assertScalarWidgetBridge(page,form,requests) {
    await expect.poll(()=>requests.length).toBe(3);
    await page.evaluate(()=>window.scalarWidgetBridge.bridgeLoading);
    expect(requests.map(request=>request.widget).sort()).toEqual(['between','eq','native']);
    for(const request of requests)expect(request.payload).toEqual({parameters:{period:'2026-11-04'},refresh:false});
    expect(await page.evaluate(()=>({
        current:window.scalarWidgetBridge.filterValues,applied:window.scalarWidgetBridge.appliedValues,
        errors:window.scalarWidgetBridge.bridgeErrors,loaded:window.scalarWidgetBridge.results.size,
    }))).toEqual({current:{period:'2026-11-04'},applied:{period:'2026-11-04'},errors:[],loaded:3});
    await expect(form).toBeHidden();
    await page.evaluate(()=>{
        const app=window.scalarWidgetBridge;
        window.removeEventListener('analytics-form-submitted',app.nativeFormListener);
        window.removeEventListener('modal-closed',app.nativeDismissListener,true);app.root.remove();
        window.dispatchEvent(new CustomEvent('open-modal',{detail:{id:'analytics-native-form'}}));
    });
    await expect(form).toBeVisible();
    console.log('Genuine single-date form event -> production callback/apply/loadCard posted scalar ISO to between, eq and native widgets');
}
test('dashboard and report date filters select real calendar dates and reject bad ranges locally',async({page},testInfo)=>{
    test.setTimeout(360000);
    const errors=[],transportErrors=[],widgetRequests=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('http://date-filter-fixture.test/**',async route=>{
        const widget=new URL(route.request().url()).pathname.match(/^\/analytics\/api\/dashboards\/125\/widgets\/(between|eq|native)\/query$/);
        if(widget){
            widgetRequests.push({widget:widget[1],payload:route.request().postDataJSON()});
            return route.fulfill({json:{columns:[],rows:[],meta:{truncated:false}}});
        }
        if(route.request().method()==='POST') {
            const payload=route.request().postDataJSON();
            if(nextPostUpdates) {
                const submit=payload.components.find(component=>component.calls.some(call=>call.method==='submitWorkbenchForm'));
                if(submit){Object.assign(submit.updates,nextPostUpdates);nextPostUpdates=null;}
            }
            try{return await route.fulfill({json:await requestComponent(payload)});}
            catch(error){transportErrors.push(error.message);return route.fulfill({status:500,json:{fixtureError:error.message}});}
        }
        const fixture=fixtures[currentScenario];
        return route.fulfill({contentType:'text/html;charset=utf-8',body:'<!doctype html><html lang="fa" dir="rtl" class="fi"><head><meta charset="utf-8">'+fixture.livewireStyles+'<script>window.livewireScriptConfig={uri:"/livewire/update",csrf:"fixture",nonce:"",progressBar:true};</script></head><body class="fi-body"><main class="fi-main"><section class="fi-page">'+fixture.markup+'</section></main></body></html>'});
    });
    // New fields after real morphs use their actual lazy-loaded Vendor modules.
    for(const name of ['select','date-time-picker'])await page.route('**/js/filament/forms/components/'+name+'.js*',route=>route.fulfill({contentType:'application/javascript',headers:{'access-control-allow-origin':'*'},body:fs.readFileSync('public/js/filament/forms/components/'+name+'.js','utf8')}));
    for(const width of [1440,390])for(const mode of ['light','dark']) {
        let form=await mount(page,'dashboard-date',mode,width);
        await expect(form.locator('.fi-fo-date-time-picker')).toHaveCount(2);
        await pickDay(page,form,'date_from',10,testInfo,'calendar-'+mode+'-'+width+'.png');
        await pickDay(page,form,'date_to',20,testInfo);
        let data=await submit(page,form,{value_mode:'range',date_from:'2026-11-10',date_to:'2026-11-20'});
        expect(data).not.toHaveProperty('from');expect(data).not.toHaveProperty('to');
        const display=field(form,'date_from').locator('.fi-fo-date-time-picker-display-text-input');
        await display.focus();await display.pressSequentially('garbage');await expect(display).toHaveValue('2026-11-10');
        // Simulate an invalid posted draft; validation must stop it before the submit bridge event.
        nextPostUpdates={'workbenchData.date_from':'garbage'};await submit(page,form,{},true);
        await pickDay(page,form,'date_from',20,testInfo);await pickDay(page,form,'date_to',10,testInfo);
        await submit(page,form,{},true);
        await pickDay(page,form,'date_to',25,testInfo);
        await submit(page,form,{value_mode:'range',date_from:'2026-11-20',date_to:'2026-11-25'});
        await choose(page,form,'value_mode','none');await expect(form.locator('.fi-fo-date-time-picker')).toHaveCount(0);
        data=await submit(page,form,{value_mode:'none'});expect(data).not.toHaveProperty('date_from');expect(data).not.toHaveProperty('date_to');
        await choose(page,form,'value_mode','specific');
        const verifyWidgetBridge=width===1440&&mode==='light';
        if(verifyWidgetBridge)await armScalarWidgetBridge(page);
        await pickDay(page,form,'date_value',verifyWidgetBridge?4:15,testInfo);
        await submit(page,form,{value_mode:'specific',date_value:verifyWidgetBridge?'2026-11-04':'2026-11-15'});
        if(verifyWidgetBridge)await assertScalarWidgetBridge(page,form,widgetRequests);
        await choose(page,form,'value_mode','relative');await expect(form.locator('.fi-fo-date-time-picker')).toHaveCount(0);
        await submit(page,form,{value_mode:'relative',relative_amount:7,relative_unit:'day',relative_direction:'past'});
        await choose(page,form,'value_mode','presence');data=await submit(page,form,{value_mode:'presence',presence_empty:false});expect(data).not.toHaveProperty('date_value');
        await choose(page,form,'value_mode','parts');await submit(page,form,{value_mode:'parts',date_part:'month',part_values:'1,2'});
        await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
        console.log('Dashboard date calendar '+mode+'/'+width+' passed ISO submit, invalid/reversed local validation and modes');

        form=await mount(page,'report-date',mode,width);
        await pickDay(page,form,'date_value',15,testInfo);
        await submit(page,form,{field:'created_at',operator:'eq',date_value:'2026-11-15'});
        await choose(page,form,'operator','between');await pickDay(page,form,'date_from',10,testInfo);await pickDay(page,form,'date_to',20,testInfo);
        await submit(page,form,{operator:'between',date_from:'2026-11-10',date_to:'2026-11-20'});
        await pickDay(page,form,'date_from',25,testInfo);await submit(page,form,{},true);
        await choose(page,form,'operator','is_null');data=await submit(page,form,{operator:'is_null'});
        expect(data).not.toHaveProperty('date_from');expect(data).not.toHaveProperty('date_to');expect(data).not.toHaveProperty('date_value');
        console.log('Report date calendar '+mode+'/'+width+' passed genuine dates and local range validation');
    }
    const form=await mount(page,'dashboard-number','light',1440);await expect(form.locator('.fi-fo-date-time-picker')).toHaveCount(0);
    await field(form,'from').locator('input').fill('1.25');await field(form,'to').locator('input').fill('42.5');
    const number=await submit(page,form,{value_mode:'range',from:'1.25',to:'42.5'});expect(number).not.toHaveProperty('date_from');expect(number).not.toHaveProperty('date_to');
    expect(transportErrors).toEqual([]);expect(errors).toEqual([]);
});
