// Archivo completo del documento: se guarda en una columna nueva sin mover las anteriores.
function rimHojaCotizaciones_() {
  var libro = obtenerLibroCentral_(), hoja = libro.getSheetByName('Historial_Cotizaciones');
  if (!hoja) hoja = libro.insertSheet('Historial_Cotizaciones');
  var columnas = ['FOLIO','FECHA','CLIENTE','RIF','TELEFONO','DIRECCION','CIUDAD','TOTAL_USD','DETALLE_ITEMS','DOCUMENTO_JSON','ID_SOLICITUD','EMAIL_VENDEDOR'];
  if (hoja.getMaxColumns() < columnas.length) hoja.insertColumnsAfter(hoja.getMaxColumns(), columnas.length - hoja.getMaxColumns());
  if (hoja.getLastRow() === 0) hoja.appendRow(columnas);
  else {
    var actuales = hoja.getRange(1, 10, 1, 3).getValues()[0];
    for (var i = 0; i < 3; i++) if (actuales[i] && actuales[i] !== columnas[i + 9]) throw new Error('Las columnas J:L del historial ya están ocupadas. Revisa la migración antes de continuar.');
    hoja.getRange(1, 10, 1, 3).setValues([columnas.slice(9)]);
  }
  hoja.getRange(1, 1, 1, 12).setFontWeight('bold').setBackground('#eeeeee');
  return hoja;
}
function rimFilasCotizaciones_() {
  var h = obtenerLibroCentral_().getSheetByName('Historial_Cotizaciones');
  if (!h || h.getLastRow() <= 1) return [];
  var ancho = Math.min(h.getLastColumn(), 12);
  return h.getRange(2, 1, h.getLastRow() - 1, ancho).getValues();
}
function rimDocumentoFila_(f) {
  if (!f[9]) return null;
  try { var d = JSON.parse(f[9]); return d.version === 2 ? d : null; } catch (e) { return null; }
}
function registrarCotizacion(datos, token) {
  var u = rimUsuario_(token);
  if (!datos || typeof datos !== 'object') throw new Error('DATOS_INVALIDOS: Cotización inválida.');
  var requestId = rimRequestId_(datos.requestId), items = rimItems_(datos.items);
  var tasa = Number(datos.tasaBCV);

  var campos = ['cliente','rif','telf','direccion','ciudad'];
  campos.forEach(function(k) { if (!rimTexto_(datos[k], 500)) throw new Error('DATOS_INVALIDOS: Completa los datos del cliente.'); });
  if (['MARACAY','EL TIGRE','BARQUISIMETO'].indexOf(datos.sucursal) === -1) throw new Error('DATOS_INVALIDOS: Sucursal inválida.');
  var subtotal = 0;
  items.forEach(function(it, indice) {
    var tipo=datos.items[indice].precioTipo;
    if(tipo==null && !datos.versionPago)tipo='bcv_mayor';
    if(['bcv_mayor','bcv_detal','div_mayor','div_detal'].indexOf(tipo)<0)throw new Error('DATOS_INVALIDOS: Selecciona el tipo de precio de cada producto.');
    it.precioTipo=tipo;
    it.tiempo_entrega = rimTexto_(datos.items[indice].tiempo_entrega, 200) || 'Por confirmar';
    it.proveedor_cotizado = rimTexto_(datos.items[indice].proveedor_cotizado, 100);
    if (it.precio === null || it.precio < 0 || it.precio > 1000000000) throw new Error('DATOS_INVALIDOS: Precio inválido.');
    it.precio = rimMoneda_(it.precio); it.subtotal = rimMoneda_(it.precio * it.cant); subtotal += it.subtotal;
  });
  subtotal = rimMoneda_(subtotal);
  var hayBCV=items.some(function(it){return it.precioTipo.indexOf('bcv_')===0;});
  if(hayBCV&&(!isFinite(tasa)||tasa<=0||tasa>1000000000))throw new Error('DATOS_INVALIDOS: La tasa BCV no es válida.');
  if(!hayBCV)tasa=null;
  var pago=rimResumenPago_(items,tasa);
  var iva=pago.iva,total=pago.total;
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
    var h = rimHojaCotizaciones_(), filas = rimFilasCotizaciones_(), max = 904;
    for (var i = 0; i < filas.length; i++) {
      if (String(filas[i][10]) === requestId && filas[i][11] === u.email) {
        var anterior = rimDocumentoFila_(filas[i]);
        if (anterior) return anterior;
      }
      var n = Number(filas[i][0]); if (isFinite(n) && n > max) max = n;
    }
    var ahora = new Date(), vence = new Date(ahora);
    // Tres días hábiles: se omiten sábados y domingos. No incluye feriados.
    var restantes = 3;
    while (restantes) { vence.setUTCDate(vence.getUTCDate() + 1); var dia = Number(Utilities.formatDate(vence, 'America/Caracas', 'u')); if (dia <= 5) restantes--; }
    var doc = { version: 2, folio: max + 1, fecha: ahora.toISOString(), fechaVencimiento: vence.toISOString(),
      vendedor: u.nombre, emailVendedor: u.email, sucursal: datos.sucursal, tasaBCV: tasa, porcentajeIVA: 16,
      plazosEntregaGuardados: true, subtotal: subtotal, iva: iva, total: total, pago: pago, ivaBs: pago.bcv.ivaBs, totalBs: pago.bcv.totalBs, items: items };
    campos.forEach(function(k) { doc[k] = rimTexto_(datos[k], 500); });
    var json = JSON.stringify(doc);
    if (json.length > 45000) throw new Error('DATOS_INVALIDOS: La cotización es demasiado extensa para guardarse; divídela en dos documentos.');
    h.appendRow([doc.folio, ahora, rimCelda_(doc.cliente), rimCelda_(doc.rif), rimCelda_(doc.telf), rimCelda_(doc.direccion),
      rimCelda_(doc.ciudad), total, items.map(function(it) { return it.cant + 'x ' + it.item + ' ($' + it.precio.toFixed(2) + ')'; }).join(' | '), json, requestId, u.email]);
    SpreadsheetApp.flush();
    return doc;
  } finally { lock.releaseLock(); }
}
function buscarCotizaciones(filtros, token) {
  rimUsuario_(token);
  filtros = filtros || {};
  var texto = rimTexto_(filtros.texto, 200).toLowerCase(), vendedor = rimTexto_(filtros.vendedor, 100).toLowerCase();
  var desde = /^\d{4}-\d{2}-\d{2}$/.test(filtros.desde || '') ? filtros.desde : '';
  var hasta = /^\d{4}-\d{2}-\d{2}$/.test(filtros.hasta || '') ? filtros.hasta : '';
  var resultado = [];
  var filas = rimFilasCotizaciones_().reverse(), coincidencias = 0;
  filas.forEach(function(f) {
    var doc = rimDocumentoFila_(f), fecha = doc ? doc.fecha : (f[1] instanceof Date ? f[1].toISOString() : '');
    var dia = fecha ? Utilities.formatDate(new Date(fecha), 'America/Caracas', 'yyyy-MM-dd') : '';
    var nombre = doc ? doc.vendedor : '';
    if (texto && (String(f[0]) + ' ' + String(f[2]) + ' ' + nombre).toLowerCase().indexOf(texto) === -1) return;
    if (vendedor && nombre.toLowerCase() !== vendedor) return;
    if (desde && (!dia || dia < desde) || hasta && (!dia || dia > hasta)) return;
    coincidencias++;
    if (resultado.length >= 200) return;
    resultado.push({ folio: f[0], cliente: doc ? doc.cliente : String(f[2] || ''), vendedor: nombre, fecha: fecha,
      total: Number(f[7]) || 0, completa: !!doc, tasaBCV: doc ? doc.tasaBCV : null, modalidadPago: doc&&doc.pago?doc.pago.modo:null, pagoBs:doc&&doc.pago?doc.pago.bcv.totalBs:null, pagoDivisa:doc&&doc.pago?doc.pago.divisa.total:null });
  });
  return { resultados: resultado, coincidencias: coincidencias, limite: 200 };
}
function obtenerCotizacion(folio, token) {
  rimUsuario_(token);
  var filas = rimFilasCotizaciones_();
  for (var i = 0; i < filas.length; i++) if (String(filas[i][0]) === String(folio)) {
    var doc = rimDocumentoFila_(filas[i]);
    if (!doc) throw new Error('Esta cotización antigua no guardó el documento completo. Su tasa y sus datos faltantes no se pueden reconstruir.');
    return doc;
  }
  throw new Error('Cotización no encontrada.');
}
function generarPdfCotizacion(folio, token) {
  var doc = obtenerCotizacion(folio, token);
  var nombre = 'Cotizacion-' + doc.folio + '-' + doc.cliente.replace(/[^a-zA-Z0-9ÁÉÍÓÚÜÑáéíóúüñ _-]/g, '').replace(/\s+/g, '-').slice(0, 65) + '.pdf';
  var blob = Utilities.newBlob(rimHtmlPdf_(doc), 'text/html', 'cotizacion.html').getAs('application/pdf').setName(nombre);
  return { nombre: nombre, base64: Utilities.base64Encode(blob.getBytes()) };
}
// Logo de Ventas proporcionado por el usuario. Solo UrlFetch: no requiere DriveApp.
function rimLogoPdf_() {
  var archivo = '1JD5asoLjlzioE3IIQIUGdLCETv9B0Ag_';
  var cache = CacheService.getScriptCache(), clave = 'rim:pdf:logo:' + archivo;
  var existente = cache.get(clave);
  if (existente && /^data:image\/(png|jpeg|gif);base64,/.test(existente)) return existente;
  var urls = [
    'https://drive.google.com/uc?export=download&id=' + encodeURIComponent(archivo),
    'https://lh3.googleusercontent.com/d/' + encodeURIComponent(archivo) + '=w1000'
  ];
  for (var i=0;i<urls.length;i++) {
    var respuesta;
    try { respuesta = UrlFetchApp.fetch(urls[i], {followRedirects:true,muteHttpExceptions:true}); }
    catch (err) {
      if (/script\.external_request/.test(String(err.message || err))) throw new Error('Falta autorizar las conexiones externas con la cuenta que publica Ventas. Ejecuta autorizarServiciosRIM y concede el permiso solicitado.');
      continue;
    }
    if (respuesta.getResponseCode()!==200) continue;
    var bytes = respuesta.getBlob().getBytes();
    if (!bytes.length || bytes.length>2*1024*1024) continue;
    function b(n){return (Number(bytes[n])+256)%256;}
    var tipo = '';
    if(bytes.length>=8 && b(0)===137 && b(1)===80 && b(2)===78 && b(3)===71 && b(4)===13 && b(5)===10 && b(6)===26 && b(7)===10)tipo='image/png';
    else if(bytes.length>=3 && b(0)===255 && b(1)===216 && b(2)===255)tipo='image/jpeg';
    else if(bytes.length>=6 && b(0)===71 && b(1)===73 && b(2)===70 && b(3)===56 && (b(4)===55||b(4)===57) && b(5)===97)tipo='image/gif';
    if(!tipo)continue; // No incrustar una página de login de Drive como si fuera una imagen.
    var data='data:'+tipo+';base64,'+Utilities.base64Encode(bytes);
    // La caché admite hasta 100 KB por valor. No cachear logos grandes.
    if(data.length<90000){try{cache.put(clave,data,21600);}catch(ignorado){}}
    return data;
  }
  throw new Error('No se pudo cargar el logo del PDF. En Drive, comparte el archivo del logo como Cualquier persona con el enlace: Lector. Debe ser PNG, JPG o GIF y pesar menos de 2 MB. La cotización permanece guardada; puedes reintentar la descarga desde Historial.');
}

// La modalidad procede del tipo de precio, no de una conversión del total completo.
function rimResumenPago_(items,tasa) {
  var bcv=0,divisa=0,hayBCV=false,hayDivisa=false;
  items.forEach(function(it){
    if(it.precioTipo==='div_mayor'||it.precioTipo==='div_detal'){divisa+=Number(it.subtotal);hayDivisa=true;}
    else{bcv+=Number(it.subtotal);hayBCV=true;}
  });
  bcv=rimMoneda_(bcv);divisa=rimMoneda_(divisa);
  var subtotal=rimMoneda_(bcv+divisa),iva=rimMoneda_(subtotal*0.16),ivaBCV=hayBCV?rimMoneda_(bcv*0.16):0;
  // El residuo de redondeo queda en divisa para conservar exactamente IVA=16% del subtotal.
  var ivaDivisa=rimMoneda_(iva-ivaBCV),totalBCV=rimMoneda_(bcv+ivaBCV),totalDivisa=rimMoneda_(divisa+ivaDivisa);
  return {version:1,modo:hayBCV&&hayDivisa?'mixto':hayDivisa?'divisa':'bcv',subtotal:subtotal,iva:iva,total:rimMoneda_(subtotal+iva),
    bcv:{subtotal:bcv,iva:ivaBCV,total:totalBCV,ivaBs:hayBCV?rimMoneda_(ivaBCV*tasa):null,totalBs:hayBCV?rimMoneda_(totalBCV*tasa):null},
    divisa:{subtotal:divisa,iva:ivaDivisa,total:totalDivisa}};
}
function rimPagoDocumento_(d) {
  if(d.pago&&d.pago.version===1)return d.pago;
  // No reinterpretar precios históricos: antes no se guardaba su modalidad.
  return {version:0,modo:'bcv',subtotal:d.subtotal,iva:d.iva,total:d.total,
    bcv:{subtotal:d.subtotal,iva:d.iva,total:d.total,ivaBs:d.ivaBs,totalBs:d.totalBs},divisa:{subtotal:0,iva:0,total:0}};
}

function rimHtmlPdf_(d) {
  function e(v) { return rimEscape_(v); }
  function usd(v) { return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function bs(v) { return 'Bs. ' + Number(v).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fecha(v) { return Utilities.formatDate(new Date(v), 'America/Caracas', 'dd/MM/yyyy'); }
  var logo=rimLogoPdf_(),pago=rimPagoDocumento_(d),divisa=pago.modo==='divisa',mixto=pago.modo==='mixto';
  var hoy = Utilities.formatDate(new Date(), 'America/Caracas', 'yyyy-MM-dd');
  var filas=d.items.map(function(it){
    var plazo = rimFechaEntrega_(it.tiempo_entrega || (d.plazosEntregaGuardados ? 'Por confirmar' : 'Sin plazo registrado'), hoy);
    var detalle=[it.marca ? 'Marca ' + it.marca : '', mixto ? (it.precioTipo&&it.precioTipo.indexOf('div_')===0?'Divisa':'BCV') : ''];
    return '<tr><td class="producto"><strong>'+e(it.item)+'</strong><div class="detalle-producto">'+detalle.filter(Boolean).map(e).join(' · ')+'</div><div class="detalle-producto"><b>Disponibilidad:</b> '+e(plazo)+'</div></td><td class="num">'+usd(it.precio)+'</td><td class="num">'+it.cant+'</td><td class="num subtotal">'+usd(it.subtotal)+'</td></tr>';
  }).join('');
  var nota='Las fechas indicadas son estimadas. Confirmamos la disponibilidad y la entrega al formalizar el pedido.';
  if(divisa)nota+=' Pago en divisas o transferencia en USD.';
  else nota+=' Tasa BCV: '+bs(d.tasaBCV)+' / USD.'+(mixto?' Aplica solo a los precios BCV; la parte divisa se paga en USD.':'');
  var totalDerecha=mixto?pago.divisa.total:pago.total,ivaDerecha=mixto?pago.divisa.iva:pago.iva;
  var resumen=(mixto?'<tr class="cab-pago"><td>BCV · Bolívares</td><td class="num">Divisa · USD</td></tr>':'')+
    '<tr><td>IVA ('+e(d.porcentajeIVA)+' %)'+(!divisa?'<div class="bs">'+bs(pago.bcv.ivaBs)+'</div>':'')+'</td><td class="num">'+usd(ivaDerecha)+'</td></tr>'+
    '<tr class="fila-total"><td>Total'+(!divisa?'<div class="bs">'+bs(pago.bcv.totalBs)+'</div>':'')+'</td><td class="num">'+usd(totalDerecha)+'</td></tr>';
  var css='@page{size:letter;margin:14mm 15mm}*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}body{font-family:Arial,Helvetica,sans-serif;color:#292929;font-size:10.5px;line-height:1.3;margin:0}table{width:100%;border-collapse:collapse}td,th{vertical-align:top}.num{text-align:right!important;white-space:nowrap}'+
    '.cabecera{margin-bottom:10px}.cabecera td{padding:0}.logo{display:block;max-width:170px;max-height:58px;width:auto;height:auto;margin-bottom:4px}.empresa{font-size:10px;font-weight:bold;margin:2px 0}.contacto{font-size:8.5px;color:#666;line-height:1.35}.documento{width:154px;border:1px solid #c8c8c8;text-align:center}.documento-titulo{background:#dedede;font-size:10px;font-weight:bold;letter-spacing:1px;padding:6px}.folio{font-size:20px;font-weight:bold;padding:9px 6px}'+
    '.datos{table-layout:fixed;border:1px solid #ccc;margin-bottom:11px}.datos td{border:1px solid #d4d4d4;padding:4px 6px;font-size:9.5px;overflow-wrap:anywhere}.etiqueta{background:#e8e8e8;font-size:8px!important;font-weight:bold;text-transform:uppercase}.items{table-layout:fixed}.items th{padding:7px 6px;background:#dedede;border-top:1px solid #c8c8c8;border-bottom:1px solid #c8c8c8;text-align:left;font-size:9px;font-weight:bold}.items td{padding:7px 6px;border-bottom:1px solid #e3e3e3;font-size:10px}.producto strong{font-size:10.5px}.detalle-producto{font-size:9px;color:#666;margin-top:2px;line-height:1.25}.subtotal{font-weight:bold}'+
    '.cierre{margin-top:12px;page-break-inside:avoid;break-inside:avoid}.notas{width:58%;padding:3px 20px 0 0;font-size:8.5px;line-height:1.5;color:#737373}.importes{width:42%}.totales td{padding:6px 7px;font-size:11px}.totales .bs{font-size:9px;color:#555;margin-top:2px}.fila-total{background:#e7e7e7;border-top:1px solid #bbb}.fila-total td{font-weight:bold;font-size:15px}.fila-total .bs{font-size:10px;font-weight:normal}.cab-pago td{font-size:8px;font-weight:bold;color:#666;border-bottom:1px solid #ddd;padding-top:0;padding-bottom:5px}thead{display:table-header-group}tr{page-break-inside:avoid;break-inside:avoid}';
  return '<!doctype html><html lang="es"><head><meta charset="UTF-8"><title>Cotizacion-'+e(d.folio)+'-'+e(d.cliente)+'</title><style>'+css+'</style></head><body>'+
    '<table class="cabecera"><tr><td><img class="logo" src="'+logo+'" alt="Logo Rodaindustria"><div class="empresa">Rodaindustria Maracay C.A.</div><div class="contacto">RIF J-506468042 · 04243358415<br>www.rodaindustriamaracay.com</div></td><td style="width:154px"><div class="documento"><div class="documento-titulo">COTIZACIÓN</div><div class="folio">No. '+e(d.folio)+'</div></div></td></tr></table>'+
    '<table class="datos"><colgroup><col style="width:12%"><col style="width:43%"><col style="width:24%"><col style="width:21%"></colgroup>'+
    '<tr><td class="etiqueta">Señor(es)</td><td><strong>'+e(d.cliente)+'</strong></td><td class="etiqueta">Fecha de emisión</td><td>'+fecha(d.fecha)+'</td></tr>'+
    '<tr><td class="etiqueta">Dirección</td><td>'+e(d.direccion)+(d.ciudad?', '+e(d.ciudad):'')+'</td><td class="etiqueta">Vencimiento</td><td>'+fecha(d.fechaVencimiento)+'</td></tr>'+
    '<tr><td class="etiqueta">Teléfono</td><td>'+e(d.telf)+'</td><td class="etiqueta">RIF / C.I.</td><td>'+e(d.rif)+'</td></tr></table>'+
    '<table class="items"><colgroup><col style="width:47%"><col style="width:19%"><col style="width:12%"><col style="width:22%"></colgroup><thead><tr><th>Producto</th><th class="num">Precio unit.</th><th class="num">Cant.</th><th class="num">Subtotal</th></tr></thead><tbody>'+filas+'</tbody></table>'+
    '<table class="cierre"><tr><td class="notas">'+e(nota)+'</td><td class="importes"><table class="totales">'+resumen+'</table></td></tr></table></body></html>';
}

// Prueba opcional desde el editor. No registra la imagen ni credenciales.
function comprobarLogoCotizacion() {
  var logo = rimLogoPdf_();
  Logger.log('Logo listo para el PDF (' + logo.substring(5, logo.indexOf(';')) + ').');
}

// También se incluye en Index para que ambos formatos usen las mismas reglas.
function rimFechaEntrega_(plazo, hoy, paraWhatsApp) {
  var original = String(plazo == null ? '' : plazo).replace(/\s+/g, ' ').trim() || 'Por confirmar';
  var texto = original.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  var importacion = /\bimportacion\b/.test(texto);
  var local = /\b(local|nacional)\b/.test(texto);
  var duracion = texto.replace(/\b(?:(?:bajo|por|de|en)\s+)?importacion\b|\b(?:despacho|entrega)(?:\s+(?:local|nacional))?\b|\b(local|nacional)\b/g, '')
    .replace(/[():]/g, ' ').replace(/\s+/g, ' ').trim();
  var rango = duracion.match(/^(?:(?:en|a|de)\s+)?(\d+)(?:\s+dias?)?(?:\s*(?:a|[-–—])\s*(\d+)\s*(?:dias?)?)?(?:\s+(habil(?:es)?|laborables?|calendario|continuos?|corridos?))?\.?$/);
  var desde, hasta, habiles = false;
  if (rango) {
    desde = Number(rango[1]);
    hasta = rango[2] == null ? desde : Number(rango[2]);
    habiles = /^(habil|laborable)/.test(rango[3] || '');
    if (hasta < desde || hasta > 3650) return original;
  } else if (/^(hoy|inmediat[oa]|mismo dia)\.?$/.test(duracion)) {
    desde = hasta = 0;
  } else if (/^manana\.?$/.test(duracion)) {
    desde = hasta = 1;
  } else {
    return original;
  }
  // Los plazos de cinco días o más se cotizan como importación, salvo indicación local.
  importacion = importacion || (!local && desde >= 5);
  if (!importacion && hasta === 0) return 'Entrega inmediata';
  var tolerancia = importacion && desde >= 5 ? (hasta >= 30 ? 10 : 2) : 0;
  var base = new Date(hoy + 'T00:00:00Z');
  if (!Number.isFinite(base.getTime())) return original;
  var meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

  function fecha(offset) {
    var d = new Date(base.getTime());
    if (!habiles) d.setUTCDate(d.getUTCDate() + offset);
    while (habiles && offset) {
      d.setUTCDate(d.getUTCDate() + 1);
      if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) offset--;
    }
    return d;
  }

  var inicio = fecha(desde), fin = fecha(hasta + tolerancia);
  var mismoAno = inicio.getUTCFullYear() === fin.getUTCFullYear();
  var mismoMes = mismoAno && inicio.getUTCMonth() === fin.getUTCMonth();
  var fechaFin = fin.getUTCDate() + ' ' + meses[fin.getUTCMonth()] + ' ' + fin.getUTCFullYear();
  var ventana = fechaFin;
  if (desde !== hasta + tolerancia) {
    var fechaInicio = String(inicio.getUTCDate());
    if (!mismoMes) fechaInicio += ' ' + meses[inicio.getUTCMonth()];
    if (!mismoAno) fechaInicio += ' ' + inicio.getUTCFullYear();
    ventana = fechaInicio + ' – ' + fechaFin;
  }
  if (importacion) return 'Bajo importación (' + ventana + ')';
  if (paraWhatsApp && desde === hasta && inicio.getTime() - base.getTime() === 86400000) {
    return 'Entrega Mañana (' + fechaFin + ')';
  }
  return (desde === hasta ? 'Entrega estimada el ' : 'Entrega estimada entre ') + ventana;
}
