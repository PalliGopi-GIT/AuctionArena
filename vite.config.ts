import {defineConfig} from 'vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
const apiPort=process.env.API_PORT??'3001';
export default defineConfig({plugins:[react(),tailwindcss()],server:{proxy:{'/api':`http://127.0.0.1:${apiPort}`,'/ws':{target:`ws://127.0.0.1:${apiPort}`,ws:true}}},build:{outDir:'dist'}});
