/* Administración de disponibilidad y avisos. No contiene credenciales de administración. */
(()=>{
 const config=window.PASO_REMOTE_CONFIG||{};if(!config.baseUrl)return;
 let base;try{const url=new URL(config.baseUrl);if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))throw Error();base=url.href.replace(/\/$/,'')}catch{console.error('Paso: configura una URL HTTPS válida en remote-config.js');return}
 const key='paso-remote:'+base,seenKey=key+':seen';let current=null,source=null,checking=null,loading=true,closedForHidden=false,seen='';
 try{seen=localStorage.getItem(seenKey)||'';const cached=JSON.parse(localStorage.getItem(key));if(valid(cached))current=cached}catch{}
 function valid(s){return s&&typeof s.enabled==='boolean'&&Number.isSafeInteger(s.revision)&&s.revision>=0&&typeof s.blockedMessage==='string'&&s.blockedMessage.length<=1000&&(s.announcement===null||(typeof s.announcement?.id==='string'&&typeof s.announcement?.text==='string'&&s.announcement.text.length<=2000))}
 const layer=document.createElement('section');layer.id='paso-remote-layer';layer.setAttribute('role','dialog');layer.setAttribute('aria-modal','true');layer.setAttribute('aria-labelledby','paso-remote-title');layer.hidden=true;
 const card=document.createElement('div');card.id='paso-remote-card';const title=document.createElement('h2');title.id='paso-remote-title';const text=document.createElement('p');text.id='paso-remote-text';const hint=document.createElement('p');hint.id='paso-remote-hint';const button=document.createElement('button');card.append(title,text,hint,button);layer.append(card);document.body.append(layer);let lastFocus=null;
 function draw(){const blocked=current?.enabled===false,announcement=current?.announcement;const unseen=announcement&&announcement.id!==seen;const visible=blocked||loading||unseen;
  if(visible&&layer.hidden){lastFocus=document.activeElement;document.querySelectorAll("dialog[open]").forEach(dialog=>dialog.close());if(document.fullscreenElement)document.exitFullscreen().catch(()=>{})}
  for(const element of document.body.children){if(element===layer||['SCRIPT','LINK','STYLE'].includes(element.tagName))continue;if(visible){if(!element.hasAttribute('data-paso-remote-inert')){element.setAttribute('data-paso-remote-inert',element.inert?'1':'0');element.inert=true}}else if(element.hasAttribute('data-paso-remote-inert')){element.inert=element.getAttribute('data-paso-remote-inert')==='1';element.removeAttribute('data-paso-remote-inert')}}
  const wasHidden=layer.hidden;layer.hidden=!visible;
  if(blocked){title.textContent='Aplicación deshabilitada';text.textContent=current.blockedMessage;hint.textContent='El administrador ha deshabilitado esta app. Al reconectarte se comprobará si vuelve a estar disponible.';button.textContent='Comprobar de nuevo';button.disabled=false;button.onclick=()=>refresh()}
  else if(loading){title.textContent='Conectando';text.textContent='Comprobando la disponibilidad de la app…';hint.textContent='';button.hidden=true}
  else if(unseen){title.textContent='Aviso';text.textContent=announcement.text;hint.textContent='Mensaje del administrador';button.textContent='Entendido';button.disabled=false;button.onclick=()=>{seen=announcement.id;try{localStorage.setItem(seenKey,seen)}catch{}draw()}}
  if(!loading||blocked)button.hidden=false;
  if(visible&&wasHidden)(button.hidden?card:button).focus();else if(!visible&&!wasHidden&&lastFocus?.isConnected)lastFocus.focus();
 }
 card.tabIndex=-1;layer.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation()}if(e.key==='Tab'){e.preventDefault();(button.hidden?card:button).focus()}});
 function apply(value){if(!valid(value))throw Error('Estado remoto no válido.');if(current&&value.revision<current.revision)return;const blockedBefore=current?.enabled===false;current=value;loading=false;try{localStorage.setItem(key,JSON.stringify(current))}catch{}draw();if(current.enabled===false&&!blockedBefore)window.dispatchEvent(new Event('paso-remote-blocked'))}
 async function refresh(){if(checking)return checking;checking=(async()=>{try{const response=await fetch(base+'/api/app/status',{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(config.timeoutMs||8000)});if(!response.ok)throw Error();apply(await response.json())}catch{loading=false;window.PasoRemoteControl=Object.freeze({isBlocked:()=>current?.enabled===false});
 draw();if(current?.enabled===false)hint.textContent='Sin conexión con el servidor. Se conserva el bloqueo recibido. Vuelve a intentarlo al recuperar Internet.'}finally{checking=null}})();return checking}
 function connect(){if(source||document.hidden||!navigator.onLine)return;source=new EventSource(base+'/api/app/events');source.addEventListener('state',event=>{try{apply(JSON.parse(event.data))}catch{console.warn('Paso: estado remoto no válido.')}})}
 function close(){source?.close();source=null}
 document.addEventListener('visibilitychange',()=>{if(document.hidden){closedForHidden=true;close()}else{closedForHidden=false;refresh();connect()}});
 window.addEventListener('online',()=>{refresh();connect()});window.addEventListener('offline',close);window.addEventListener('pageshow',()=>{if(!closedForHidden){refresh();connect()}});window.addEventListener('pagehide',close);
 window.PasoRemoteControl=Object.freeze({isBlocked:()=>current?.enabled===false});
 draw();if(current?.enabled===false)window.dispatchEvent(new Event('paso-remote-blocked'));refresh();connect();
})();
