import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

const appTs = path.join(root, 'src-frontend/js/app.ts');
const appJs = path.join(root, 'src-frontend/js/app.js');
const indexHtmlPath = path.join(root, 'src-frontend/index.html');
const mainCssPath = path.join(root, 'src-frontend/css/main.css');
const componentsCssPath = path.join(root, 'src-frontend/css/components.css');
const viewsCssPath = path.join(root, 'src-frontend/css/views.css');
const panelAssetsTs = path.join(root, 'src-backend/panel-assets.ts');

console.log('Building frontend with esbuild...');
esbuild.buildSync({
  entryPoints: [appTs],
  bundle: true,
  format: 'esm',
  outfile: appJs,
  sourcemap: false,
});
console.log('Built', appJs);

const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
const mainCss = fs.readFileSync(mainCssPath, 'utf8');
const componentsCss = fs.readFileSync(componentsCssPath, 'utf8');
const viewsCss = fs.readFileSync(viewsCssPath, 'utf8');
const appJsContent = fs.readFileSync(appJs, 'utf8');

const outputTs = `// Auto-generated assets from src-frontend. DO NOT EDIT DIRECTLY.
// Rebuild with: npm run build

export const INDEX_HTML: string = ${JSON.stringify(indexHtml)};
export const MAIN_CSS: string = ${JSON.stringify(mainCss)};
export const COMPONENTS_CSS: string = ${JSON.stringify(componentsCss)};
export const VIEWS_CSS: string = ${JSON.stringify(viewsCss)};
export const APP_JS: string = ${JSON.stringify(appJsContent)};
`;

fs.writeFileSync(panelAssetsTs, outputTs, 'utf8');
console.log('Generated', panelAssetsTs);
