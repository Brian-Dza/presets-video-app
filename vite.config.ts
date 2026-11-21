import type { IncomingMessage, ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';

const require = createRequire(import.meta.url);
const localEditorHost = require('./electron/localEditorHost.cjs') as {
  getEditorsStatus: () => Promise<unknown>;
  installInResolve: (payload: Record<string, unknown>) => Promise<unknown>;
  installInPremiere: (payload: Record<string, unknown>) => Promise<unknown>;
};

function isLoopbackAddress(address?: string): boolean {
  if (!address) return false;
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function readJsonBody(req: IncomingMessage, maxBytes = 32 * 1024 * 1024): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('El paquete supera el tamaño máximo permitido (32 MB).'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {});
      } catch {
        reject(new Error('JSON inválido en la solicitud local.'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function attachLocalHostRoutes(middlewares: { use: (fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void }) {
  middlewares.use((req, res, next) => {
    const url = req.url?.split('?')[0];
    if (!url || !url.startsWith('/__framebase/host/')) {
      next();
      return;
    }

    if (!isLoopbackAddress(req.socket.remoteAddress)) {
      sendJson(res, 403, { success: false, message: 'Acceso permitido únicamente desde el equipo local.' });
      return;
    }

    void (async () => {
      try {
        if (url === '/__framebase/host/status' && req.method === 'GET') {
          sendJson(res, 200, await localEditorHost.getEditorsStatus());
          return;
        }
        if (url === '/__framebase/host/install-resolve' && req.method === 'POST') {
          const body = await readJsonBody(req);
          sendJson(res, 200, await localEditorHost.installInResolve(body));
          return;
        }
        if (url === '/__framebase/host/install-premiere' && req.method === 'POST') {
          const body = await readJsonBody(req);
          sendJson(res, 200, await localEditorHost.installInPremiere(body));
          return;
        }
        sendJson(res, 404, { success: false, message: 'Ruta local no encontrada.' });
      } catch (cause) {
        sendJson(res, 500, {
          success: false,
          message: cause instanceof Error ? cause.message : 'Error interno en el puente local.',
        });
      }
    })();
  });
}

function framebaseLocalHostPlugin(): Plugin {
  return {
    name: 'framebase-local-editor-host',
    configureServer(server) {
      attachLocalHostRoutes(server.middlewares);
    },
    configurePreviewServer(server) {
      attachLocalHostRoutes(server.middlewares);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), framebaseLocalHostPlugin()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'supabase', test: /@supabase/ },
            { name: 'icons', test: /lucide-react/ },
            { name: 'react-vendor', test: /node_modules[\\/](react|react-dom|scheduler)/ },
          ],
        },
      },
    },
  },
  server: {
    watch: {
      ignored: ['**/release/**'],
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
  },
});
