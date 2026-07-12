import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '../../', '');

  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: '0.0.0.0',
      port: 5173,
      proxy: {
        '/api': {
          target: env.API_URL || 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
    preview: { host: '0.0.0.0', port: 4173 },
    build: {
      sourcemap: false,
      target: 'es2022',
    },
    test: {
      environment: 'jsdom',
      setupFiles: './tests/setup.ts',
      include: ['tests/**/*.test.{ts,tsx}'],
      exclude: ['tests/e2e/**'],
      css: false,
      fileParallelism: false,
      maxWorkers: 1,
      coverage: {
        reporter: ['text', 'html'],
      },
    },
  };
});
