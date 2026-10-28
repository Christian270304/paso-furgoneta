const CACHE='paso-assets-van-simple-v1';
const ASSETS=['/theme.js','/offline.html','/icons/paso-192.png','/icons/paso-512.png','/icons/paso-maskable.png','/icons/apple-touch-icon.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('paso-assets-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',event=>{const req=event.request,url=new URL(req.url);if(req.method!=='GET'||url.origin!==self.location.origin)return;if(req.mode==='navigate'){event.respondWith(fetch(req).catch(()=>caches.match('/offline.html')));return}if(ASSETS.includes(url.pathname)){event.respondWith(caches.match(req).then(hit=>hit||fetch(req)));}});
