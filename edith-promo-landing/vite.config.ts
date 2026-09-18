import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    host: 'localhost',
    port: 5174,
  },
  build: {
    target: ['es2021', 'chrome105', 'safari15'],
    sourcemap: false,
  },
});
