import fs from 'node:fs';
import path from 'node:path';

let stylesheet;
export function panelFontCss() {
    if (stylesheet) return stylesheet;
    const weights = [[400,'Regular'],[500,'Medium'],[700,'Bold'],[900,'Black']];
    stylesheet = weights.map(([weight,name]) => '@font-face{font-family:Vazir;src:url(data:font/woff2;base64,' +
        fs.readFileSync(path.resolve('public/fonts/vazir/Vazir-' + name + '.woff2')).toString('base64') +
        ') format("woff2");font-weight:' + weight + ';font-style:normal;font-display:block}').join('\n') +
        '\n:root{--font-family:Vazir;--soar-font-family:Vazir}';
    return stylesheet;
}

export async function awaitPanelFonts(page) {
    await page.evaluate(async () => {
        await Promise.all([400,500,700,900].map(weight => document.fonts.load(weight + ' 12px Vazir', 'Dashboard \u0641\u0631\u0648\u0634')));
        await document.fonts.ready;
        if (!document.fonts.check('12px Vazir')) throw new Error('The actual panel Vazir font did not load.');
    });
}
