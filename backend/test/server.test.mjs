import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createControlServer} from '../server.mjs';
const password='test-only-password-not-for-deployment';
async function start(dataDir){const app=await createControlServer({password,dataDir,appOrigins:['https://localhost']});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));return {...app,url:'http://127.0.0.1:'+app.server.address().port}}
test('panel protegido, bloqueo/aviso en SSE y persistencia tras reiniciar',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'paso-control-'));let app;const abort=new AbortController();
 try{
  app=await start(dir);let cookie='';
  const request=(route,method='GET',body,headers={})=>fetch(app.url+route,{method,headers:{'Content-Type':'application/json','X-Panel-Request':'1',Origin:app.url,...(cookie?{Cookie:cookie}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
  assert.equal((await request('/api/admin/state')).status,401);
  assert.equal((await request('/api/admin/login','POST',{password:'incorrecta'})).status,401);
  assert.equal((await request('/api/admin/login','POST',{password},{Origin:'https://evil.example'})).status,403);
  const login=await request('/api/admin/login','POST',{password});assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];assert.match(login.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
  const unauthorizedOrigin=await fetch(app.url+'/api/app/status',{headers:{Origin:'https://evil.example'}});assert.equal(unauthorizedOrigin.status,403);
  const publicState=await fetch(app.url+'/api/app/status',{headers:{Origin:'https://localhost'}});assert.equal(publicState.headers.get('access-control-allow-origin'),'https://localhost');assert.equal((await publicState.json()).enabled,true);
  const events=await fetch(app.url+'/api/app/events',{headers:{Origin:'https://localhost'},signal:abort.signal});assert.match(events.headers.get('content-type'),/text\/event-stream/);const reader=events.body.getReader(),decoder=new TextDecoder();assert.match(decoder.decode((await reader.read()).value),/"enabled":true/);
  const patch=await request('/api/admin/state','PATCH',{revision:0,enabled:false,blockedMessage:'Mantenimiento'});assert.equal(patch.status,200);let state=await patch.json();assert.equal(state.enabled,false);assert.equal(state.revision,1);
  const next=decoder.decode((await reader.read()).value);assert.match(next,/"enabled":false/);assert.match(next,/Mantenimiento/);
  assert.equal((await request('/api/admin/state','PATCH',{revision:1,enabled:true},{'X-Panel-Request':'0'})).status,403);
  assert.equal((await request('/api/admin/state','PATCH',{revision:0,enabled:true})).status,409);
  assert.equal((await request('/api/admin/state','PATCH',{revision:1,enabled:'yes'})).status,400);
  assert.equal((await request('/api/admin/state','PATCH',{revision:1,unexpected:'value'})).status,400);
  state=await (await request('/api/admin/state','PATCH',{revision:1,announcementText:'Aviso de prueba'})).json();assert.equal(state.announcement.text,'Aviso de prueba');assert.ok(state.announcement.id);
  state=await (await request('/api/admin/state','PATCH',{revision:2,enabled:true})).json();assert.equal(state.enabled,true);assert.equal(state.announcement.text,'Aviso de prueba');
  abort.abort();await app.close();app=await start(dir);
  state=await (await fetch(app.url+'/api/app/status')).json();assert.equal(state.revision,3);assert.equal(state.announcement.text,'Aviso de prueba');assert.equal(state.enabled,true);
  assert.equal((await request('/api/admin/state')).status,401,'las sesiones se invalidan al reiniciar');
  const relogin=await request('/api/admin/login','POST',{password});cookie=relogin.headers.get('set-cookie').split(';')[0];assert.equal((await request('/api/admin/logout','POST',{})).status,200);assert.equal((await request('/api/admin/state')).status,401);
 }finally{abort.abort();if(app)await app.close();await rm(dir,{recursive:true,force:true})}
});
test('credenciales obligatorias y HTTPS en producción',async()=>{
 await assert.rejects(()=>createControlServer({password:'short'}),/16 caracteres/);
 await assert.rejects(()=>createControlServer({password,production:true,publicOrigin:'http://example.com'}),/HTTPS/);
});
test('limita intentos de acceso',async()=>{const dir=await mkdtemp(path.join(os.tmpdir(),'paso-login-'));const app=await start(dir);try{for(let i=0;i<5;i++)assert.equal((await fetch(app.url+'/api/admin/login',{method:'POST',headers:{Origin:app.url,'X-Panel-Request':'1','Content-Type':'application/json'},body:JSON.stringify({password:'wrong'})})).status,401);assert.equal((await fetch(app.url+'/api/admin/login',{method:'POST',headers:{Origin:app.url,'X-Panel-Request':'1','Content-Type':'application/json'},body:JSON.stringify({password})})).status,429)}finally{await app.close();await rm(dir,{recursive:true,force:true})}});
