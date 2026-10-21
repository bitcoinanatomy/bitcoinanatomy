import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { filmMakerApi } from './server/api';

export default defineConfig({
  plugins: [react(), filmMakerApi()],
  server: { port: 5199 },
});
