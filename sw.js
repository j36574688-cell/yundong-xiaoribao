const CACHE='sports-daily-v4.2.0-static';
const STATIC=['/manifest.json','/icon-192.png','/icon-512.png'];

self.addEventListener('install',e=>{
  e.waitUntil(
    caches.open(CACHE)
      .then(c=>c.addAll(STATIC))
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate',e=>{
  e.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(
        keys
          .filter(k=>k.startsWith('sports-daily-')&&k!==CACHE)
          .map(k=>caches.delete(k))
      ))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(u.origin!==location.origin)return;
  if(e.request.method!=='GET')return;

  /* HTML 導覽一律 Network First，避免舊 index.html 被 Service Worker 永久卡住。 */
  if(e.request.mode==='navigate' || u.pathname==='/' || u.pathname==='/index.html'){
    e.respondWith(
      fetch(e.request,{cache:'no-store'})
        .then(r=>{
          const copy=r.clone();
          caches.open(CACHE).then(c=>c.put('/index.html',copy));
          return r;
        })
        .catch(()=>caches.match('/index.html'))
    );
    return;
  }

  /* API 同樣以最新網路資料優先，離線時才回快取。 */
  if(u.pathname.startsWith('/api/')){
    e.respondWith(
      fetch(e.request,{cache:'no-store'})
        .catch(()=>caches.match(e.request))
    );
    return;
  }

  /* CSS／JS／靜態檔 Network First，避免前端修正被舊 cache 吃掉。 */
  e.respondWith(
    fetch(e.request,{cache:'no-store'})
      .then(r=>{
        const copy=r.clone();
        caches.open(CACHE).then(c=>c.put(e.request,copy));
        return r;
      })
      .catch(()=>caches.match(e.request).then(hit=>hit||caches.match('/index.html')))
  );
});
