// Isolated component fixture: real editor, simulated authenticated route responses.
import { build } from 'esbuild'
import { createServer } from 'node:http'
const result = await build({ stdin: { contents: `
import React from 'react'; import {createRoot} from 'react-dom/client';
import {OutlineEditor} from './src/client/outline.js';
import {installLocale} from './src/client/locale.js';
let language='zh'; const listeners=new Set();
installLocale({getSnapshot:()=>({active:language}),register:()=>()=>{},subscribe:f=>{listeners.add(f);return()=>listeners.delete(f)}});
window.switchLanguage=()=>{language='en';listeners.forEach(f=>f())};
let current={revision:'r1',view:{view:'outline',status:'planning',goal:'测试',chapters:[{title:'章节一',kps:[{id:'one',title:'知识点一',kind:'knowledge',prerequisites:[]},{id:'two',title:'知识点二',kind:'information',prerequisites:[]}]}]}};
window.calls=[]; window.failSave=false;
async function request(s,op,data){window.calls.push({s,op,data});if(op==='read')return structuredClone(current); if(window.failSave)throw Error('conflict');current={revision:'r2',view:{...current.view,chapters:data.chapters,status:data.status}};return structuredClone(current)}
createRoot(document.getElementById('root')).render(React.createElement(OutlineEditor,{sessionId:'synthetic-session',view:current.view,request}));
`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' } })
const server = createServer((req,res)=>{res.setHeader('content-type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?result.outputFiles[0].text:'<!doctype html><html lang="zh"><meta charset="utf-8"><div id="root"></div><script type="module" src="/app.js"></script>')})
server.listen(Number(process.env.PORT), '127.0.0.1')
process.on('SIGTERM',()=>server.close(()=>process.exit()))
