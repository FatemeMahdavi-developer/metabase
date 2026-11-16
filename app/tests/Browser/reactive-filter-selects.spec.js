import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { build } from 'esbuild';
import { panelFontCss, awaitPanelFonts } from './helpers/panel-fonts.js';

let backend, fixture, scripts, styles;
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
    fixture=await requestComponent({command:'initial'});
    const bundle=await build({stdin:{resolveDir:process.cwd(),contents:[
        'import {Livewire,Alpine} from "./vendor/livewire/livewire/dist/livewire.esm.js";',
        'import select from "./public/js/filament/forms/components/select.js";',
        'import {soarFloatingField} from "./resources/js/filament-forms.js";',
        'window.Livewire=Livewire;window.Alpine=Alpine;',
        'Alpine.data("selectFormComponent",select);Alpine.data("soarFloatingField",soarFloatingField);',
        'document.querySelectorAll("[x-load]").forEach(node=>{node.removeAttribute("x-load");node.removeAttribute("x-load-src");});',
        'window.fixtureMorphs=0;Livewire.hook("morphed",()=>window.fixtureMorphs++);',
        'Livewire.start();dispatchEvent(new CustomEvent("open-modal",{detail:{id:"analytics-native-form"}}));',
    ].join('\n')},bundle:true,write:false,format:'iife'});
    scripts=[fs.readFileSync('vendor/filament/support/dist/index.js','utf8'),bundle.outputFiles[0].text];
    const built=path.resolve('public/build'),manifest=JSON.parse(fs.readFileSync(path.join(built,'manifest.json'),'utf8'));
    console.log('Reactive filter assets: '+manifest['resources/css/panel-theme.css'].file+' / '+manifest['resources/js/analytics.js'].css.join(','));
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
async function choose(page,wrapper,value,live=true) {
    const before=await page.evaluate(()=>window.fixtureMorphs);
    const choices=wrapper.locator('.choices');
    await choices.locator('.choices__inner').click();
    const option=choices.locator('.choices__item--choice[data-value="'+value+'"]');
    await expect(option).toBeVisible();await option.click();
    await expect(wrapper.locator('select')).toHaveValue(value);
    if (live) await expect.poll(()=>page.evaluate(()=>window.fixtureMorphs)).toBeGreaterThan(before);
}
async function paint(form) {
    return form.evaluate(root=>{
        const probe=document.createElement('i');probe.style.cssText='position:fixed;visibility:hidden;background:var(--soar-select-option-highlight-bg);color:var(--soar-select-option-highlight-text)';root.append(probe);
        const result={background:getComputedStyle(probe).backgroundColor,color:getComputedStyle(probe).color};probe.remove();return result;
    });
}
async function optionHighlight(page,form,key,testInfo,label) {
    const choices=field(form,key).locator('.choices'),expected=await paint(form);
    await choices.locator('.choices__inner').click();
    const alternative=choices.locator('.choices__item--choice[data-value="neq"]');
    await alternative.hover();await expect(alternative).toHaveClass(/is-highlighted/);
    await expect(alternative).toHaveCSS('background-color',expected.background);await expect(alternative).toHaveCSS('color',expected.color);
    await choices.press('ArrowUp');
    const equal=choices.locator('.choices__item--choice[data-value="eq"]');
    await expect(equal).toHaveClass(/is-highlighted/);await expect(equal).toHaveCSS('background-color',expected.background);
    await choices.press('ArrowDown');await expect(alternative).toHaveClass(/is-highlighted/);
    await expect(alternative).toHaveCSS('background-color',expected.background);
    await expect(choices.locator('.choices__input--cloned:visible')).toHaveCount(0);
    await choices.locator('.choices__list--dropdown').screenshot({path:testInfo.outputPath(label+'.png')});
    await choices.press('Escape');await expect(choices.locator('.choices__list--dropdown')).toBeHidden();
    await expect(form).toBeVisible();
}

test('reactive report filter uses genuine themed Choices for searchable fields and nonsearchable operators',async({page},testInfo)=>{
    test.setTimeout(240000);
    const errors=[],transportErrors=[];
    page.on('pageerror',error=>errors.push(error.message));
    // Newly visible fields keep Filament's real lazy loader and load the actual Vendor module.
    await page.route('**/js/filament/forms/components/select.js*',route=>route.fulfill({contentType:'application/javascript',headers:{'access-control-allow-origin':'*'},body:fs.readFileSync('public/js/filament/forms/components/select.js','utf8')}));
    await page.route('http://reactive-filter-fixture.test/**',async route=>{
        if (route.request().method()==='POST') {
            try {return await route.fulfill({json:await requestComponent(route.request().postDataJSON())});}
            catch(error){transportErrors.push(error.message);return route.fulfill({status:500,json:{fixtureError:error.message}});}
        }
        return route.fulfill({contentType:'text/html;charset=utf-8',body:'<!doctype html><html lang="fa" dir="rtl" class="fi"><head><meta charset="utf-8">'+fixture.livewireStyles+'<script>window.livewireScriptConfig={uri:"/livewire/update",csrf:"fixture",nonce:"",progressBar:true};</script></head><body class="fi-body"><main class="fi-main"><section class="fi-page">'+fixture.markup+'</section></main></body></html>'});
    });
    for(const width of [1440,390])for(const mode of ['light','dark']) {
        await page.setViewportSize({width,height:1100});
        await page.goto('http://reactive-filter-fixture.test/');
        await page.locator('html').evaluate((node,mode)=>node.classList.toggle('dark',mode==='dark'),mode);
        await page.addStyleTag({content:styles+'\n'+fixture.palette+'\n'+panelFontCss()});await awaitPanelFonts(page);
        for(const content of scripts)await page.addScriptTag({content});
        const form=page.locator('#analytics-native-form-body');await expect(form).toBeVisible();
        await expect(form.locator('.choices')).toHaveCount(2);
        await expect(field(form,'field').locator('select')).toHaveValue('name');
        await expect(field(form,'operator').locator('select')).toHaveValue('eq');
        await field(form,'field').locator('.choices__inner').click();
        await expect(field(form,'field').locator('.choices__input--cloned')).toBeVisible();
        await field(form,'field').locator('.choices__input--cloned').press('Escape');
        await optionHighlight(page,form,'operator',testInfo,'operator-'+mode+'-'+width);
        await expect(field(form,'value')).toBeVisible();
        await expect(field(form,'operator').locator('.choices__item--choice[data-value="contains"]')).toHaveCount(1);
        await expect(field(form,'operator').locator('.choices__item--choice[data-value="between"]')).toHaveCount(0);
        await choose(page,field(form,'operator'),'contains');await expect(field(form,'case_sensitive')).toBeVisible();
        await choose(page,field(form,'field'),'amount');
        await expect(field(form,'operator').locator('select')).toHaveValue('eq');
        await expect(field(form,'operator').locator('.choices__item--choice[data-value="between"]')).toHaveCount(1);
        await expect(field(form,'operator').locator('.choices__item--choice[data-value="contains"]')).toHaveCount(0);
        await expect(field(form,'value').locator('input')).toHaveValue('');
        await choose(page,field(form,'operator'),'between');await expect(field(form,'from')).toBeVisible();await expect(field(form,'to')).toBeVisible();await expect(field(form,'value')).toBeHidden();
        await field(form,'from').locator('input').fill('10');await field(form,'to').locator('input').fill('100');
        await choose(page,field(form,'operator'),'is_null');await expect(field(form,'value')).toBeHidden();await expect(field(form,'from')).toBeHidden();await expect(field(form,'to')).toBeHidden();
        await choose(page,field(form,'operator'),'neq');await expect(field(form,'value')).toBeVisible();
        await choose(page,field(form,'field'),'active');await expect(field(form,'operator').locator('select')).toHaveValue('eq');
        await expect(field(form,'boolean_value').locator('.choices')).toBeVisible();
        await expect(field(form,'operator').locator('.choices__item--choice[data-value="between"]')).toHaveCount(0);
        await expect(field(form,'operator').locator('.choices__item--choice[data-value="contains"]')).toHaveCount(0);
        await choose(page,field(form,'boolean_value'),'true',false);
        await choose(page,field(form,'operator'),'is_null');await expect(field(form,'boolean_value')).toBeHidden();
        await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
        await expect(form.locator('button[type="submit"]')).toBeInViewport();
        console.log('Reactive filter '+mode+'/'+width+' passed real field/operator morphs; hover '+JSON.stringify(await paint(form)));
    }
    expect(transportErrors).toEqual([]);expect(errors).toEqual([]);
});
