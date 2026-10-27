import { e } from './ui';
function highlight(sql) {
    const pattern = /--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\{\{[a-z][a-z0-9_]*\}\}|\b(?:select|from|where|join|left|right|full|inner|outer|on|and|or|not|as|group|by|order|having|limit|offset|with|union|all|distinct|case|when|then|else|end|is|null|between|in|like|count|sum|avg|min|max|cast|date|asc|desc)\b|\b\d+(?:\.\d+)?\b/gi;
    let html = ''; let position = 0;
    for (const match of sql.matchAll(pattern)) { html += e(sql.slice(position, match.index)); const token = match[0]; const type = token.startsWith('--') || token.startsWith('/*') ? 'comment' : token.startsWith("'") ? 'string' : token.startsWith('{{') ? 'variable' : /^\d/.test(token) ? 'number' : token.startsWith('"') || token.startsWith('`') ? 'identifier' : 'keyword'; html += `<span class="mb-sql-token-${type}">${e(token)}</span>`; position = match.index + token.length; }
    return html + e(sql.slice(position)) + '\n';
}
export const sqlEditorMethods = {
    mountSqlEditor() { const preview = this.root.querySelector('[data-sql-preview]'); if (preview) preview.innerHTML = highlight(this.report.query_definition.sql || ''); },
    updateSqlHighlight() { const editor = this.root.querySelector('[data-sql]'); const backdrop = this.root.querySelector('.mb-sql-highlight'); if (!editor || !backdrop) return; backdrop.innerHTML = highlight(editor.value); const gutter = this.root.querySelector('.mb-sql-gutter'); gutter.innerHTML = Array.from({ length: Math.max(8, editor.value.split('\n').length) }, (_, index) => index + 1).join('<br>'); this.syncSqlScroll(); },
    syncSqlScroll() { const editor = this.root.querySelector('[data-sql]'); const backdrop = this.root.querySelector('.mb-sql-highlight'); if (!editor || !backdrop) return; backdrop.style.transform = `translate(${-editor.scrollLeft}px, ${-editor.scrollTop}px)`; this.root.querySelector('.mb-sql-gutter').style.transform = `translateY(${-editor.scrollTop}px)`; },
};
