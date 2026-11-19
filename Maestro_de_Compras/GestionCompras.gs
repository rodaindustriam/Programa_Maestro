// SOLO COMPRAS. No cambia las 19 columnas activas ni las 20 del histórico.
var COMPRAS_HOJAS_GESTION_ = {
  operaciones: ['RIM_Compras_Operaciones', ['OPERACION','TIPO','TICKET','CORREO','AUTOR','FECHA','ESTADO','DATOS_JSON']],
  bitacora: ['RIM_Compras_Bitacora', ['OPERACION','FECHA','TICKET','ID_ITEM','ACCION','ANTERIOR','NUEVO','AUTOR','CORREO','MOTIVO']],
  proveedores: ['RIM_Compras_Proveedores_Items', ['ID_ITEM','TICKET','PRV_SOLICITADO','PRV_REAL','FECHA','CORREO','AUTOR','OPERACION']],
  archivo: ['RIM_Compras_Archivo_Items', ['OPERACION','ID_ITEM','FILA_JSON']]
};
function comprasHojaGestion_(tipo) {
  var spec = COMPRAS_HOJAS_GESTION_[tipo], libro = obtenerLibroCentral_();
  var h = libro.getSheetByName(spec[0]);
  if (!h) h = libro.insertSheet(spec[0]);
  if (h.getMaxColumns() < spec[1].length) h.insertColumnsAfter(h.getMaxColumns(), spec[1].length-h.getMaxColumns());
  if (!h.getLastRow()) h.appendRow(spec[1]);
  else {
    var actuales = h.getRange(1,1,1,spec[1].length).getValues()[0];
    if (actuales.some(function(v,i){return v !== spec[1][i];})) throw new Error('La estructura de '+spec[0]+' no coincide. No se sobrescribió.');
  }
  return h;
}
function comprasFilas_(h, columnas) { return h && h.getLastRow()>1 ? h.getRange(2,1,h.getLastRow()-1,columnas).getValues() : []; }
function comprasTexto_(v,max) { return String(v == null?'':v).trim().slice(0,max||500); }
function comprasTicket_(v) { v=comprasTexto_(v,100);if(!/^TCK-\d+$/.test(v))throw new Error('Ticket inválido.');return v; }
function comprasIdOperacion_(v) { v=String(v||'');if(!/^[a-zA-Z0-9_-]{20,100}$/.test(v))throw new Error('Identificador de operación inválido.');return v; }
function comprasEstado_(v) {
  v=String(v||'PENDIENTE').trim().toUpperCase();
  if(v.indexOf('DESPACH')>=0)return 'DESPACHADO_CONFORME';
  if(v.indexOf('RECHAZ')>=0||v.indexOf('DEVOLUC')>=0)return 'RECHAZADO_DEVOLUCION';
  if(v.indexOf('ORDEN')>=0||v.indexOf('COTIZACION')>=0)return 'ORDEN_COMPRA';
  if(v==='APROBADO'||v.indexOf('TRANSITO')>=0)return 'EN_TRANSITO';
  if(v.indexOf('RECIBIDO')>=0||v.indexOf('ALMACEN')>=0)return 'RECIBIDO';
  return v;
}
function comprasValidarTransicion_(antes,despues) {
  var estados=['PENDIENTE','ORDEN_COMPRA','EN_TRANSITO','RECIBIDO','RECHAZADO_DEVOLUCION'];
  if(estados.indexOf(antes)<0||estados.indexOf(despues)<0)throw new Error('Estado inválido.');
  // Se conserva el movimiento libre entre etapas, sin motivos ni pasos extra.
}
function comprasMapaProveedores_() {
  var h=obtenerLibroCentral_().getSheetByName(COMPRAS_HOJAS_GESTION_.proveedores[0]);
  var mapa={};comprasFilas_(h,8).forEach(function(f,i){if(f[0])mapa[String(f[0])]={fila:i+2,ticket:String(f[1]),solicitado:String(f[2]),real:String(f[3]),operacion:String(f[7])};});return mapa;
}
function comprasFilaObjeto_(f,indice,historico,mapa) {
  var id=String(f[1]||''),m=mapa[id],solicitado=String(f[10]||'PRV');
  var fecha=f[2] instanceof Date?Utilities.formatDate(f[2],'America/Caracas','dd/MM/yyyy HH:mm'):String(f[2]||'');
  var despacho=f[19] instanceof Date?Utilities.formatDate(f[19],'America/Caracas','dd/MM/yyyy HH:mm'):String(f[19]||'');
  return {fila:indice+2,ticket:String(f[0]),id_item:id,fecha:fecha,fecha_despacho:despacho,
    sucursal_origen:String(f[3]||''),responsable:String(f[4]||''),sucursal_entrega:String(f[5]||''),cliente:String(f[6]||''),estatus_pago:String(f[7]||'PAGADO'),item:String(f[8]||''),marca:String(f[9]||''),
    prv:m&&m.ticket===String(f[0])?m.real:solicitado,prv_solicitado:solicitado,prv_real:m&&m.ticket===String(f[0])?m.real:solicitado,
    descripcion:String(f[11]||''),stock_maracay:Number(f[12])||0,stock_el_tigre:Number(f[13])||0,stock_barquisimeto:Number(f[14])||0,cant:Number(f[15])||1,urgencia:String(f[16]||'Normal'),motivo:String(f[17]||''),estado:historico?'DESPACHADO_CONFORME':comprasEstado_(f[18]),es_historico:!!historico};
}
function comprasResumenHistorico_() {
  var cache=CacheService.getScriptCache(),raw=cache.get('compras:resumenHistorico');if(raw)return JSON.parse(raw);
  var h=obtenerLibroCentral_().getSheetByName('Historico_Pedidos'),tickets={},piezas=0;
  comprasFilas_(h,16).forEach(function(f){if(f[0]){tickets[String(f[0])]=true;piezas+=Number(f[15])||0;}});
  var r={tickets:Object.keys(tickets).length,piezas:piezas};cache.put('compras:resumenHistorico',JSON.stringify(r),300);return r;
}
function comprasPendientes_(u) {
  var h=obtenerLibroCentral_().getSheetByName(COMPRAS_HOJAS_GESTION_.operaciones[0]);
  return comprasFilas_(h,7).filter(function(f){return (f[3]===u.email||u.puedeEditarProveedores)&&f[6]!=='COMPLETA';}).map(function(f){return {id:String(f[0]),tipo:String(f[1]),ticket:String(f[2]),autor:String(f[4])};});
}
function comprasLeerActivas_(u) {
  var h=obtenerLibroCentral_().getSheetByName('Solicitudes_Pedidos');if(!h)throw new Error('No existe la hoja Solicitudes_Pedidos.');
  var mapa=comprasMapaProveedores_(),resumen=comprasResumenHistorico_();
  // Solo IDs de archivo en recuperación, no leer todo el histórico en cada sondeo.
  var ops=comprasFilas_(obtenerLibroCentral_().getSheetByName(COMPRAS_HOJAS_GESTION_.operaciones[0]),7);
  var bloqueados={};ops.forEach(function(f){if(f[6]!=='COMPLETA')bloqueados[String(f[2])]=true;});
  var activas=comprasFilas_(h,19).filter(function(f){return !!f[0];}).map(function(f,i){var o=comprasFilaObjeto_(f,i,false,mapa);o.operacion_pendiente=!!bloqueados[o.ticket];return o;});
  return {exito:true,activas:activas.reverse(),totalHistoricoTickets:resumen.tickets,totalHistoricoPiezas:resumen.piezas,operacionesPendientes:comprasPendientes_(u)};
}
function comprasLeerHistorico_(filtros) {
  filtros=filtros||{};var texto=comprasTexto_(filtros.texto,200).toLowerCase(),pagina=Math.max(1,parseInt(filtros.pagina,10)||1),tamano=25;
  var h=obtenerLibroCentral_().getSheetByName('Historico_Pedidos'),mapa=comprasMapaProveedores_(),grupos={},piezas=0;
  comprasFilas_(h,20).forEach(function(f,i){if(!f[0])return;var o=comprasFilaObjeto_(f,i,true,mapa);(grupos[o.ticket]||(grupos[o.ticket]={fecha:f[19] instanceof Date?f[19].getTime():f[2] instanceof Date?f[2].getTime():0,items:[]})).items.push(o);piezas+=o.cant;});
  var todos=Object.keys(grupos).map(function(k){return grupos[k];}).sort(function(a,b){return b.fecha-a.fecha;});
  var filtrados=todos.filter(function(g){return !texto||g.items.some(function(o){return [o.ticket,o.cliente,o.responsable,o.item,o.marca,o.prv,o.prv_solicitado,o.sucursal_origen,o.sucursal_entrega].join(' ').toLowerCase().indexOf(texto)>=0;});});
  var paginas=Math.max(1,Math.ceil(filtrados.length/tamano));pagina=Math.min(pagina,paginas);
  return {exito:true,historico:[].concat.apply([],filtrados.slice((pagina-1)*tamano,pagina*tamano).map(function(g){return g.items;})),pagina:pagina,paginas:paginas,total:filtrados.length,totalHistoricoTickets:todos.length,totalHistoricoPiezas:piezas};
}
function comprasLeerComentarios_(desde) {
  var h=obtenerLibroCentral_().getSheetByName('Comentarios_Tickets'),ultimo=h?h.getLastRow():0;
  var cursor=Math.max(1,parseInt(desde,10)||1),reiniciar=cursor>Math.max(ultimo,1);if(reiniciar)cursor=1;
  var filas=h&&ultimo>cursor?h.getRange(cursor+1,1,ultimo-cursor,6).getValues():[];
  return {exito:true,cursor:Math.max(ultimo,1),reiniciar:reiniciar,comentarios:filas.filter(function(f){return !!f[0];}).map(function(f){return {id:String(f[0]),ticket:String(f[1]),fecha:f[2] instanceof Date?Utilities.formatDate(f[2],'America/Caracas','dd/MM/yyyy HH:mm'):String(f[2]||''),autor:String(f[3]),rol:String(f[4]),mensaje:String(f[5])};})};
}
function comprasBuscarOperacion_(id) {
  var h=comprasHojaGestion_('operaciones'),filas=comprasFilas_(h,8);
  for(var i=0;i<filas.length;i++)if(filas[i][0]===id)return {h:h,fila:i+2,valores:filas[i],datos:JSON.parse(filas[i][7])};
  return null;
}
function comprasFilasTicket_(ticket) {
  return comprasFilas_(obtenerLibroCentral_().getSheetByName('Solicitudes_Pedidos'),19).map(function(f,i){return {fila:i+2,v:f};}).filter(function(r){return String(r.v[0])===ticket;});
}
function comprasHistorial_(op,anterior,nuevo,idItem,motivo) {
  var h=comprasHojaGestion_('bitacora');if(comprasFilas_(h,10).some(function(f){return f[0]===op.valores[0];}))return;
  h.appendRow([op.valores[0],new Date(op.valores[5]),op.valores[2],idItem||'',op.valores[1],anterior,nuevo,op.valores[4],op.valores[3],motivo||'']);SpreadsheetApp.flush();
}
function comprasCompletarOperacion_(op,resultado) {
  op.datos.resultado=resultado;
  op.h.getRange(op.fila,7,1,2).setValues([['COMPLETA',JSON.stringify(op.datos)]]);SpreadsheetApp.flush();
  return resultado;
}
function comprasPrepararOperacion_(tipo,solicitud,u) {
  var ticket=comprasTicket_(solicitud.ticket),filas=comprasFilasTicket_(ticket);
  if(!filas.length){
    if(tipo==='ARCHIVAR'&&comprasFilas_(obtenerLibroCentral_().getSheetByName('Historico_Pedidos'),2).some(function(f){return String(f[0])===ticket;}))return {yaArchivado:true};
    throw new Error('El ticket no está activo. Actualiza el tablero.');
  }
  var ids={};filas.forEach(function(r){var id=String(r.v[1]||'');if(!id||ids[id])throw new Error('El ticket tiene ID_ITEM ausente o duplicado. Revisa sus datos antes de continuar.');ids[id]=true;});
  var estados=filas.map(function(r){return comprasEstado_(r.v[18]);});
  if(estados.some(function(e){return e!==estados[0];}))throw new Error('El ticket tiene estados distintos por producto. Requiere revisión.');
  if(tipo==='CAMBIO_ESTADO'){
    if(estados[0]!==solicitud.anterior)throw new Error('CONFLICTO: el estado cambió. Actualiza el tablero antes de continuar.');
    comprasValidarTransicion_(solicitud.anterior,solicitud.nuevo,solicitud.motivo);
    return {ids:Object.keys(ids),anterior:estados[0]};
  }
  if(tipo==='ASIGNAR_PROVEEDOR'){
    var r=filas.filter(function(x){return String(x.v[1])===solicitud.idItem;})[0];if(!r)throw new Error('Producto no encontrado en el ticket.');
    var proveedores=obtenerProveedores_();if(!proveedores.exito)throw new Error('No se pudo verificar el directorio de proveedores.');
    if(!proveedores.proveedores.some(function(p){return p.codigo===solicitud.nuevo;}))throw new Error('Selecciona un proveedor existente del directorio.');
    var mapa=comprasMapaProveedores_(),m=mapa[solicitud.idItem],actual=m?m.real:String(r.v[10]||'PRV');
    if(actual!==solicitud.anterior)throw new Error('CONFLICTO: otro usuario cambió este proveedor. Actualiza el tablero.');
    return {original:String(r.v[10]||'PRV')};
  }
  if(tipo==='ARCHIVAR'){
    if(estados[0]!=='RECIBIDO')throw new Error('Solo se pueden despachar y archivar tickets en Recibido.');
    return {ids:Object.keys(ids),fecha:new Date().toISOString()};
  }
  throw new Error('Tipo de operación inválido.');
}
function comprasEjecutarAccion_(tipo,solicitud,id,u,recuperar) {
  id=comprasIdOperacion_(id);var lock=LockService.getScriptLock(),tomado=false;
  try{
    lock.waitLock(15000);tomado=true;
    var op=comprasBuscarOperacion_(id);
    if(op){
      if((op.valores[3]!==u.email&&!(recuperar&&u.puedeEditarProveedores))||op.valores[1]!==tipo||JSON.stringify(op.datos.solicitud)!==JSON.stringify(solicitud))throw new Error('El identificador ya pertenece a otra operación.');
      if(op.valores[6]==='COMPLETA')return op.datos.resultado;
      if(op.valores[3]!==u.email){op.datos.recuperacion={correo:u.email,autor:u.nombre+' ('+u.etiqueta+')',fecha:new Date().toISOString()};op.h.getRange(op.fila,8).setValue(JSON.stringify(op.datos));SpreadsheetApp.flush();}
    }else{
      var h=comprasHojaGestion_('operaciones'),pendiente=comprasFilas_(h,7).filter(function(f){return f[2]===solicitud.ticket&&f[6]!=='COMPLETA';})[0];
      if(pendiente)throw new Error('CONFLICTO: el ticket tiene una operación pendiente de '+String(pendiente[4])+'. Debe reintentarse primero.');
      var preparado=comprasPrepararOperacion_(tipo,solicitud,u);
      if(preparado.yaArchivado)return {exito:true,ticket:solicitud.ticket,repetido:true};
      // Crear/validar las hojas auxiliares antes de modificar datos operativos.
      comprasHojaGestion_('bitacora');if(tipo==='ARCHIVAR')comprasHojaGestion_('archivo');if(tipo==='ASIGNAR_PROVEEDOR')comprasHojaGestion_('proveedores');
      var datos={solicitud:solicitud,preparado:preparado};
      h.appendRow([id,tipo,solicitud.ticket,u.email,u.nombre+' ('+u.etiqueta+')',new Date(),'PENDIENTE',JSON.stringify(datos)]);SpreadsheetApp.flush();
      op=comprasBuscarOperacion_(id);
    }
    return comprasAplicarOperacion_(op);
  }finally{if(tomado)lock.releaseLock();}
}
function comprasAplicarOperacion_(op) {
  var tipo=op.valores[1],s=op.datos.solicitud,p=op.datos.preparado;
  if(tipo==='CAMBIO_ESTADO'){
    var filas=comprasFilasTicket_(s.ticket),mapa={};filas.forEach(function(r){mapa[String(r.v[1])]=r;});
    p.ids.forEach(function(id){var r=mapa[id];if(!r)throw new Error('Falta un producto del ticket. No se completó la operación.');var estado=comprasEstado_(r.v[18]);if(estado!==s.anterior&&estado!==s.nuevo)throw new Error('CONFLICTO: estado incompatible con el reintento.');});
    p.ids.forEach(function(id){var r=mapa[id];if(comprasEstado_(r.v[18])!==s.nuevo)obtenerLibroCentral_().getSheetByName('Solicitudes_Pedidos').getRange(r.fila,19).setValue(s.nuevo);});SpreadsheetApp.flush();
    comprasHistorial_(op,s.anterior,s.nuevo,'',s.motivo);
    return comprasCompletarOperacion_(op,{exito:true,ticket:s.ticket,estado:s.nuevo,operacion:op.valores[0]});
  }
  if(tipo==='ASIGNAR_PROVEEDOR'){
    var h=comprasHojaGestion_('proveedores'),mapa=comprasMapaProveedores_(),m=mapa[s.idItem];
    if(m&&m.operacion!==op.valores[0]&&m.real!==s.anterior)throw new Error('CONFLICTO: proveedor incompatible con el reintento.');
    if(!m||m.operacion!==op.valores[0]){
      var fila=[s.idItem,s.ticket,p.original,s.nuevo,new Date(op.valores[5]),op.valores[3],op.valores[4],op.valores[0]];
      if(m)h.getRange(m.fila,1,1,8).setValues([fila]);else h.appendRow(fila);SpreadsheetApp.flush();
    }
    comprasHistorial_(op,s.anterior,s.nuevo,s.idItem,s.motivo);
    return comprasCompletarOperacion_(op,{exito:true,ticket:s.ticket,id_item:s.idItem,prv_real:s.nuevo,prv_solicitado:p.original,operacion:op.valores[0]});
  }
  if(tipo==='ARCHIVAR')return comprasAplicarArchivo_(op);
  throw new Error('Operación desconocida.');
}
function comprasHojaHistorico_() {
  var h=obtenerLibroCentral_().getSheetByName('Historico_Pedidos');if(!h)h=obtenerLibroCentral_().insertSheet('Historico_Pedidos');
  if(h.getMaxColumns()<20)h.insertColumnsAfter(h.getMaxColumns(),20-h.getMaxColumns());
  if(!h.getLastRow())h.appendRow(['NRO_TICKET','ID_ITEM','FECHA_HORA_CREACION','SUCURSAL_ORIGEN','RESPONSABLE','SUCURSAL_ENTREGA','CLIENTE','ESTATUS_PAGO','ITEM_CODIGO','MARCA','PROVEEDOR_ORIGEN','DESCRIPCION','STOCK_MARACAY','STOCK_TIGRE','STOCK_BQTO','CANTIDAD_SOLICITADA','URGENCIA','OBSERVACION_MOTIVO','ESTADO_FINAL','FECHA_HORA_DESPACHO']);return h;
}
function comprasAplicarArchivo_(op) {
  var s=op.datos.solicitud,p=op.datos.preparado,staging=comprasHojaGestion_('archivo'),guardadas={};
  comprasFilas_(staging,3).filter(function(f){return f[0]===op.valores[0];}).forEach(function(f){guardadas[String(f[1])]=JSON.parse(f[2]);});
  var activas=comprasFilasTicket_(s.ticket),actuales={};activas.forEach(function(r){actuales[String(r.v[1])]=r;});
  var faltantes=[];
  p.ids.forEach(function(id){if(guardadas[id])return;var r=actuales[id];if(!r||comprasEstado_(r.v[18])!=='RECIBIDO')throw new Error('No se pudo preparar el archivo: falta un producto o cambió su estado.');var f=r.v.slice(0,19);f[18]='DESPACHADO_CONFORME';f.push(p.fecha);var json=JSON.stringify(f);if(json.length>45000)throw new Error('Un producto supera el tamaño máximo de archivo.');faltantes.push([op.valores[0],id,json]);guardadas[id]=f;});
  if(faltantes.length)staging.getRange(staging.getLastRow()+1,1,faltantes.length,3).setValues(faltantes);SpreadsheetApp.flush();
  var hist=comprasHojaHistorico_(),existentes={};
  comprasFilas_(hist,20).forEach(function(f){if(f[1]){var id=String(f[1]);if(existentes[id])existentes[id].duplicado=true;else existentes[id]={v:f};}});
  var porCopiar=[];
  p.ids.forEach(function(id){var copia=guardadas[id],ex=existentes[id];
    if(ex){if(ex.duplicado||String(ex.v[0])!==s.ticket||String(ex.v[8])!==String(copia[8])||Number(ex.v[15])!==Number(copia[15]))throw new Error('El histórico contiene un ID_ITEM duplicado o incompatible: '+id+'. No se borraron datos activos.');}
    else{var f=copia.slice();if(f[2])f[2]=new Date(f[2]);f[19]=new Date(p.fecha);porCopiar.push(f);}
  });
  if(porCopiar.length)hist.getRange(hist.getLastRow()+1,1,porCopiar.length,20).setValues(porCopiar);SpreadsheetApp.flush();
  // Confirmar todos los IDs persistidos antes de limpiar cualquier fila activa.
  var verificados={};comprasFilas_(hist,2).forEach(function(f){if(String(f[0])===s.ticket)verificados[String(f[1])]=true;});
  p.ids.forEach(function(id){if(!verificados[id])throw new Error('El histórico no confirmó todos los productos. Reintenta el archivo.');});
  var hoja=obtenerLibroCentral_().getSheetByName('Solicitudes_Pedidos');
  // No borrar filas físicas: Ventas es otro proyecto y su ScriptLock no se comparte.
  // Releer por ID y limpiar solo A:S evita desplazar los índices de sus escrituras.
  comprasFilasTicket_(s.ticket).forEach(function(r){var id=String(r.v[1]);if(p.ids.indexOf(id)<0)throw new Error('El ticket tiene productos adicionales; revisa antes de continuar.');});
  comprasFilasTicket_(s.ticket).forEach(function(r){var id=String(r.v[1]),actual=hoja.getRange(r.fila,1,1,2).getValues()[0];if(String(actual[0])===s.ticket&&String(actual[1])===id)hoja.getRange(r.fila,1,1,19).clearContent();});SpreadsheetApp.flush();
  CacheService.getScriptCache().remove('compras:resumenHistorico');
  comprasHistorial_(op,'RECIBIDO','DESPACHADO_CONFORME','',s.motivo||'Despacho confirmado');
  return comprasCompletarOperacion_(op,{exito:true,ticket:s.ticket,totalItemsArchivados:p.ids.length,operacion:op.valores[0]});
}
