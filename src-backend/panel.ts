// Admin panel HTML and static assets serving
import { INDEX_HTML, MAIN_CSS, COMPONENTS_CSS, VIEWS_CSS, APP_JS } from './panel-assets.js';

export async function handleAdminPanel(_req: Request): Promise<Response> {
  // No auth on the HTML shell itself — the JS login form handles auth,
  // and all /admin/api/* endpoints still require Basic auth.
  return new Response(INDEX_HTML, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}

export function handleAdminAppJs(): Response {
  return new Response(APP_JS, {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}

export function handleAdminCss(file: string): Response {
  let css = '';
  if (file === 'main.css') css = MAIN_CSS;
  else if (file === 'components.css') css = COMPONENTS_CSS;
  else if (file === 'views.css') css = VIEWS_CSS;
  else return new Response('Not found', { status: 404 });

  return new Response(css, {
    status: 200,
    headers: {
      'Content-Type': 'text/css; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}

export const ADMIN_PANEL_HTML = INDEX_HTML;
