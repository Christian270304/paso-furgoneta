(()=>{
function el(tag,text){const node=document.createElement(tag);if(text)node.textContent=text;return node}
function download(blob,name){const url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000)}
function open(stop){
 const dialog=el('dialog');dialog.className='delivery-dialog';
 const header=el('div'),body=el('div'),footer=el('div');header.className='delivery-header';body.className='delivery-body';footer.className='delivery-footer';
 const title=el('h2','Entrega'),close=el('button','×');close.className='delivery-close';close.setAttribute('aria-label','Cerrar entrega');close.onclick=()=>dialog.close();header.append(title,close);
 body.append(el('p',stop.name+(stop.door?' · '+stop.door:'')),el('p','Estado: '+({delivered:'Entregado',incident:'Incidencia'}[stop.deliveryStatus]||'Pendiente')));
 for(const [value,label,cls] of [['delivered','Entregado','delivery-success'],['incident','Incidencia','delivery-incident']]){const button=el('button',label);button.className=cls;button.setAttribute('aria-pressed',String(stop.deliveryStatus===value));button.onclick=()=>{window.dispatchEvent(new CustomEvent('delivery-status',{detail:{id:stop.deliveryId,status:value}}));dialog.close()};footer.append(button)}
 dialog.append(header,body,footer);document.querySelector('.mapwrap').append(dialog);dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();
}
function makePDF(pages){const enc=new TextEncoder(),parts=[],offsets=[0];let size=0;const append=v=>{const bytes=typeof v==='string'?enc.encode(v):v;parts.push(bytes);size+=bytes.length};const object=(id,body)=>{offsets[id]=size;append(id+' 0 obj\n');append(body);append('\nendobj\n')};append('%PDF-1.4\n');object(1,'<< /Type /Catalog /Pages 2 0 R >>');object(2,'<< /Type /Pages /Count '+pages.length+' /Kids ['+pages.map((_,i)=>(3+i*3)+' 0 R').join(' ')+'] >>');pages.forEach((p,i)=>{const id=3+i*3;object(id,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im '+(id+2)+' 0 R >> >> /Contents '+(id+1)+' 0 R >>');const stream='q 595.28 0 0 841.89 0 0 cm /Im Do Q';object(id+1,'<< /Length '+enc.encode(stream).length+' >>\nstream\n'+stream+'\nendstream');const binary=atob(p.data.split(',')[1]),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));offsets[id+2]=size;append((id+2)+' 0 obj\n<< /Type /XObject /Subtype /Image /Width '+p.width+' /Height '+p.height+' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+bytes.length+' >>\nstream\n');append(bytes);append('\nendstream\nendobj\n')});const xref=size;append('xref\n0 '+offsets.length+'\n0000000000 65535 f \n');for(let i=1;i<offsets.length;i++)append(String(offsets[i]).padStart(10,'0')+' 00000 n \n');append('trailer\n<< /Size '+offsets.length+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF');return new Blob(parts,{type:'application/pdf'})}

function wrap(ctx,text,width){const result=[];let line='';for(const word of String(text).split(/\s+/)){const next=line?line+' '+word:word;if(ctx.measureText(next).width>width&&line){result.push(line);line=word}else line=next}if(line)result.push(line);return result}
async function exportPDF(stops){
 const button=document.getElementById('exportdeliveries');button.disabled=true;
 try{
  if(!stops.length){alert('No hay paradas para generar el PDF.');return}
  const report=await window.getDeliveryReportMeta(),pages=[];let canvas,ctx,y;
  function page(){if(canvas)pages.push({data:canvas.toDataURL('image/jpeg',.9),width:canvas.width,height:canvas.height});canvas=document.createElement('canvas');canvas.width=1240;canvas.height=1754;ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,1240,1754);ctx.fillStyle='#172c35';ctx.font='bold 30px sans-serif';ctx.fillText('Paso · Recorrido en furgoneta',65,75);ctx.font='20px sans-serif';ctx.fillText(report.date+' · Ruta '+report.number,65,110);y=170}
  page();
  stops.forEach((stop,index)=>{ctx.font='bold 25px sans-serif';const rows=wrap(ctx,(index+1)+'. '+stop.name+(stop.door?' · '+stop.door:''),1110);if(y+rows.length*32+72>1660)page();ctx.font='bold 25px sans-serif';for(const row of rows){ctx.fillText(row,65,y);y+=32}ctx.font='21px sans-serif';const status=stop.kind==='pickup'?(stop.pickupDone?'Recogido':'Pendiente'):({delivered:'Entregado',incident:'Incidencia'}[stop.deliveryStatus]||'Pendiente');ctx.fillText((stop.kind==='pickup'?'Recogida':'Entrega')+' · '+status+(stop.deadline?' · Antes de '+stop.deadline:''),65,y);y+=60});
  pages.push({data:canvas.toDataURL('image/jpeg',.9),width:canvas.width,height:canvas.height});download(makePDF(pages),'entregas-'+report.date+'-ruta'+report.number+'.pdf');
 }catch{alert('No se pudo generar el PDF. Las paradas siguen guardadas en la app.')}finally{button.disabled=false}
}
window.PasoDeliveries={open,exportPDF,clear:async()=>{},makePDF};
})();
