import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

// Dev-only fetch proxy — CORS bypass for skills that fetch arbitrary URLs.
// In production, the Gateway service handles this.
function fetchProxyPlugin(): Plugin {
  return {
    name: 'fetch-proxy',
    configureServer(server) {
      server.middlewares.use('/api/fetch-proxy', async (req, res) => {
        const parsed = new URL(req.url ?? '', 'http://localhost');
        const targetUrl = parsed.searchParams.get('url');
        if (!targetUrl) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Missing ?url= parameter');
          return;
        }
        try {
          const acceptHeader = (req.headers['x-accept'] as string)
            || 'text/markdown, text/html;q=0.9, */*;q=0.8';
          const upstream = await fetch(targetUrl, {
            headers: {
              'User-Agent': 'Jarvis/1.0 (AI Agent)',
              'Accept': acceptHeader,
            },
          });
          res.writeHead(upstream.status, {
            'Content-Type': upstream.headers.get('content-type') ?? 'text/plain',
            'X-Markdown-Tokens': upstream.headers.get('x-markdown-tokens') ?? '',
          });
          const body = await upstream.arrayBuffer();
          res.end(Buffer.from(body));
        } catch (err: unknown) {
          res.writeHead(502, { 'Content-Type': 'text/plain' });
          res.end(`Proxy error: ${err instanceof Error ? err.message : String(err)}`);
        }
      });
    },
  };
}

// Dev-only OAuth token proxy — exchanges auth codes / refresh tokens with Google.
// In production, Caddy handles this route.
function oauthTokenProxy(): Plugin {
  return {
    name: 'oauth-token-proxy',
    configureServer(server) {
      server.middlewares.use('/api/oauth/token', async (req, res) => {
        if (req.method !== 'POST') {
          res.writeHead(405);
          res.end('Method not allowed');
          return;
        }
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const body = JSON.parse(Buffer.concat(chunks).toString());

        const tokenUrl = body.token_url || 'https://oauth2.googleapis.com/token';
        delete body.token_url;

        try {
          const resp = await fetch(tokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(body).toString(),
          });
          const data = await resp.text();
          res.writeHead(resp.status, { 'Content-Type': 'application/json' });
          res.end(data);
        } catch (err: unknown) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
      });
    },
  };
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [react(), fetchProxyPlugin(), oauthTokenProxy()],
  server: {
    proxy: {
      '/api/openai': {
        target: 'https://api.openai.com',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api\/openai/, ''),
      },
      '/api/deepseek': {
        target: 'https://api.deepseek.com',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api\/deepseek/, ''),
      },
      '/api/xai': {
        target: 'https://api.x.ai',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api\/xai/, ''),
      },
    },
  },
})
