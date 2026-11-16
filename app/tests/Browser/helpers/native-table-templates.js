import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

let rendered;
export function nativeTableTemplates() {
    if (rendered) return rendered;
    const localPhp = path.resolve('../.tools/php/php.exe');
    const php = process.env.ANALYTICS_PHP || (fs.existsSync(localPhp) ? localPhp : 'php');
    rendered = execFileSync(php, ['tests/Browser/helpers/export-native-table.php'], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, timeout: 60000 });
    return rendered;
}
