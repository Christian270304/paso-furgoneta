(()=>{
  const validTime=value=>/^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  function parseLine(line){
    let text=line.trim(),priority=false,kind='delivery',deadline='';
    text=text.replace(/\b(prioridad|recogida)\b/gi,word=>{if(word.toLowerCase()==='prioridad')priority=true;else kind='pickup';return ''});
    text=text.replace(/(?:antes\s+de(?:\s+las)?\s*)?(\d{1,2})(?:[:h](\d{2})|\s*h\b)/gi,(_,h,m)=>{if(deadline)throw Error('Usa una sola hora límite por dirección.');deadline=h.padStart(2,'0')+':'+(m||'00');if(!validTime(deadline))throw Error('Hora incorrecta en: '+line);return ''});
    text=text.replace(/[.;|]+\s*$/g,'').replace(/[,.;|]\s*[,.;|]+/g,',').trim().replace(/[,.;|]+$/,'').trim();
    if(/antes\s+de/i.test(text))throw Error('Escribe la hora como 13:00 en: '+line);
    if(priority&&!deadline)deadline='13:00';
    return {text,options:{priority:priority||!!deadline,deadline,kind}};
  }
  const stopKey=s=>Number(s.lat).toFixed(5)+','+Number(s.lon).toFixed(5);
  function order(m,items,fixed,optimize,start=new Date(),history=[]){
    const base=optimize(m,items.length,fixed);if(!base)return null;
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en',{timeZone:'Europe/Madrid',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(start).map(p=>[p.type,p.value]));
    const now=Number(parts.hour)*3600+Number(parts.minute)*60+Number(parts.second);
    const deadlines=items.map(s=>{const value=s.deadline||(s.priority?'13:00':'');if(!validTime(value))return Infinity;const [h,min]=value.split(':').map(Number);const remaining=h*3600+min*60-now;return remaining<=0?Infinity:remaining});
    const travel=(a,b)=>m.times?.[a]?.[b]??Infinity;
    function score(seq){let previous=0,elapsed=0,distance=0,missed=0,late=0;for(const id of seq){const d=m[previous][id],t=travel(previous,id);if(!Number.isFinite(d)||!Number.isFinite(t))return [Infinity,Infinity,Infinity];distance+=d;elapsed+=t;if(id<=items.length&&Number.isFinite(deadlines[id-1])&&elapsed>=deadlines[id-1]){missed++;late+=Math.max(.001,elapsed-deadlines[id-1])}previous=id}return [missed,late,distance]}
    function better(a,b){for(let i=0;i<3;i++){if(a[i]<b[i]-.00001)return true;if(a[i]>b[i]+.00001)return false}return false}
    const seeds=[base],n=items.length,finish=seq=>fixed?seq.concat(n+1):seq;
    // Different first stops explore different neighbourhoods, independent of input order.
    for(let first=1;first<=n;first++){const seq=[first],left=new Set(Array.from({length:n},(_,i)=>i+1));left.delete(first);let previous=first;while(left.size){let next=null;for(const id of left)if(next===null||m[previous][id]<m[previous][next])next=id;seq.push(next);left.delete(next);previous=next}seeds.push(finish(seq))}
    seeds.push(finish(items.map((_,i)=>i+1).sort((a,b)=>deadlines[a-1]-deadlines[b-1]||m[0][a]-m[0][b])));
    for(const saved of history){if(!Array.isArray(saved))continue;const available=items.map((s,i)=>({key:stopKey(s),id:i+1})),seq=[];for(const key of saved){const i=available.findIndex(s=>s.key===key);if(i>=0)seq.push(available.splice(i,1)[0].id)}if(seq.length){seq.push(...available.map(s=>s.id));seeds.push(finish(seq))}}
    // Solve the distance problem exactly for up to 16 distinct portal coordinates.
    // Zero-distance duplicate packages stay together and still keep their individual records.
    const groups=[];items.forEach((s,i)=>{let g=groups.find(g=>Number.isFinite(s.lat)&&s.lat===items[g[0]-1].lat&&s.lon===items[g[0]-1].lon&&g.every(id=>m[id][i+1]===0&&m[i+1][id]===0));if(g)g.push(i+1);else groups.push([i+1])});
    const k=groups.length;if(k<=16){const count=1<<k,dp=new Float64Array(count*k).fill(Infinity),parent=new Int8Array(count*k).fill(-1);for(let j=0;j<k;j++)dp[(1<<j)*k+j]=m[0][groups[j][0]];for(let mask=1;mask<count;mask++)for(let j=0;j<k;j++){if(!(mask&(1<<j)))continue;const value=dp[mask*k+j];if(!Number.isFinite(value))continue;for(let t=0;t<k;t++){if(mask&(1<<t))continue;const index=(mask|(1<<t))*k+t,next=value+m[groups[j][0]][groups[t][0]];if(next<dp[index]){dp[index]=next;parent[index]=j}}}let last=-1,value=Infinity;for(let j=0;j<k;j++){const next=dp[(count-1)*k+j]+(fixed?m[groups[j][0]][n+1]:0);if(next<value){value=next;last=j}}if(last>=0){let mask=count-1;const path=[];while(last>=0){path.unshift(groups[last]);const prev=parent[mask*k+last];mask^=1<<last;last=prev}seeds.push(finish(path.flat()))}}
    const unique=[...new Map(seeds.map(seq=>[seq.join(','),seq])).values()];unique.sort((a,b)=>better(score(a),score(b))?-1:better(score(b),score(a))?1:0);
    let best=base,bestScore=score(base);
    for(let seq of unique.slice(0,6)){let value=score(seq);for(let round=0;round<12;round++){let next=null,nextScore=value;for(let a=0;a<n;a++)for(let b=0;b<n;b++){if(a===b)continue;let v;for(let length=1;length<=Math.min(n<=30?3:1,n-a);length++){if(b>n-length)continue;const moved=seq.slice(),block=moved.splice(a,length);moved.splice(b,0,...block);v=score(moved);if(better(v,nextScore)){next=moved;nextScore=v}}const swapped=seq.slice();[swapped[a],swapped[b]]=[swapped[b],swapped[a]];v=score(swapped);if(better(v,nextScore)){next=swapped;nextScore=v}if(a<b){const reversed=seq.slice(0,a).concat(seq.slice(a,b+1).reverse(),seq.slice(b+1));v=score(reversed);if(better(v,nextScore)){next=reversed;nextScore=v}}}if(!next)break;seq=next;value=nextScore}if(better(value,bestScore)){best=seq;bestScore=value}}
    return best;
  }
  function schedule(items,legs,start=new Date()){
    let arrival=+start;
    return items.map((s,i)=>{arrival+=(legs[i]?.summary?.time||0)*1000;const eta=new Intl.DateTimeFormat('es-ES',{timeZone:'Europe/Madrid',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(arrival));const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(arrival));const startDay=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(start);const late=!!s.deadline&&(today!==startDay||eta>=s.deadline);const initial=new Intl.DateTimeFormat('es-ES',{timeZone:'Europe/Madrid',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(start);return {id:s.deliveryId,eta,late,expired:!!s.deadline&&initial>=s.deadline,deadline:s.deadline||''}});
  }
  function description(s){return [s.kind==='pickup'?(s.pickupDone?'Recogido':'Recogida'):'',s.priority?'Prioridad':'',s.deadline?'Antes de '+s.deadline:'',s.eta?'Conducción, sin paradas: '+s.eta:'',s.expired?'⚠ Hora límite ya pasada':s.late?'⚠ Fuera de hora estimada':''].filter(Boolean).join(' · ')}
  window.PasoPlanning={stopKey,parseLine,order,schedule,description,validTime};
})();
