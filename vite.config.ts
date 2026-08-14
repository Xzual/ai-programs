import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, type UserConfig } from 'vite';

// Tauri dev modunda TAURI_DEV_HOST env değişkeni set edilir.
// Tauri olmadan (normal bun run dev) çalışınca undefined gelir.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig((): UserConfig => {
  return {
    plugins: [react(), tailwindcss()],

    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },

    // Tauri'nin backend ile çakışmaması için port 5173
    server: {
      // Tauri dev modunda host'u Tauri'nin beklediği adrese bağla
      host: host ?? 'localhost',
      port: 5173,
      strictPort: true,

      // Tauri dev modunda HMR websocket adresini düzelt
      hmr: host
        ? { protocol: 'ws', host, port: 5173 }
        : process.env.DISABLE_HMR !== 'true',

      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },

    // Production build çıktısı — Tauri bunu paketler
    build: {
      outDir: 'dist',
      // Tauri Windows target için sourcemap kapalı bırak (daha küçük build)
      sourcemap: false,
      target: ['es2021', 'chrome105', 'safari15'],
      minify: 'esbuild',
    },

    // Tauri'nin özel protokolüyle (tauri://) doğru çalışması için base
    base: process.env.TAURI_ENV_DEBUG ? '/' : '/',

    // Tauri, Vite'ın clearScreen'ini kapatmasını ister
    clearScreen: false,
  };
});
