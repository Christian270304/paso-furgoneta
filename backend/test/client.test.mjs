import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const script=await readFile(new URL('../../www/remote-control.js',import.meta.url),'utf8');
const tick=()=>new Promise(r=>setImmediate(r));
function client(initial,storage=new Map(),offline=false){
 const all=[],events=[];
 function node(tag){const attrs=new Map();const n={tagName:tag.toUpperCase(),hidden:false,inert:false,isConnected:true,children:[],append(...items){this.children.push(...items)},setAttribute(k,v){attrs.set(k,v)},hasAttribute:k=>attrs.has(k),getAttribute:k=>attrs.get(k),removeAttribute:k=>attrs.delete(k),addEventListener(){},focus(){},};all.push(n);return n}
 const main=node('main'),body=node('body');body.append(main);const document={body,hidden:false,createElement:node,querySelectorAll:()=>[],addEventListener(){}};
 class Source{static instances=[];constructor(){this.listeners={};Source.instances.push(this)}addEventListener(event,fn){this.listeners[event]=fn}close(){}emit(data){this.listeners.state({data:JSON.stringify(data)})}}
 const window={PASO_REMOTE_CONFIG:{baseUrl:'https://backend.example'},addEventListener(){},dispatchEvent:e=>events.push(e.type)};
 const scope={window,document,localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)},navigator:{onLine:!offline},URL,AbortSignal,Event,console,EventSource:Source,fetch:async()=>{if(offline)throw Error();return {ok:true,json:async()=>initial}}};vm.createContext(scope);vm.runInContext(script,scope);
 return {window,all,main,events,storage,Source};
}
test('cliente: bloquear, habilitar, aviso seguro una vez y bloqueo offline',async()=>{
 const initial={revision:0,enabled:true,blockedMessage:'Mantenimiento',announcement:null};const c=client(initial);await tick();assert.equal(c.main.inert,false);
 const source=c.Source.instances[0];source.emit({...initial,revision:1,enabled:false});assert.equal(c.window.PasoRemoteControl.isBlocked(),true);assert.equal(c.main.inert,true);assert.ok(c.events.includes('paso-remote-blocked'));
 source.emit({...initial,revision:2,enabled:true,announcement:{id:'one',text:'<script>No ejecutar</script>'}});assert.equal(c.main.inert,true);const text=c.all.find(n=>n.id==='paso-remote-text');assert.equal(text.textContent,'<script>No ejecutar</script>');const button=c.all.find(n=>n.tagName==='BUTTON');button.onclick();assert.equal(c.main.inert,false);
 source.emit({...initial,revision:2,announcement:{id:'one',text:'<script>No ejecutar</script>'}});assert.equal(c.main.inert,false);
 source.emit({...initial,revision:1,enabled:false});assert.equal(c.window.PasoRemoteControl.isBlocked(),false,'ignora respuestas anteriores');
 source.emit({...initial,revision:3,enabled:false});const restarted=client(initial,c.storage,true);await tick();assert.equal(restarted.window.PasoRemoteControl.isBlocked(),true);assert.equal(restarted.main.inert,true);
 const firstOffline=client(initial,new Map(),true);await tick();assert.equal(firstOffline.main.inert,false,'sin orden recibida no se inventa un bloqueo');
});
