import http from 'node:http';
import {randomBytes,randomUUID,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {mkdir,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const scrypt=promisify(scryptCallback),here=path.dirname(fileURLToPath(import.meta.url));
const sessionLifetime=8*60*60*1000;
function invalid(message,status=400){return Object.assign(new Error(message),{status})}
function message(value,max=1000){if(typeof value!=='string'||value.length>max)throw invalid('Texto no válido (máximo '+max+' caracteres).');return value.trim()}
function initial(){return {revision:0,enabled:true,blockedMessage:'Aplicación temporalmente deshabilitada.',announcement:null,updatedAt:new Date().toISOString()}}
function validate(state){
 if(!state||!Number.isSafeInteger(state.revision)||state.revision<0||typeof state.enabled!=='boolean')throw invalid('Estado no válido.');
 message(state.blockedMessage);if(!state.blockedMessage.trim())throw invalid('Indica un mensaje de bloqueo.');
 if(state.announcement!==null){if(!state.announcement||typeof state.announcement.id!=='string'||state.announcement.id.length>100||!message(state.announcement.text,2000))throw invalid('Aviso no válido.');}
 if(typeof state.updatedAt!=='string'||!Number.isFinite(Date.parse(state.updatedAt)))throw invalid('Fecha no válida.');
 return state;
}
export async function createControlServer(options={}){
 const password=options.password??process.env.ADMIN_PASSWORD;
 if(typeof password!=='string'||password.length<8)throw Error('Configura ADMIN_PASSWORD con al menos 8 caracteres.');
 const production=options.production??process.env.NODE_ENV==='production';
 const publicOrigin=options.publicOrigin??process.env.PUBLIC_ORIGIN;
 if(publicOrigin&&new URL(publicOrigin).origin!==publicOrigin)throw Error('PUBLIC_ORIGIN debe ser un origen sin ruta ni barra final.');
 if(production&&(!publicOrigin||!publicOrigin.startsWith('https://')))throw Error('En producción configura PUBLIC_ORIGIN con HTTPS.');
 const origins=new Set(options.appOrigins??(process.env.APP_ORIGINS||'https://localhost,http://localhost').split(',').map(s=>s.trim()).filter(Boolean));
 const dataDir=path.resolve(options.dataDir??process.env.DATA_DIR??path.join(here,'data'));
 await mkdir(dataDir,{recursive:true,mode:0o700});const statePath=path.join(dataDir,'state.json');let state;
 try{state=validate(JSON.parse(await readFile(statePath,'utf8')))}catch(e){if(e.code!=='ENOENT')throw Error('No se pudo leer el estado guardado. Revisa '+statePath);state=initial();await writeFile(statePath,JSON.stringify(state,null,2),{flag:'wx',mode:0o600})}
 const salt=randomBytes(16),expected=await scrypt(password,salt,64),sessions=new Map(),attempts=new Map(),streams=new Set();let writes=Promise.resolve();
 function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data))}
 function publish(){for(const res of streams){res.write('event: state\ndata: '+JSON.stringify(state)+'\n\n')}}
 function update(patch){const task=writes.catch(()=>{}).then(async()=>{if(patch.revision!==state.revision)throw invalid('El estado ha cambiado. Recarga el panel antes de guardar.',409);const next={...state};
 if('enabled'in patch){if(typeof patch.enabled!=='boolean')throw invalid('enabled debe ser booleano.');next.enabled=patch.enabled}
 if('blockedMessage'in patch)next.blockedMessage=message(patch.blockedMessage);
 if('announcementText'in patch){const text=message(patch.announcementText,2000);next.announcement=text?{id:randomUUID(),text}:null}
 next.revision++;next.updatedAt=new Date().toISOString();validate(next);
 const temp=path.join(dataDir,'.state-'+randomUUID()+'.tmp');try{await writeFile(temp,JSON.stringify(next,null,2),{mode:0o600});await rename(temp,statePath)}finally{await unlink(temp).catch(()=>{})}
 state=next;publish();return state});writes=task;return task}
 async function body(req){if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw invalid('Se requiere JSON.',415);let bytes=0,chunks=[];for await(const part of req){bytes+=part.length;if(bytes>16384)throw invalid('Petición demasiado grande.',413);chunks.push(part)}try{return JSON.parse(Buffer.concat(chunks).toString())}catch{throw invalid('JSON no válido.')}}
 function adminOrigin(req){const expectedOrigin=publicOrigin||'http://'+req.headers.host;if(req.headers.origin!==expectedOrigin||req.headers['x-panel-request']!=='1')throw invalid('Origen no permitido.',403)}
 function authenticated(req){const match=(req.headers.cookie||'').match(/(?:^|;\s*)paso_session=([a-f0-9]{64})(?:;|$)/);if(!match)return false;const expiry=sessions.get(match[1]);if(!expiry||expiry<Date.now()){sessions.delete(match[1]);return false}return true}
 const cookie=(value,maxAge)=>'paso_session='+value+'; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age='+maxAge+(production?'; Secure':'');
 const files=new Map([['/admin',['index.html','text/html']],['/admin/',['index.html','text/html']],['/admin.js',['admin.js','text/javascript']],['/admin.css',['admin.css','text/css']]]);
 const server=http.createServer(async(req,res)=>{res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
 try{const route=new URL(req.url,'http://internal').pathname;
 if(route==='/health'&&req.method==='GET')return json(res,200,{ok:true});
 if(route==='/api/app/status'||route==='/api/app/events'){
  const origin=req.headers.origin;if(origin&&!origins.has(origin)&&origin!==publicOrigin)throw invalid('Origen no permitido.',403);
  if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin')}
  if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','GET');res.writeHead(204);return res.end()}
  if(req.method!=='GET')throw invalid('Método no permitido.',405);
  if(route.endsWith('/status'))return json(res,200,state);
  if(streams.size>=200)throw invalid('Demasiadas conexiones.',503);
  res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Connection':'keep-alive','X-Accel-Buffering':'no'});res.write('retry: 5000\nevent: state\ndata: '+JSON.stringify(state)+'\n\n');streams.add(res);
  const timer=setInterval(()=>res.write(': heartbeat\n\n'),25000);timer.unref();res.on('close',()=>{clearInterval(timer);streams.delete(res)});return;
 }
 if(route.startsWith('/api/admin/')){
  if(req.method==='POST'||req.method==='PATCH')adminOrigin(req);
  if(route==='/api/admin/login'&&req.method==='POST'){
   const ip=req.socket.remoteAddress||'unknown',now=Date.now();for(const [key,value]of attempts)if(value.until<now)attempts.delete(key);
   let attempt=attempts.get(ip);if(attempt&&attempt.count>=5)throw invalid('Demasiados intentos. Espera 15 minutos.',429);
   if(!attempt){if(attempts.size>=1000)throw invalid('Inténtalo más tarde.',429);attempt={count:0,until:now+15*60000};attempts.set(ip,attempt)}attempt.count++;
   const input=await body(req);if(typeof input.password!=='string'||input.password.length>256)throw invalid('Credenciales incorrectas.',401);
   const actual=await scrypt(input.password,salt,64);if(!timingSafeEqual(actual,expected))throw invalid('Credenciales incorrectas.',401);
   attempts.delete(ip);for(const [token,expiry]of sessions)if(expiry<now)sessions.delete(token);if(sessions.size>=100)sessions.delete(sessions.keys().next().value);
   const token=randomBytes(32).toString('hex');sessions.set(token,now+sessionLifetime);res.setHeader('Set-Cookie',cookie(token,sessionLifetime/1000));return json(res,200,{ok:true});
  }
  if(!authenticated(req))throw invalid('Inicia sesión.',401);
  if(route==='/api/admin/logout'&&req.method==='POST'){const token=(req.headers.cookie||'').match(/paso_session=([a-f0-9]{64})/)?.[1];sessions.delete(token);res.setHeader('Set-Cookie',cookie('',0));return json(res,200,{ok:true})}
  if(route==='/api/admin/state'&&req.method==='GET')return json(res,200,state);
  if(route==='/api/admin/state'&&req.method==='PATCH'){const patch=await body(req);if(!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).some(k=>!['revision','enabled','blockedMessage','announcementText'].includes(k)))throw invalid('Campos no válidos.');return json(res,200,await update(patch))}
  throw invalid('No encontrado.',404);
 }
 if(req.method==='GET'&&files.has(route)){const [name,type]=files.get(route);res.writeHead(200,{'Content-Type':type+'; charset=utf-8'});res.end(await readFile(path.join(here,'public',name)));return}
 throw invalid('No encontrado.',404);
 }catch(e){if(!res.headersSent)json(res,e.status||500,{error:e.status?e.message:'No se pudo completar la operación.'});else res.end()}});
 server.on('close',()=>{for(const res of streams)res.end()});
 return {server,close:async()=>{for(const res of streams)res.end();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await writes.catch(()=>{})}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const {server,close}=await createControlServer();server.listen(Number(process.env.PORT||3000),process.env.HOST||'127.0.0.1',()=>console.log('Panel disponible en /admin · puerto '+server.address().port));for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{close().then(()=>process.exit(0))})}catch(e){console.error(e.message);process.exitCode=1}
}
