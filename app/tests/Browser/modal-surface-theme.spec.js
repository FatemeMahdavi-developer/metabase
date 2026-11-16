import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { panelFontCss, awaitPanelFonts } from './helpers/panel-fonts.js';

let markup, script, styles;
test.beforeAll(async () => {
    markup = execFileSync(path.resolve('../.tools/php/php.exe'), ['tests/Browser/helpers/export-modal-surface.php'],
        {encoding:'utf8',timeout:60000,maxBuffer:2 * 1024 * 1024});
    const bundle = await build({
        stdin:{resolveDir:process.cwd(),contents:[
            'import { Livewire, Alpine } from "./vendor/livewire/livewire/dist/livewire.esm.js";',
            'import select from "./public/js/filament/forms/components/select.js";',
            'import { soarFloatingField } from "./resources/js/filament-forms.js";',
            'import { openFilamentModal, closeFilamentModal } from "./resources/js/analytics/filament-modal.js";',
            'import { button } from "./resources/js/analytics/ui.js";',
            'window.Livewire=Livewire; window.Alpine=Alpine;',
            'Alpine.data("selectFormComponent",select); Alpine.data("soarFloatingField",soarFloatingField);',
            'const root=document.getElementById("analytics-studio");',
            'root.append(document.querySelector("[data-analytics-modal-host]"));',
            'document.querySelectorAll("[x-load]").forEach(node=>{node.removeAttribute("x-load");node.removeAttribute("x-load-src");});',
            'window.ModalSurfaceFixture={open(side){return openFilamentModal(root,{title:"Modal surface",body:"<p>Report details</p>",footer:button("Close","closeModal"),side});},close(){closeFilamentModal(root);}};',
            'Livewire.start();',
        ].join('\n')},bundle:true,write:false,format:'iife',
    });
    script=bundle.outputFiles[0].text;
    const built=path.resolve('public/build'), manifest=JSON.parse(fs.readFileSync(path.join(built,'manifest.json'),'utf8'));
    styles=['../css/filament/support/support.css','../css/filament/forms/forms.css','../css/filament/filament/app.css',
        manifest['resources/css/panel-theme.css'].file,...manifest['resources/js/analytics.js'].css]
        .map(file=>fs.readFileSync(path.join(built,file),'utf8')).join('\n');
});

async function surfaces(window, native) {
    return window.evaluate((node,native)=>{
        const effective=element=>{
            for(let current=element;current;current=current.parentElement){
                const color=getComputedStyle(current).backgroundColor;
                if(color!=='transparent' && color!=='rgba(0, 0, 0, 0)') return color;
            }
            return 'transparent';
        };
        const footer=native ? node.querySelector('button[type="submit"]').parentElement : node.querySelector('.fi-modal-footer');
        return {
            window:getComputedStyle(node).backgroundColor,
            heading:effective(node.querySelector('.fi-modal-heading')),
            header:effective(node.querySelector('.fi-modal-header')),
            content:effective(node.querySelector('.fi-modal-content')),
            footer:effective(footer),
        };
    },native);
}

const panelSurfaces=page=>page.evaluate(()=>({
    page:getComputedStyle(document.querySelector('.fi-page')).backgroundColor,
    topbar:getComputedStyle(document.querySelector('.fi-topbar')).backgroundColor,
    surface:getComputedStyle(document.documentElement).getPropertyValue('--soar-surface').trim(),
}));

test('native filter, dialog and slide-over share widget modal paint while panel surfaces stay independent',async({page},testInfo)=>{
    test.setTimeout(180000);
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('http://modal-surface-fixture.test/**',async route=>{
        if(route.request().method()==='POST'){
            const payload=route.request().postDataJSON();
            return route.fulfill({json:{components:payload.components.map(component=>({snapshot:component.snapshot,
                effects:{returns:component.calls.map(()=>null)}})),assets:[]}});
        }
        return route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><html lang="fa" dir="rtl" class="fi"><head><meta charset="utf-8"><script>window.livewireScriptConfig={uri:"/livewire/update",csrf:"fixture",nonce:"",progressBar:true};</script></head><body><div class="fi-topbar"><nav>Panel topbar</nav></div><main class="fi-main-ctn fi-main"><section class="fi-page">'+markup+'</section></main></body></html>'});
    });
    await page.goto('http://modal-surface-fixture.test/');
    await page.addStyleTag({content:styles});
    await page.addStyleTag({content:panelFontCss()});
    await awaitPanelFonts(page);
    await page.addStyleTag({content:':root{--primary-50:239,246,255;--primary-600:58,77,233;--primary-400:129,140,248}body{margin:0}.fi-main-ctn{padding:16px!important}.fi-topbar nav{padding:12px}'});
    await page.addScriptTag({content:script});
    const native=page.locator('#analytics-native-form-body').locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," fi-modal-window ")][1]');
    for(const mode of ['light','dark']) for(const width of [1440,390]){
        await test.step(mode+' '+width,async()=>{
            await page.setViewportSize({width,height:900});
            await page.locator('html').evaluate((node,dark)=>node.classList.toggle('dark',dark),mode==='dark');
            await expect(page.locator('.fi-page')).toHaveCSS('background-color',mode==='dark'?'rgb(56, 56, 56)':'rgb(218, 219, 239)');
            const before=await panelSurfaces(page);
            if(mode==='dark'){
                expect(before.page).toBe('rgb(56, 56, 56)');
                expect(before.surface).toBe('#262626');
            }
            const expected=mode==='dark'?'rgb(0, 0, 0)':'rgb(255, 255, 255)';
            for(const variant of ['native','dialog','slide-over']){
                const window=variant==='native'?native:page.locator('[data-analytics-modal-window="'+variant+'"]');
                if(variant==='native') await page.evaluate(()=>dispatchEvent(new CustomEvent('open-modal',{detail:{id:'analytics-native-form'}})));
                else await page.evaluate(side=>window.ModalSurfaceFixture.open(side),variant==='slide-over');
                await expect(window).toBeVisible();
                const regionColors=color=>Object.fromEntries(['window','heading','header','content','footer'].map(key=>[key,color]));
                await expect.poll(()=>surfaces(window,variant==='native'),{message:variant+' '+mode+' '+width})
                    .toEqual(regionColors(expected));
                await page.locator('html').evaluate(node=>node.style.setProperty('--soar-widget-bg','rgb(21, 35, 49)'));
                await expect.poll(()=>surfaces(window,variant==='native'))
                    .toEqual(regionColors('rgb(21, 35, 49)'));
                expect(await panelSurfaces(page)).toEqual(before);
                await page.locator('html').evaluate(node=>node.style.removeProperty('--soar-widget-bg'));
                await expect(window).toHaveCSS('background-color',expected);
                if(variant==='native' && mode==='dark') await page.screenshot({path:testInfo.outputPath('native-filter-dark-'+width+'.png'),fullPage:true});
                if(variant==='native') await page.evaluate(()=>dispatchEvent(new CustomEvent('close-modal',{detail:{id:'analytics-native-form'}})));
                else await page.evaluate(()=>window.ModalSurfaceFixture.close());
                await expect(window).toBeHidden();
            }
            await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
        });
    }
    expect(errors).toEqual([]);
});