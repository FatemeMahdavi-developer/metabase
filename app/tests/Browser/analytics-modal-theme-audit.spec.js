import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { panelFontCss, awaitPanelFonts } from './helpers/panel-fonts.js';
import { nativeTableTemplates } from './helpers/native-table-templates.js';

// The inventory mounts one genuine server-rendered schema at a time; recording every large DOM snapshot is unnecessary.
test.use({trace:"off"});
let fixtures, script, styles, support, application, tableTemplates;
test.beforeAll(async()=>{
    fixtures=JSON.parse(execFileSync(path.resolve('../.tools/php/php.exe'),['tests/Browser/helpers/export-analytics-modal-audit.php'],
        {encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024}));
    const bundle=await build({stdin:{resolveDir:process.cwd(),contents:[
        'import { Livewire, Alpine } from "./vendor/livewire/livewire/dist/livewire.esm.js";',
        'import select from "./public/js/filament/forms/components/select.js";',
        'import colorPicker from "./public/js/filament/forms/components/color-picker.js";',
        'import "./resources/js/filament-forms.js";',
        'import { openFilamentModal, closeFilamentModal } from "./resources/js/analytics/filament-modal.js";',
        'import { button } from "./resources/js/analytics/ui.js";',
        'import { dashboardMethods } from "./resources/js/analytics/dashboards.js";',
        'window.Livewire=Livewire; window.Alpine=Alpine;',
        'Alpine.data("selectFormComponent",select); Alpine.data("colorPickerFormComponent",colorPicker);',
        'document.querySelectorAll("[x-load]").forEach(node=>{node.removeAttribute("x-load");node.removeAttribute("x-load-src");});',
        'window.ModalAudit={open(title,body,footer,side=false,wide=false){return openFilamentModal(document.getElementById("analytics-studio"),{title,body,footer,side,wide});},close(){closeFilamentModal(document.getElementById("analytics-studio"));},button,legacyRelated(app,widget,row){return dashboardMethods.cardClicked.call(app,widget,row);}};',
        'Livewire.start();',
        'Alpine.nextTick(()=>{window.modalAuditReady=true;});',
    ].join('\n')},bundle:true,write:false,format:'iife'});
    script=bundle.outputFiles[0].text;
    application=(await build({entryPoints:['resources/js/analytics.js'],bundle:true,write:false,format:'iife',loader:{'.css':'empty'}})).outputFiles[0].text;
    tableTemplates=nativeTableTemplates();
    support=fs.readFileSync('vendor/filament/support/dist/index.js','utf8');
    const built=path.resolve('public/build'),manifest=JSON.parse(fs.readFileSync(path.join(built,'manifest.json'),'utf8'));
    console.log('Modal audit shared asset: '+manifest['resources/css/panel-theme.css'].file);
    styles=['../css/filament/support/support.css','../css/filament/forms/forms.css','../css/filament/filament/app.css',
        manifest['resources/css/panel-theme.css'].file,...manifest['resources/js/analytics.js'].css]
        .map(file=>fs.readFileSync(path.join(built,file),'utf8')).join('\n');
});

function acknowledge(payload){
    return {components:payload.components.map(component=>{
        const snapshot=JSON.parse(component.snapshot);
        for(const [key,value] of Object.entries(component.updates)){
            let state=snapshot.data; const keys=key.split('.');
            for(const part of keys.slice(0,-1)){if(Array.isArray(state)&&state[1]?.s)state=state[0];state=state[part];}
            if(Array.isArray(state)&&state[1]?.s)state=state[0];state[keys.at(-1)]=value;
        }
        return {snapshot:JSON.stringify(snapshot),effects:{returns:component.calls.map(call=>call.method.startsWith('getFormSelect')?[]:null)}};
    }),assets:[]};
}

async function buttonPaint(button){
    return button.evaluate(node=>{
        const style=getComputedStyle(node);
        return Object.fromEntries(['backgroundColor','color','borderRadius','height','minWidth','fontFamily','fontSize','fontWeight','lineHeight','paddingLeft','paddingRight','boxShadow','whiteSpace'].map(key=>[key,style[key]]));
    });
}
const modalEvent=(page,name,id)=>page.evaluate(({name,id})=>dispatchEvent(new CustomEvent(name,{detail:{id}})),{name,id});

async function mountNative(page,scenario){
    await page.evaluate(html=>{const fragment=document.createElement('template');fragment.innerHTML=html;fragment.content.querySelectorAll('[x-load]').forEach(node=>{node.removeAttribute('x-load');node.removeAttribute('x-load-src');});document.getElementById('modal-audit-native-host').replaceChildren(fragment.content);},fixtures.cases[scenario].html);
    await expect.poll(async()=>{const modal=page.locator('[data-modal-audit-case="'+scenario+'"] .fi-modal').first();return modal.evaluate(node=>Boolean(node._x_dataStack?.some(state=>'isOpen' in state)));}).toBe(true);
}


async function assertModalSurface(modal,mode,name){
    const target=mode==='dark'?'rgb(0, 0, 0)':'rgb(255, 255, 255)';
    await expect(modal,name).toBeVisible();
    await expect(modal).toHaveCSS('background-color',target);
    const corners=await modal.evaluate(node=>{
        const windowStyle=getComputedStyle(node),header=node.querySelector('.fi-modal-header'),footer=node.querySelector('.fi-modal-footer');
        const result={};
        if(header){const style=getComputedStyle(header);result.header=[style.borderTopLeftRadius,style.borderTopRightRadius];result.top=[windowStyle.borderTopLeftRadius,windowStyle.borderTopRightRadius];}
        if(footer){const style=getComputedStyle(footer);result.footer=[style.borderBottomLeftRadius,style.borderBottomRightRadius];result.bottom=[windowStyle.borderBottomLeftRadius,windowStyle.borderBottomRightRadius];}
        return result;
    });
    if(corners.header)expect(corners.header,name+' header follows the shared rounded window corners').toEqual(corners.top);
    if(corners.footer)expect(corners.footer,name+' footer follows the shared rounded window corners').toEqual(corners.bottom);
}

async function assertModal(modal,reference,mode,name){
    await assertModalSurface(modal,mode,name);
    const footer=modal.locator('.fi-modal-footer-actions').last();
    await expect(footer,name+' has the real shared footer hook').toBeVisible();
    const geometry=await footer.evaluate(node=>{
        const rect=node.getBoundingClientRect(),style=getComputedStyle(node),left=rect.left+parseFloat(style.paddingLeft);
        const buttons=[...node.querySelectorAll('button.fi-btn')].filter(button=>button.getBoundingClientRect().height>0);
        const box=buttons.map(button=>button.getBoundingClientRect());
        return {count:box.length,leftGap:Math.min(...box.map(r=>r.left))-left,
            contained:box.every(r=>r.left>=rect.left-1&&r.right<=rect.right+1),
            singleLine:buttons.every(button=>{const label=button.querySelector('.fi-btn-label');return !label||label.getBoundingClientRect().height<=parseFloat(getComputedStyle(label).lineHeight)*1.25;}),
            direction:style.direction};
    });
    expect(geometry.count,name).toBeGreaterThan(0);
    expect(Math.abs(geometry.leftGap),name+' button group starts at physical LEFT').toBeLessThan(3);
    expect(geometry.contained,name+' footer buttons stay inside their row').toBe(true);
    expect(geometry.singleLine,name+' button labels remain on one line').toBe(true);
    const primary=footer.locator('.fi-btn.fi-color-primary').first();
    const gray=footer.locator('.fi-btn.fi-color-gray').first();
    if(await primary.count()) await expect.poll(()=>buttonPaint(primary),{message:name+' primary follows the real panel CreateAction'}).toEqual(reference.primary);
    if(await gray.count()) await expect.poll(()=>buttonPaint(gray),{message:name+' secondary follows the real panel CreateAction'}).toEqual(reference.gray);
    return {footer,primary,geometry};
}

test('all real analytics modal forms and generic paths use shared panel footer styling and physical left layout',async({page},testInfo)=>{
    test.setTimeout(900000);
    const errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));
    const nativeHtml='<div id="modal-audit-native-host"></div>';
    const referenceHtml=Object.values(fixtures.references).join('');
    const html='<!doctype html><html lang="fa" dir="rtl" class="fi"><head><meta charset="utf-8">'+fixtures.livewireStyles+'<script>window.livewireScriptConfig={uri:"/livewire/update",csrf:"fixture",nonce:"",progressBar:true};</script></head><body class="fi-body"><div class="fi-layout"><main class="fi-main-ctn"><div class="fi-main mx-auto w-full px-4 md:px-6 lg:px-8"><section class="fi-page"><div id="analytics-studio" data-api="/analytics/api" data-section="report" data-record="new" data-routes="{&quot;connections&quot;:&quot;/admin/analytics/databases&quot;,&quot;report&quot;:&quot;/admin/analytics/reports/__record__&quot;}"><div data-analytics-content></div>'+nativeHtml+fixtures.generic+tableTemplates+'</div>'+referenceHtml+'</section></div></main></div></body></html>';
    await page.route('http://modal-audit-fixture.test/**',route=>{
        const endpoint=new URL(route.request().url()).pathname;
        if(endpoint.startsWith('/analytics/api/')){
            if(endpoint.endsWith('/library'))return route.fulfill({json:{connections:[],reports:[],dashboards:[],folders:[]}});
            if(endpoint.endsWith('/revisions'))return route.fulfill({json:[{id:1,version:1,created_at:'2026-11-15'},{id:2,version:2,created_at:'2026-11-16'}]});
            if(endpoint.endsWith('/widgets/orders/query'))return route.fulfill({json:{columns:[{key:'id',label:'شناسه',type:'number',primary:true},{key:'name',label:'نام',type:'text'}],rows:[{id:1,name:'کتاب'},{id:2,name:'پوشاک'}],meta:{},sql:'SELECT * FROM orders'}});
            if(endpoint.endsWith('/interactions/options'))return route.fulfill({json:{context:{column_key:'id',row_index:0,kind:'cell',value:1},actions:[{id:'related:orders',label:'سفارش‌های مرتبط'}]}});
            throw new Error('Unexpected fixture API: '+endpoint);
        }
        if(route.request().method()==='POST'){const payload=route.request().postDataJSON();requests.push(payload);return route.fulfill({json:acknowledge(payload)});}
        return route.fulfill({contentType:'text/html; charset=utf-8',body:html});
    });
    await page.goto('http://modal-audit-fixture.test/');
    await page.addStyleTag({content:styles+'\n'+fixtures.palette+'\n'+panelFontCss()});
    await awaitPanelFonts(page);
    await page.addScriptTag({content:support});
    await page.addScriptTag({content:script});
    await expect.poll(()=>page.evaluate(()=>window.modalAuditReady)).toBe(true);
    // The export suppresses initial server open effects; each genuine modal opens on demand.
    await expect(page.locator('.fi-modal-window:visible')).toHaveCount(0);
    await page.addScriptTag({content:application});
    await expect(page.locator('[data-analytics-content] .mb-empty')).toBeVisible();
    const referenceRoot=page.locator('[data-modal-audit-reference="create"]');
    const referenceModal=referenceRoot.locator('.fi-modal-window').first();
    const referenceId=await referenceRoot.locator('.fi-modal').first().getAttribute('data-fi-modal-id');
    await page.evaluate(()=>{const host=document.createElement('div');host.hidden=true;host.dataset.vendorRoleProbes='';for(const role of ['danger','success']){const button=document.getElementById('analytics-native-button-'+role).content.firstElementChild.cloneNode(true);button.dataset.roleProbe=role;host.append(button);}document.body.append(host);});
    console.log('Modal audit: actual Vendor component providers ready; 57 genuine schema variants exported');
    const checks=[];
    for(const mode of ['light','dark']) for(const width of [1440,390]){
        await test.step(mode+' '+width,async()=>{
            await page.setViewportSize({width,height:1000});
            await page.locator('html').evaluate((node,dark)=>node.classList.toggle('dark',dark),mode==='dark');
            await modalEvent(page,'open-modal',referenceId);
            await expect(referenceModal).toBeVisible();
            const reference={primary:await buttonPaint(referenceModal.locator('.fi-modal-footer-actions .fi-btn.fi-color-primary').first()),gray:await buttonPaint(referenceModal.locator('.fi-modal-footer-actions .fi-btn.fi-color-gray').first())};
            await assertModal(referenceModal,reference,mode,'real CreateAction reference');
            await modalEvent(page,'close-modal',referenceId);await expect(referenceModal).toBeHidden();
            for(const [scenario,entry] of Object.entries(fixtures.cases)){
                await test.step(scenario,async()=>{
                    await mountNative(page,scenario);
                    const modal=page.locator('[data-modal-audit-case="'+scenario+'"] .fi-modal-window');
                    await modalEvent(page,'open-modal','analytics-audit-'+scenario);
                    const {primary,geometry}=await assertModal(modal,reference,mode,scenario);
                    // A root theme token must reach every primary footer, without copying a rule into analytics CSS.
                    await page.locator('html').evaluate(node=>node.style.setProperty('--cm-orange','rgb(12, 110, 73)'));
                    await expect(primary).toHaveCSS('background-color','rgb(12, 110, 73)');
                    await page.locator('html').evaluate(node=>node.style.removeProperty('--cm-orange'));
                    await expect.poll(()=>buttonPaint(primary)).toEqual(reference.primary);
                    if(scenario.startsWith('visualization')){
                        for(const tab of await modal.locator('.fi-tabs-item').all()){
                            if(await tab.isVisible()){await tab.click();await expect(primary).toBeVisible();}
                        }
                    }
                    if(scenario==='columns'){
                        const checkbox=modal.locator('input[type="checkbox"]').first();
                        await checkbox.uncheck();await expect(checkbox).not.toBeChecked();await checkbox.check();
                        await primary.scrollIntoViewIfNeeded();
                        await page.screenshot({path:testInfo.outputPath('columns-'+mode+'-'+width+'.png'),fullPage:false});
                    }
                    if(scenario==='tab-existing'||scenario==='card') expect(await modal.locator('.fi-modal-footer-actions .fi-btn').count()).toBeGreaterThanOrEqual(4);
                    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
                    checks.push({mode,width,scenario,kind:entry.kind,...geometry});
                    if(checks.filter(item=>item.mode===mode&&item.width===width&&item.kind).length%12===0)console.log('Modal audit: '+mode+' '+width+' verified '+checks.filter(item=>item.mode===mode&&item.width===width&&item.kind).length+'/57 native forms');
                    if(['filter_value','visualization'].includes(scenario))await page.screenshot({path:testInfo.outputPath(scenario+'-'+mode+'-'+width+'.png'),fullPage:false});
                    await modalEvent(page,'close-modal','analytics-audit-'+scenario);await expect(modal).toBeHidden();
                });
            }
            for(const scenario of ['edit','delete','createFolder']){
                const root=page.locator('[data-modal-audit-reference="'+scenario+'"]'),modal=root.locator('.fi-modal-window').first();
                const id=await root.locator('.fi-modal').first().getAttribute('data-fi-modal-id');
                await modalEvent(page,'open-modal',id);await assertModal(modal,reference,mode,'resource '+scenario);
                if(scenario==='createFolder'||scenario==='delete')await page.screenshot({path:testInfo.outputPath('resource-'+scenario+'-'+mode+'-'+width+'.png'),fullPage:false});
                await modalEvent(page,'close-modal',id);await expect(modal).toBeHidden();
            }
            // Invoke real production callers on the unchanged analytics application.
            for(const scenario of ['sql','revisions','notebook','related-rows','object-details','semantic-footer']){
                await page.evaluate(async scenario=>{
                    const app=window.analyticsStudio;
                    const definition={connection_id:1,source:'public.orders',mode:'rows',metrics:[],dimensions:[],filters:[],sort:[],joins:[],expressions:[],stages:[]};
                    app.dashboard={id:125};
                    app.report={id:41,name:'سفارش‌ها',query_definition:definition};
                    app.previewResult={columns:[{key:'id',label:'شناسه',type:'number',primary:true},{key:'name',label:'نام',type:'text'}],rows:[{id:1,name:'کتاب'}],meta:{},sql:'SELECT amount FROM orders'};
                    app.appliedValues={};
                    if(scenario==='sql')return app.showSql();
                    if(scenario==='revisions')return app.showRevisions();
                    if(scenario==='notebook')return app.addNotebookStep();
                    if(scenario==='related-rows')return window.ModalAudit.legacyRelated(app,{key:'orders',click_behavior:{type:'details'}},{id:1});
                    if(scenario==='object-details'){
                        app.drillSession={origin:{kind:'report',definition},path:[],frames:[],currentIndex:-1};
                        return app.showObjectDetails({record:{table_label:'سفارش‌ها',table_key:'public.orders'},query_definition:definition,result:app.previewResult});
                    }
                    const button=window.ModalAudit.button;
                    app.modal('نقش‌های دکمه در پنل','<p>بررسی کامپوننت‌های اصلی فیلامنت</p>',button('اعمال','apply','primary')+button('انصراف','cancel')+button('حذف','delete','danger')+button('تأیید','approve','green'));
                },scenario);
                const modal=page.locator('.fi-modal-window.mb-dialog[open]');await expect(modal).toBeVisible();
                if(['sql','related-rows','object-details','semantic-footer'].includes(scenario)){
                    const {primary}=await assertModal(modal,reference,mode,'generic '+scenario);
                    if(await primary.count()){
                        await page.locator('html').evaluate(node=>node.style.setProperty('--cm-orange','rgb(12, 110, 73)'));
                        await expect(primary).toHaveCSS('background-color','rgb(12, 110, 73)');
                        await page.locator('html').evaluate(node=>node.style.removeProperty('--cm-orange'));
                        await expect.poll(()=>buttonPaint(primary)).toEqual(reference.primary);
                    }
                }else {await assertModalSurface(modal,mode,scenario);await expect(modal.locator('.fi-modal-footer')).toBeHidden();}
                if(scenario==='sql'){await expect(modal.locator('[data-generated-sql]')).toContainText('SELECT amount');await expect(modal.locator('button.fi-btn[data-action="copyGeneratedSql"]')).toBeVisible();}
                if(scenario==='revisions')await expect(modal.locator('[data-action="restoreRevision"]')).toHaveCount(2);
                if(scenario==='notebook')await expect(modal.locator('[data-kind]')).toHaveCount(6);
                if(scenario==='related-rows')await expect(modal.locator('.fi-ta-table tbody tr')).toHaveCount(2);
                if(scenario==='object-details')await expect(modal.locator('[data-object-related] [data-drill-action]')).toHaveCount(1);
                if(scenario==='semantic-footer'){
                    const colors=await modal.locator('.fi-btn.fi-color-danger,.fi-btn.fi-color-success').evaluateAll(buttons=>buttons.map(button=>({role:button.classList.contains('fi-color-danger')?'danger':'success',background:getComputedStyle(button).backgroundColor,color:getComputedStyle(button).color})));
                    expect(colors).toHaveLength(2);
                    for(const button of colors){const vendor=await page.locator('[data-role-probe="'+button.role+'"]') .evaluate(node=>({background:getComputedStyle(node).backgroundColor,color:getComputedStyle(node).color}));expect({background:button.background,color:button.color},'Vendor '+button.role+' paint remains unchanged in footer').toEqual(vendor);}
                }
                if(scenario==='object-details'||scenario==='related-rows')await page.screenshot({path:testInfo.outputPath(scenario+'-'+mode+'-'+width+'.png'),fullPage:false});
                await page.evaluate(()=>window.analyticsStudio.closeModal());await expect(modal).toBeHidden();
                checks.push({mode,width,scenario:'generic-'+scenario});
            }
            expect(errors,mode+' '+width+' must not have hidden Alpine/Livewire errors').toEqual([]);
        });
    }
    // Real Livewire morph with server-rendered validation markup must retain common footer styling.
    await mountNative(page,'columns');
    const columns=page.locator('[data-modal-audit-case="columns"]');
    await modalEvent(page,'open-modal','analytics-audit-columns');
    await page.evaluate(invalid=>{
        const root=document.querySelector('[data-modal-audit-case="columns"]'),id=root.getAttribute('wire:id');
        const invalidId=invalid.match(/wire:id="([^"]+)"/)[1];
        window.Livewire.find(id).__instance.processEffects({html:invalid.replaceAll(invalidId,id)});
    },fixtures.invalidColumns);
    await expect(columns.locator('.fi-fo-field-wrp-error-message')).toBeVisible();
    await expect(columns.locator('.fi-modal-footer-actions .fi-btn.fi-color-primary')).toHaveCSS('background-color','rgb(255, 128, 0)');
    expect(errors).toEqual([]);
    await page.evaluate(()=>window.analyticsStudio.destroy());
    await testInfo.attach('actual-modal-inventory',{body:JSON.stringify({native:Object.keys(fixtures.cases),checks,requestCount:requests.length},null,2),contentType:'application/json'});
});
async function modalFieldPaint(modal) {
    return modal.evaluate(async root => {
        // Focus/blur changes floating labels through real CSS transitions. Compare their settled states.
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await Promise.all(root.getAnimations({subtree:true}).filter(animation => Number.isFinite(animation.effect.getComputedTiming().endTime)).map(animation => animation.finished.catch(() => {})));
        return [...root.querySelectorAll('.soar-floating-field')].filter(field => field.getBoundingClientRect().height > 0).map(field => {
            const control = field.querySelector('.fi-input-wrp, textarea.fi-input');
            const label = field.querySelector('.fi-fo-field-wrp-label');
            const style = control ? getComputedStyle(control) : null;
            const labelStyle = label ? getComputedStyle(label) : null;
            return {
                fieldHeight: getComputedStyle(field).getPropertyValue('--cm-field-height').trim(),
                control: style && Object.fromEntries(['backgroundColor', 'color', 'height', 'minHeight', 'borderRadius', 'paddingTop', 'paddingBottom'].map(key => [key, style[key]])),
                label: labelStyle && Object.fromEntries(['top', 'backgroundColor', 'color', 'fontSize'].map(key => [key, labelStyle[key]])),
            };
        });
    });
}

test('page form styles leave outer Action modal hosts neutral and preserve shared modal fields', async ({ page }, testInfo) => {
    test.setTimeout(240000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const html = '<!doctype html><html lang="fa" dir="rtl" class="fi"><head><meta charset="utf-8">' + fixtures.livewireStyles + '<script>window.livewireScriptConfig={uri:"/livewire/update",csrf:"fixture",nonce:"",progressBar:true};</script></head><body class="fi-body"><main class="fi-main"><section class="fi-page">' + fixtures.pageForm + Object.values(fixtures.references).join('') + '<div id="analytics-studio"><div id="modal-audit-native-host"></div></div></section></main>' + Object.values(fixtures.baselines).join('') + Object.values(fixtures.nativeBaselines).join('') + '</body></html>';
    await page.route('http://modal-guard-fixture.test/**', route => {
        if (route.request().method() === 'POST') return route.fulfill({ json: acknowledge(route.request().postDataJSON()) });
        return route.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
    });
    await page.goto('http://modal-guard-fixture.test/');
    await page.addStyleTag({ content: styles + '\n' + fixtures.palette + '\n' + panelFontCss() });
    await awaitPanelFonts(page);
    await page.addScriptTag({ content: support });
    await page.addScriptTag({ content: script });
    await expect.poll(() => page.evaluate(() => window.modalAuditReady)).toBe(true);
    await expect(page.locator('.fi-modal-window:visible')).toHaveCount(0);
    const metrics = [];
    for (const mode of ['light', 'dark']) for (const width of [1440, 390]) {
        await test.step(mode + ' ' + width, async () => {
            await page.setViewportSize({ width, height: 1000 });
            await page.locator('html').evaluate((node, dark) => node.classList.toggle('dark', dark), mode === 'dark');
            const regular = page.locator('[data-modal-audit-page-form] > form');
            await expect(regular).toHaveCSS('background-color', mode === 'dark' ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)');
            const regularBox = await regular.evaluate(node => { const style = getComputedStyle(node); return { minHeight: parseFloat(style.minHeight), padding: parseFloat(style.paddingLeft), radius: style.borderRadius, selectHeight: getComputedStyle(node.querySelector('.fi-fo-select')).height }; });
            expect(regularBox.minHeight).toBeGreaterThanOrEqual(420);
            expect(regularBox.padding).toBeGreaterThanOrEqual(20);
            expect(regularBox.radius).toBe('24px');
            expect(regularBox.selectHeight, 'regular page selects retain their 40px page styling').toBe('40px');
            const hosts = await page.locator('[data-modal-audit-reference] form:has(> .fi-modal)').evaluateAll(forms => forms.map(form => {
                const style = getComputedStyle(form);
                return { height: form.getBoundingClientRect().height, background: style.backgroundColor, minHeight: style.minHeight, padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft] };
            }));
            expect(hosts.length).toBeGreaterThanOrEqual(4);
            for (const host of hosts) {
                expect(host.height, 'inactive Action forms must not become empty page cards').toBe(0);
                expect(host.background).toBe('rgba(0, 0, 0, 0)');
                expect(host.minHeight).toBe('0px');
                expect(host.padding).toEqual(['0px', '0px', '0px', '0px']);
            }
            for (const scenario of ['create', 'edit']) {
                const baselineRoot = page.locator('[data-modal-audit-baseline="' + scenario + '"]');
                const baseline = baselineRoot.locator('.fi-modal-window').first();
                const baselineId = await baselineRoot.locator('.fi-modal').first().getAttribute('data-fi-modal-id');
                await modalEvent(page, 'open-modal', baselineId);
                await assertModalSurface(baseline, mode, 'canonical ' + scenario + ' outside page-form scope');
                await page.evaluate(() => document.activeElement?.blur());
                const expectedFields = await modalFieldPaint(baseline);
                expect(expectedFields.length).toBeGreaterThan(3);
                const reference = { primary: await buttonPaint(baseline.locator('.fi-modal-footer-actions .fi-color-primary').first()), gray: await buttonPaint(baseline.locator('.fi-modal-footer-actions .fi-color-gray').first()) };
                await modalEvent(page, 'close-modal', baselineId);
                await expect(baseline).toBeHidden();
                const root = page.locator('[data-modal-audit-reference="' + scenario + '"]');
                const modal = root.locator('.fi-modal-window').first();
                const id = await root.locator('.fi-modal').first().getAttribute('data-fi-modal-id');
                await modalEvent(page, 'open-modal', id);
                await assertModal(modal, reference, mode, 'actual in-page ' + scenario);
                if (width === 390) {
                    const bounds = await modal.boundingBox();
                    expect(Math.abs(bounds.width - (width - 32)), 'Create/Edit use the available native modal width on mobile').toBeLessThan(2);
                    expect(bounds.x).toBeGreaterThanOrEqual(15);
                    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width - 15);
                }
                expect(await modal.evaluate(node => node.scrollWidth <= node.clientWidth + 1), 'modal fields do not overflow horizontally').toBe(true);
                const lastAction = modal.locator('.fi-modal-footer-actions .fi-btn').last();
                await lastAction.scrollIntoViewIfNeeded();
                await expect(lastAction).toBeInViewport();
                await page.evaluate(() => document.activeElement?.blur());
                await expect.poll(() => modalFieldPaint(modal), { message: 'page form CSS must not alter real ' + scenario + ' fields' }).toEqual(expectedFields);
                await page.screenshot({ path: testInfo.outputPath(scenario + '-' + mode + '-' + width + '.png') });
                await modalEvent(page, 'close-modal', id);
                await expect(modal).toBeHidden();
            }
            for (const scenario of ['source', 'filter_value']) {
                const baseline = page.locator('[data-modal-audit-baseline-native="' + scenario + '"] .fi-modal-window');
                await modalEvent(page, 'open-modal', 'analytics-audit-baseline-' + scenario);
                await assertModalSurface(baseline, mode, 'canonical native ' + scenario);
                await page.evaluate(() => document.activeElement?.blur());
                const expectedFields = await modalFieldPaint(baseline);
                expect(expectedFields.length).toBeGreaterThan(1);
                await modalEvent(page, 'close-modal', 'analytics-audit-baseline-' + scenario);
                await expect(baseline).toBeHidden();
                await mountNative(page, scenario);
                const modal = page.locator('[data-modal-audit-case="' + scenario + '"] .fi-modal-window');
                await modalEvent(page, 'open-modal', 'analytics-audit-' + scenario);
                await assertModalSurface(modal, mode, 'actual native ' + scenario);
                await page.evaluate(() => document.activeElement?.blur());
                await expect.poll(() => modalFieldPaint(modal), { message: 'page form CSS must not alter native ' + scenario + ' fields' }).toEqual(expectedFields);
                if (scenario === 'source') {
                    const control = modal.locator('.soar-floating-select .fi-input-wrp.fi-fo-select').first();
                    const sharedHeight = await control.evaluate(node => getComputedStyle(node.closest('.soar-floating-field')).getPropertyValue('--cm-field-height').trim());
                    await expect(control).toHaveCSS('height', sharedHeight);
                }
                const choices = modal.locator('.choices').first();
                if (await choices.count()) {
                    await choices.locator('.choices__inner').click();
                    await expect(choices.locator('.choices__list--dropdown')).toBeVisible();
                    const bounds = await choices.locator('.choices__list--dropdown').evaluate(node => { const menu = node.getBoundingClientRect(), windowRect = node.closest('.fi-modal-window').getBoundingClientRect(); return { contained: menu.left >= windowRect.left - 1 && menu.right <= windowRect.right + 1 }; });
                    expect(bounds.contained).toBe(true);
                    await modal.locator('.fi-modal-header').click();
                }
                if (scenario === 'filter_value') {
                    const chips = modal.locator('.choices__list--multiple > .choices__item');
                    await expect(chips).toHaveCount(2);
                    const geometry = await chips.evaluateAll(nodes => nodes.map(node => { const chip = node.getBoundingClientRect(), field = node.closest('.choices').getBoundingClientRect(); return { top: chip.top, contained: chip.left >= field.left - 1 && chip.right <= field.right + 1 }; }));
                    expect(geometry.every(chip => chip.contained)).toBe(true);
                    if (width === 1440) expect(Math.abs(geometry[0].top - geometry[1].top)).toBeLessThan(2);
                }
                await page.screenshot({ path: testInfo.outputPath(scenario + '-' + mode + '-' + width + '.png') });
                await modalEvent(page, 'close-modal', 'analytics-audit-' + scenario);
                await expect(modal).toBeHidden();
            }
            await expect(page.locator('.fi-modal-window:visible')).toHaveCount(0);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
            metrics.push({ mode, width, hosts, regularBox });
            console.log('Modal page-form guard: ' + mode + ' ' + width + ' passed');
        });
    }
    expect(errors).toEqual([]);
    await testInfo.attach('real-modal-page-form-guard', { body: JSON.stringify(metrics, null, 2), contentType: 'application/json' });
});
