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

// Dev-only mDNS peer discovery — advertises this Jarvis instance on the LAN.
// Runs on the host (not in Docker) so mDNS works natively.
function peerDiscoveryPlugin(): Plugin {
  return {
    name: 'peer-discovery',
    configureServer(server) {
      // Read instance config from .env.development and settings
      const envPath = './docker/.env';
      let kongPort = 8000;
      let gatewayPort = 3001;
      let instanceId = 'unknown';
      let nickname = 'Jarvis';
      try {
        const env = readFileSync(envPath, 'utf-8');
        const kongMatch = env.match(/^KONG_HTTP_PORT=(\d+)$/m);
        if (kongMatch) kongPort = parseInt(kongMatch[1], 10);
        const gwMatch = env.match(/^GATEWAY_PORT=(\d+)$/m);
        if (gwMatch) gatewayPort = parseInt(gwMatch[1], 10);
        const composeMatch = env.match(/^COMPOSE_PROJECT_NAME=(.+)$/m);
        if (composeMatch) instanceId = composeMatch[1];
        const domainMatch = env.match(/^DOMAIN=(.+)$/m);
        if (domainMatch) nickname = domainMatch[1];
      } catch { /* .env may not exist yet */ }

      import('./src/lib/peerDiscovery').then(({ startPeerDiscovery }) => {
        startPeerDiscovery({
          instanceId,
          nickname,
          kongPort,
          gatewayPort,
          version: pkg.version,
          devPort: server.config.server.port ?? 5173,
        }).catch((err: Error) => {
          console.warn('[PeerDiscovery] Failed to start:', err.message);
        });
      }).catch(() => {
        // bonjour-service not installed — skip silently
      });

      // Catch unhandled mDNS errors so they don't crash Vite
      process.on('uncaughtException', (err: Error) => {
        if (err.message?.includes('Service name') || err.message?.includes('already in use')) {
          console.warn('[PeerDiscovery] mDNS name collision (non-fatal):', err.message);
          return; // swallow — Vite keeps running
        }
        throw err; // re-throw non-mDNS errors
      });

      // Stop on server close
      server.httpServer?.on('close', () => {
        import('./src/lib/peerDiscovery').then(({ stopPeerDiscovery }) => {
          stopPeerDiscovery();
        }).catch(() => {});
      });
    },
  };
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [react(), fetchProxyPlugin(), oauthTokenProxy(), peerDiscoveryPlugin()],
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
