// PROCESO PAM · Aplicación independiente, conectada al libro central.
// Primera versión de prueba. Todas las escrituras se limitan a pestañas PAM_.
// La publicación real en Productos y los envíos a Kommo se habilitarán después.
var PAM_LIBRO_ID_ = '1qzuGTk_Jvof6OTY2_WPiBjdpITWfeCibv0HNihKGCTA';
var PAM_COLUMNAS_ = [
  'ID_PAM','ID_LEAD_KOMMO','FECHA_CREACION','ASESORA','CLIENTE','TELEFONO','ULTIMOS_4','PRIORIDAD',
  'ITEM_SOLICITADO','CANTIDAD','PROVEEDOR_COSTO','PRECIO_MAYOR_BCV','PRECIO_MAYOR_DIV','ETAPA_PAM',
  'CODIGO_MAESTRO','EMBUDO_ORIGEN','PIPELINE_ID','NOTA_PROCURA',
  'VERSION','FECHA_ACTUALIZACION','CLAVE_CREACION','ULTIMA_OPERACION','PROVEEDOR','COSTO_BASE',
  'PLAZO_ENTREGA','MARCA','CODIGO_PROVEEDOR','PRECIO_DETAL_BCV','PRECIO_DETAL_DIV','DESCRIPCION',
  'MEDIDA_INTERNA','MEDIDA_EXTERNA','ANCHO','OTRAS_REFERENCIAS','KOMMO_ESTADO','CONTACTO_ID',
  'RESPONSABLE_KOMMO_ID','ESTADO_KOMMO_ID','ORIGEN','PLAZO_MARACAY','PLAZO_EL_TIGRE','PLAZO_BARQUISIMETO','CONFIRMACION_VENTAS','FECHA_CONFIRMACION','FECHA_TOMA_PROCURA'
];
var PAM_HOJAS_ = {
  solicitudes: ['PAM_Solicitudes', PAM_COLUMNAS_],
  catalogo: ['PAM_Catalogo_Prueba', [
    'ITEM','MARCA','MEDIDA_INTERNA','MEDIDA_EXTERNA','ANCHO','OTRAS_REFERENCIAS','DESCRIPCION',
    'ALMACEN_MARACAY','ALMACEN_EL_TIGRE','ALMACEN_BARQUISIMETO',
    'PRECIO_MAYOR_BCV','PRECIO_MAYOR_DIV','PRECIO_DETAL_BCV','PRECIO_DETAL_DIV',
    'CODIGO_PROVEEDOR','ORIGINAL','ID_PAM','OPERACION','FECHA_PUBLICACION'
  ]],
  eventos: ['PAM_Eventos', ['OPERACION','FECHA','ID_PAM','ACCION','ETAPA_ANTERIOR','ETAPA_NUEVA','AUTOR']],
  operaciones: ['PAM_Operaciones', ['OPERACION','TIPO','ID_PAM','FECHA','ESTADO','SOLICITUD_JSON','RESULTADO_JSON','AUTOR']]
};

function doGet() {
  return HtmlService.createHtmlOutputFromFile('PAM')
    .setTitle('Proceso PAM · Rodaindustria Maracay')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function pamLibro_() {
  var id = PropertiesService.getScriptProperties().getProperty('PAM_SPREADSHEET_ID') || PAM_LIBRO_ID_;
  return SpreadsheetApp.openById(id);
}

function pamConBloqueo_(trabajo) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return trabajo(); } finally { lock.releaseLock(); }
}

function pamTexto_(valor, max) {
  return String(valor == null ? '' : valor).trim().slice(0, max || 500);
}

// Los apóstrofos protegen datos pegados contra su interpretación como fórmulas.
function pamCelda_(valor) {
  return typeof valor === 'string' && /^[=+@\-]/.test(valor) ? "'" + valor : valor;
}

function pamLeerCelda_(valor) {
  return typeof valor === 'string' && /^'[=+@\-]/.test(valor) ? valor.slice(1) : valor;
}

function pamFilas_(hoja, ancho) {
  return hoja.getLastRow() > 1 ? hoja.getRange(2, 1, hoja.getLastRow() - 1, ancho).getValues() : [];
}

function pamAsegurarHoja_(libro, tipo) {
  var esquema = PAM_HOJAS_[tipo];
  if (!esquema || esquema[0].indexOf('PAM_') !== 0) throw new Error('Pestaña PAM no reconocida.');
  var hoja = libro.getSheetByName(esquema[0]);
  if (!hoja) hoja = libro.insertSheet(esquema[0]);
  var columnas = esquema[1];
  if (hoja.getMaxColumns() < columnas.length) {
    hoja.insertColumnsAfter(hoja.getMaxColumns(), columnas.length - hoja.getMaxColumns());
  }
  if (hoja.getLastRow() === 0) {
    hoja.getRange(1, 1, 1, columnas.length).setValues([columnas]);
    hoja.setFrozenRows(1);
    hoja.getRange(1, 1, 1, columnas.length).setFontWeight('bold').setBackground('#e8eff4');
  } else {
    var existentes = hoja.getRange(1, 1, 1, Math.max(hoja.getLastColumn(), columnas.length)).getValues()[0];
    var longitud = existentes.length;
    while (longitud && existentes[longitud - 1] === '') longitud--;
    // Reconocer el esquema inicial de 18 columnas sin mover sus datos.
    if (longitud > columnas.length || (tipo === 'solicitudes' && longitud < 18)) {
      throw new Error('Estructura distinta en ' + esquema[0] + '. Revisa los encabezados antes de continuar.');
    }
    for (var i = 0; i < longitud; i++) {
      if (existentes[i] !== columnas[i]) throw new Error('Encabezado incompatible en ' + esquema[0] + ', columna ' + (i + 1) + '.');
    }
    if (longitud < columnas.length) {
      hoja.getRange(1, longitud + 1, 1, columnas.length - longitud).setValues([columnas.slice(longitud)]);
    }
  }
  return hoja;
}

function pamPreparar_(libro) {
  var hojas = {};
  Object.keys(PAM_HOJAS_).forEach(function(tipo) { hojas[tipo] = pamAsegurarHoja_(libro, tipo); });
  return hojas;
}

// Ejecutar una vez desde el editor para autorizar y crear las cuatro pestañas PAM.
function inicializarProcesoPAM() {
  return pamConBloqueo_(function() {
    var libro = pamLibro_();
    pamPreparar_(libro);
    return { exito: true, modo: 'PRUEBA', pestañas: Object.keys(PAM_HOJAS_).map(function(k) { return PAM_HOJAS_[k][0]; }) };
  });
}

function pamObjeto_(fila) {
  var objeto = {};
  PAM_COLUMNAS_.forEach(function(c, i) { objeto[c] = pamLeerCelda_(fila[i] == null ? '' : fila[i]); });
  objeto.VERSION = Number(objeto.VERSION) || 0;
  // Compatibilidad con el formato proveedor | costo de la maqueta.
  var previo = String(objeto.PROVEEDOR_COSTO || '').split('|');
  if (!objeto.PROVEEDOR) objeto.PROVEEDOR = previo[0].trim();
  if (!objeto.COSTO_BASE && previo.length > 1) objeto.COSTO_BASE = Number(previo[1].trim()) || 0;
  return objeto;
}

function pamFilaObjeto_(objeto) {
  return PAM_COLUMNAS_.map(function(c) { return pamCelda_(objeto[c] == null ? '' : objeto[c]); });
}

function pamPublico_(o) {
  function fecha(valor) {
    if (!valor) return '';
    var d = valor instanceof Date ? valor : new Date(valor);
    return isFinite(d.getTime()) ? Utilities.formatDate(d, 'America/Caracas', 'dd/MM/yyyy HH:mm') : String(valor);
  }
  return {
    id: o.ID_PAM, lead_id: String(o.ID_LEAD_KOMMO || ''), fecha: fecha(o.FECHA_CREACION),
    actualizado: fecha(o.FECHA_ACTUALIZACION), asesora: o.ASESORA, cliente: o.CLIENTE,
    telefono: String(o.TELEFONO || ''), ultimos_4: String(o.ULTIMOS_4 || ''),
    prioridad: o.PRIORIDAD || 'NORMAL', item: o.ITEM_SOLICITADO, cant: Number(o.CANTIDAD) || 1,
    proveedor: o.PROVEEDOR, costo: Number(o.COSTO_BASE) || 0, plazo: o.PLAZO_ENTREGA,
    precio_bcv: Number(o.PRECIO_MAYOR_BCV) || 0, precio_div: Number(o.PRECIO_MAYOR_DIV) || 0,
    detal_bcv: Number(o.PRECIO_DETAL_BCV) || 0, detal_div: Number(o.PRECIO_DETAL_DIV) || 0,
    plazos: { maracay: o.PLAZO_MARACAY || '', el_tigre: o.PLAZO_EL_TIGRE || '', barquisimeto: o.PLAZO_BARQUISIMETO || '' },
    etapa: o.ETAPA_PAM || 'POR_UBICAR', codigo_maestro: o.CODIGO_MAESTRO, marca: o.MARCA,
    prv: o.CODIGO_PROVEEDOR, descripcion: o.DESCRIPCION, interna: o.MEDIDA_INTERNA,
    externa: o.MEDIDA_EXTERNA, ancho: o.ANCHO, referencias: o.OTRAS_REFERENCIAS,
    embudo_origen: o.EMBUDO_ORIGEN, pipeline_id: String(o.PIPELINE_ID || ''),
    contacto_id: String(o.CONTACTO_ID || ''), responsable_kommo_id: String(o.RESPONSABLE_KOMMO_ID || ''),
    estado_kommo_id: String(o.ESTADO_KOMMO_ID || ''), nota: o.NOTA_PROCURA,
    version: o.VERSION, kommo_estado: o.KOMMO_ESTADO || 'SIN_CONEXION',
    grupo: String(o.PIPELINE_ID || o.EMBUDO_ORIGEN || o.ASESORA || 'SIN_EMBUDO'),
    estado_cliente: o.KOMMO_ESTADO === 'DEMO_DISPONIBLE' ? 'Ya disponible (simulado)' : 'PAM (simulado)',
    confirmado: !!o.CONFIRMACION_VENTAS, fecha_confirmacion: fecha(o.FECHA_CONFIRMACION),
    drd_etapa: o.KOMMO_ESTADO === 'DEMO_DISPONIBLE' ? 'YA_DISPONIBLE' :
      (o.FECHA_TOMA_PROCURA || o.ETAPA_PAM === 'EN_DATA' || o.ETAPA_PAM === 'DISPONIBLE' ? 'PROCESANDO' : 'PAM')
  };
}

function obtenerDatosTableroPAM(rol, embudoDemo) {
  var perfil = pamPerfilDemo_(rol);
  return pamConBloqueo_(function() {
    var hojas = pamPreparar_(pamLibro_());
    var lista = pamFilas_(hojas.solicitudes, PAM_COLUMNAS_.length).filter(function(f) { return f[0]; })
      .map(function(f) { return pamPublico_(pamObjeto_(f)); }).reverse();
    var publicados = pamFilas_(hojas.catalogo, 19);
    lista.forEach(function(p) {
      var fila = publicados.find(function(f) { return String(f[16]) === p.id; });
      if (fila) {
        p.detal_bcv = typeof fila[12] === 'number' && isFinite(fila[12]) ? fila[12] : null;
        p.detal_div = typeof fila[13] === 'number' && isFinite(fila[13]) ? fila[13] : null;
      }
    });
    var pendientes = pamFilas_(hojas.operaciones, 8).filter(function(f) { return f[4] === 'PENDIENTE'; })
      .map(function(f) { return { operacion: f[0], id: f[2], tipo: f[1] }; });
    if (!perfil.interno) {
      var embudo = pamEmbudoDemo_(embudoDemo || PAM_EMBUDOS_DEMO_[0].id);
      lista = lista.filter(function(p) { return String(p.embudo_origen || p.asesora).toUpperCase() === embudo.nombre; }).map(pamComercial_);
      var ids = new Set(lista.map(function(p) { return p.id; }));
      pendientes = pendientes.filter(function(p) { return ids.has(p.id) && (p.tipo === 'SOLICITUD' || p.tipo === 'CONFIRMAR_DRD'); });
    }
    return {
      exito: true, modo: 'PRUEBA', kommo_conectado: false, perfil: perfil,
      embudos: PAM_EMBUDOS_DEMO_, lista: lista, pendientes: pendientes,
      asesoras: Array.from(new Set(lista.map(function(p) { return p.asesora; }).filter(Boolean))).sort(),
      proveedores: perfil.interno ? pamLeerProveedores_(pamLibro_()) : []
    };
  });
}

function pamNumero_(valor, etiqueta, permitirCero, opcional) {
  if (opcional && (valor == null || String(valor).trim() === '')) return '';
  if (valor == null || String(valor).trim() === '') throw new Error('Completa ' + etiqueta + '.');
  var n = Number(valor);
  if (!isFinite(n) || n > 1000000000 || (permitirCero ? n < 0 : n <= 0)) {
    throw new Error('Valor inválido en ' + etiqueta + '.');
  }
  return n;
}

function pamRequerido_(valor, etiqueta, max) {
  var texto = pamTexto_(valor, max);
  if (!texto) throw new Error('Completa ' + etiqueta + '.');
  return texto;
}

function pamIdKommo_(valor) {
  var id = pamTexto_(valor, 30);
  if (id && !/^[1-9][0-9]{0,19}$/.test(id)) throw new Error('El ID de Kommo debe ser un número entero positivo.');
  return id;
}

function pamBuscar_(hoja, id) {
  var filas = pamFilas_(hoja, PAM_COLUMNAS_.length);
  for (var i = 0; i < filas.length; i++) {
    if (String(filas[i][0]) === id) return { fila: i + 2, objeto: pamObjeto_(filas[i]) };
  }
  return null;
}

function pamAplicarOperacion_(hojas, filaOperacion, operacion) {
  var plan = JSON.parse(operacion[5]), objeto = plan.objeto;
  var actual = pamBuscar_(hojas.solicitudes, objeto.ID_PAM);
  if (actual && actual.objeto.ULTIMA_OPERACION !== operacion[0] && actual.objeto.VERSION !== plan.versionAnterior) {
    throw new Error('El registro cambió. Revisa la operación pendiente antes de continuar.');
  }
  if (plan.catalogo) {
    var catalogo = pamFilas_(hojas.catalogo, 19);
    var propio = catalogo.findIndex(function(f) { return String(f[16]) === objeto.ID_PAM; });
    // Compatibilidad con envíos pendientes de la primera prueba.
    var filaDestino = propio >= 0 ? propio + 2 : (plan.filaCatalogo || pamSiguienteFilaCatalogo_(hojas));
    var conflicto = catalogo.findIndex(function(f, i) {
      return String(pamLeerCelda_(f[0])).trim().toUpperCase() === objeto.CODIGO_MAESTRO &&
        String(f[16]) !== objeto.ID_PAM && i + 2 !== filaDestino;
    });
    if (conflicto >= 0) throw new Error('Ese código ya existe en el catálogo PAM de prueba para otra solicitud.');
    var existente = catalogo[filaDestino - 2];
    if (existente && existente[17] && String(existente[17]) !== operacion[0]) {
      throw new Error('La fila de catálogo corresponde a otra publicación.');
    }
    // M:N son columnas calculadas. No escribir ni valores ni vacíos sobre sus resultados.
    hojas.catalogo.getRange(filaDestino, 1, 1, 12).setValues([plan.catalogo.slice(0, 12).map(pamCelda_)]);
    hojas.catalogo.getRange(filaDestino, 15, 1, 5).setValues([plan.catalogo.slice(14).map(pamCelda_)]);
    SpreadsheetApp.flush();
    var formulas = pamFormulasDetal_(pamLibro_());
    pamAplicarDetal_(hojas.catalogo, filaDestino, formulas);
    SpreadsheetApp.flush();
    var detalle = hojas.catalogo.getRange(filaDestino, 13, 1, 2).getValues()[0];
    if (detalle.some(function(n) { return typeof n !== 'number' || !isFinite(n) || n <= 0; })) {
      throw new Error('La fórmula de detal no devolvió dos precios positivos. Revisa las columnas M:N de PAM_Catalogo_Prueba y reintenta el envío.');
    }
    objeto.PRECIO_DETAL_BCV = detalle[0];
    objeto.PRECIO_DETAL_DIV = detalle[1];
  }
  if (!actual || actual.objeto.ULTIMA_OPERACION !== operacion[0]) {
    var fila = actual ? actual.fila : hojas.solicitudes.getLastRow() + 1;
    hojas.solicitudes.getRange(fila, 1, 1, PAM_COLUMNAS_.length).setValues([pamFilaObjeto_(objeto)]);
    SpreadsheetApp.flush();
  }
  var eventos = pamFilas_(hojas.eventos, 7);
  if (!eventos.some(function(f) { return f[0] === operacion[0]; })) {
    hojas.eventos.getRange(hojas.eventos.getLastRow() + 1, 1, 1, 7).setValues([[
      operacion[0], objeto.FECHA_ACTUALIZACION, objeto.ID_PAM, operacion[1],
      plan.etapaAnterior, objeto.ETAPA_PAM, pamCelda_(operacion[7])
    ]]);
    SpreadsheetApp.flush();
  }
  var respuesta = { exito: true, id: objeto.ID_PAM, modo: 'PRUEBA' };
  hojas.operaciones.getRange(filaOperacion, 5, 1, 3).setValues([['CONFIRMADO', operacion[5], JSON.stringify(respuesta)]]);
  SpreadsheetApp.flush();
  return respuesta;
}

function pamGuardar_(tipo, datos, rol) {
  var perfil = pamExigirDemo_(rol, (tipo === 'PROCURA' || tipo === 'TOMAR_PAM') ? 'procura' : tipo === 'PUBLICAR_PRUEBA' ? 'data' : null);
  return pamConBloqueo_(function() {
    datos = datos || {};
    var opId = pamRequerido_(datos.operacion, 'identificador de operación', 100);
    if (!/^[a-zA-Z0-9_-]{20,100}$/.test(opId)) throw new Error('Identificador de operación inválido.');
    var hojas = pamPreparar_(pamLibro_());
    var operaciones = pamFilas_(hojas.operaciones, 8);
    var indice = operaciones.findIndex(function(f) { return f[0] === opId; });
    if (indice >= 0) {
      var anterior = operaciones[indice], planAnterior = JSON.parse(anterior[5]);
      if (!perfil.interno && planAnterior.objeto) pamEsMiEmbudoDemo_(planAnterior.objeto, datos);
      if (anterior[1] !== tipo || JSON.stringify(planAnterior.entrada) !== JSON.stringify(datos)) {
        throw new Error('Ese identificador ya corresponde a otro envío.');
      }
      if (anterior[4] === 'CONFIRMADO') return JSON.parse(anterior[6] || JSON.stringify({ exito: true, id: anterior[2] }));
      return pamAplicarOperacion_(hojas, indice + 2, anterior);
    }
    var existente = datos.id ? pamBuscar_(hojas.solicitudes, pamTexto_(datos.id, 100)) : null;
    if (datos.id && !existente) throw new Error('Solicitud PAM no encontrada.');
    if (tipo !== 'SOLICITUD' && !existente) throw new Error('Selecciona una solicitud.');
    if (existente && Number(datos.version) !== existente.objeto.VERSION) {
      throw new Error('La solicitud cambió en otra ventana. Actualiza el tablero y vuelve a abrirla.');
    }
    if (existente && operaciones.some(function(f) { return f[2] === existente.objeto.ID_PAM && f[4] === 'PENDIENTE'; })) {
      throw new Error('Esta solicitud tiene un envío pendiente. Reinténtalo primero.');
    }
    var o = existente ? existente.objeto : {};
    var etapaAnterior = o.ETAPA_PAM || '';
    if (tipo === 'SOLICITUD') {
      if (existente && etapaAnterior !== 'POR_UBICAR') throw new Error('Solo se puede editar la solicitud inicial antes de pasar a Data.');
      if (existente && perfil.rol === 'ventas') pamEsMiEmbudoDemo_(o, datos);
      pamAsignacionDemo_(o, datos);
      o.CONFIRMACION_VENTAS = '';
      o.FECHA_CONFIRMACION = '';
      o.CLIENTE = pamRequerido_(datos.cliente, 'cliente', 200);
      o.ITEM_SOLICITADO = pamRequerido_(datos.item, 'producto solicitado', 1000);
      o.CANTIDAD = pamNumero_(datos.cant, 'cantidad', false);
      if (!Number.isInteger(o.CANTIDAD)) throw new Error('La cantidad debe ser un número entero.');
      o.TELEFONO = pamTexto_(datos.telefono, 50);
      o.ULTIMOS_4 = o.TELEFONO.replace(/[^0-9]/g, '').slice(-4);
      o.PRIORIDAD = datos.prioridad === 'VIP' ? 'VIP' : 'NORMAL';
      o.ID_LEAD_KOMMO = pamIdKommo_(datos.lead_id);
      o.PIPELINE_ID = pamIdKommo_(datos.pipeline_id);
      o.CONTACTO_ID = pamIdKommo_(datos.contacto_id);
      o.RESPONSABLE_KOMMO_ID = pamIdKommo_(datos.responsable_kommo_id);
      o.ESTADO_KOMMO_ID = pamIdKommo_(datos.estado_kommo_id);
      // El nombre del embudo procede de la fuente de la demo, nunca de un texto libre.
      o.ETAPA_PAM = 'POR_UBICAR';
      o.ORIGEN = 'DEMO';
    } else if (tipo === 'CONFIRMAR_DRD') {
      if (perfil.rol === 'ventas') pamEsMiEmbudoDemo_(o, datos);
      o.CONFIRMACION_VENTAS = 'CONFIRMADO';
      o.FECHA_CONFIRMACION = new Date().toISOString();
    } else if (tipo === 'TOMAR_PAM') {
      if (etapaAnterior !== 'POR_UBICAR') throw new Error('La solicitud ya pasó a Data.');
      o.FECHA_TOMA_PROCURA = o.FECHA_TOMA_PROCURA || new Date().toISOString();
    } else if (tipo === 'PROCURA') {
      if (etapaAnterior !== 'POR_UBICAR' && etapaAnterior !== 'EN_DATA') throw new Error('La solicitud ya está publicada en prueba.');
      o.ITEM_SOLICITADO = pamRequerido_(datos.item, 'producto solicitado', 1000);
      pamAsignarProveedor_(o, pamProveedor_(pamLibro_(), datos.proveedor_codigo));
      o.COSTO_BASE = pamNumero_(datos.costo, 'costo base', false);
      o.PROVEEDOR_COSTO = o.PROVEEDOR + ' | ' + o.COSTO_BASE;
      o.NOTA_PROCURA = pamTexto_(datos.nota, 2000);
      o.FECHA_TOMA_PROCURA = o.FECHA_TOMA_PROCURA || new Date().toISOString();
      o.ETAPA_PAM = 'EN_DATA';
    } else if (tipo === 'PUBLICAR_PRUEBA') {
      if (etapaAnterior !== 'EN_DATA') throw new Error('Procura debe registrar la cotización antes de publicar.');
      o.CODIGO_MAESTRO = pamRequerido_(datos.codigo_maestro, 'código de catálogo', 200).toUpperCase();
      o.MARCA = pamRequerido_(datos.marca, 'marca', 100).toUpperCase();
      // La identidad del proveedor la valida el servidor con el directorio de Compras.
      pamAsignarProveedor_(o, pamProveedor_(pamLibro_(), o.CODIGO_PROVEEDOR, o.PROVEEDOR));
      o.PRECIO_MAYOR_BCV = pamNumero_(datos.precio_bcv, 'precio mayor BCV', false);
      o.PRECIO_MAYOR_DIV = pamNumero_(datos.precio_div, 'precio mayor divisa', false);
      o.PRECIO_DETAL_BCV = '';
      o.PRECIO_DETAL_DIV = '';
      o.DESCRIPCION = pamRequerido_(datos.descripcion, 'descripción', 1000);
      o.MEDIDA_INTERNA = pamNumero_(datos.interna, 'medida interna', true, true);
      o.MEDIDA_EXTERNA = pamNumero_(datos.externa, 'medida externa', true, true);
      o.ANCHO = pamNumero_(datos.ancho, 'ancho', true, true);
      o.OTRAS_REFERENCIAS = pamTexto_(datos.referencias, 500);
      var conflicto = pamFilas_(hojas.catalogo, 19).some(function(f) {
        return String(pamLeerCelda_(f[0])).trim().toUpperCase() === o.CODIGO_MAESTRO && String(f[16]) !== o.ID_PAM;
      });
      if (conflicto) throw new Error('Ese código ya existe en el catálogo PAM de prueba. Revisa la solicitud antes de publicar.');
      o.ETAPA_PAM = 'DISPONIBLE';
    } else { throw new Error('Acción no reconocida.'); }
    if (!existente) {
      o.ID_PAM = 'PAM-' + Utilities.getUuid().replace(/-/g, '').slice(0, 12).toUpperCase();
      o.FECHA_CREACION = new Date().toISOString();
      o.CLAVE_CREACION = opId;
    }
    var versionAnterior = Number(o.VERSION) || 0;
    o.VERSION = versionAnterior + 1;
    o.FECHA_ACTUALIZACION = new Date().toISOString();
    o.ULTIMA_OPERACION = opId;
    o.KOMMO_ESTADO = o.KOMMO_ESTADO || 'DEMO_PAM';
    var formulas = tipo === 'PUBLICAR_PRUEBA' ? pamFormulasDetal_(pamLibro_()) : null;
    var filaCatalogo = formulas ? pamSiguienteFilaCatalogo_(hojas) : null;
    var catalogo = tipo === 'PUBLICAR_PRUEBA' ? [
      o.CODIGO_MAESTRO,o.MARCA,o.MEDIDA_INTERNA,o.MEDIDA_EXTERNA,o.ANCHO,o.OTRAS_REFERENCIAS,o.DESCRIPCION,
      0,0,0,o.PRECIO_MAYOR_BCV,o.PRECIO_MAYOR_DIV,o.PRECIO_DETAL_BCV,o.PRECIO_DETAL_DIV,o.CODIGO_PROVEEDOR,
      'NO',o.ID_PAM,opId,o.FECHA_ACTUALIZACION
    ] : null;
    var autor = 'Demo · ' + perfil.nombre;
    var plan = { objeto: o, entrada: datos, catalogo: catalogo, formulas: formulas, filaCatalogo: filaCatalogo, etapaAnterior: etapaAnterior, versionAnterior: versionAnterior };
    var json = JSON.stringify(plan);
    if (json.length > 45000) throw new Error('La solicitud es demasiado extensa.');
    var filaOperacion = hojas.operaciones.getLastRow() + 1;
    var operacion = [opId,tipo,o.ID_PAM,new Date().toISOString(),'PENDIENTE',json,'',autor];
    hojas.operaciones.getRange(filaOperacion, 1, 1, 8).setValues([operacion]);
    SpreadsheetApp.flush();
    return pamAplicarOperacion_(hojas, filaOperacion, operacion);
  });
}

function tomarSolicitudPAM(datos, rol) { return pamGuardar_('TOMAR_PAM', datos, rol); }
function guardarSolicitudPAM(datos, rol) { return pamGuardar_('SOLICITUD', datos, rol); }
function guardarProcuraPAM(datos, rol) { return pamGuardar_('PROCURA', datos, rol); }
function publicarPAMPrueba(datos, rol) { return pamGuardar_('PUBLICAR_PRUEBA', datos, rol); }
function confirmarAlojamientoPAM(datos, rol) { return pamGuardar_('CONFIRMAR_DRD', datos, rol); }

function reintentarOperacionPAM(id, rol) {
  var perfil = pamPerfilDemo_(rol);
  return pamConBloqueo_(function() {
    var hojas = pamPreparar_(pamLibro_());
    var operaciones = pamFilas_(hojas.operaciones, 8);
    var indice = operaciones.findIndex(function(f) { return f[0] === id; });
    if (indice < 0) throw new Error('Operación no encontrada.');
    var tipo = operaciones[indice][1];
    pamExigirDemo_(rol, (tipo === 'PROCURA' || tipo === 'TOMAR_PAM') ? 'procura' : tipo === 'PUBLICAR_PRUEBA' ? 'data' : null);
    if (!perfil.interno) throw new Error('Reintenta tu envío desde el aviso local del D.R.D.');
    if (operaciones[indice][4] === 'CONFIRMADO') return JSON.parse(operaciones[indice][6] || '{}');
    return pamAplicarOperacion_(hojas, indice + 2, operaciones[indice]);
  });
}

function obtenerActividadPAM(id, rol) {
  var perfil = pamPerfilDemo_(rol);
  return pamConBloqueo_(function() {
    var hojas = pamPreparar_(pamLibro_());
    return pamFilas_(hojas.eventos, 7).filter(function(f) { return f[2] === id; }).map(function(f) {
      return { fecha: Utilities.formatDate(new Date(f[1]), 'America/Caracas', 'dd/MM/yyyy HH:mm'),
        accion: f[3], anterior: f[4], etapa: f[5], autor: perfil.interno ? pamLeerCelda_(f[6]) : 'Actualización del proceso' };
    }).reverse();
  });
}

function consultarOperacionPAM(id, rol) {
  var perfil = pamPerfilDemo_(rol);
  return pamConBloqueo_(function() {
    var hojas = pamPreparar_(pamLibro_());
    var op = pamFilas_(hojas.operaciones, 8).find(function(f) { return f[0] === id; });
    if (op && !perfil.interno && op[1] !== 'SOLICITUD' && op[1] !== 'CONFIRMAR_DRD') {
      throw new Error('ACCESO_DENEGADO: Operación interna.');
    }
    return { exito: true, registrada: !!op, estado: op ? op[4] : 'SIN_REGISTRO' };
  });
}

// Directorio compartido con Compras. PAM no tiene funciones para dar de alta proveedores.
function pamLeerProveedores_(libro) {
  var hoja = libro.getSheetByName('Leyenda_Proveedores') || libro.getSheetByName('Leyenda de proveedores');
  if (!hoja || hoja.getLastRow() < 2) return [];
  var ancho = Math.max(6, hoja.getLastColumn());
  var datos = hoja.getRange(1, 1, hoja.getLastRow(), ancho).getValues();
  var encabezados = datos[0].map(function(v) {
    return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
  });
  var activo = encabezados.findIndex(function(v) { return v === 'ACTIVO' || v === 'AUTORIZADO' || v === 'ESTADO'; });
  var mapa = Object.create(null), repetidos = new Set();
  datos.slice(1).forEach(function(f) {
    var codigo = pamTexto_(pamLeerCelda_(f[1]), 100).toUpperCase();
    var nombre = pamTexto_(pamLeerCelda_(f[0]), 200);
    if (!codigo || !nombre) return;
    if (mapa[codigo]) repetidos.add(codigo);
    var habilitado = activo < 0 || !/^(NO|FALSE|0|INACTIVO|DESAUTORIZADO|BAJA)$/.test(String(f[activo]).trim().toUpperCase());
    mapa[codigo] = { codigo: codigo, nombre: nombre, origen: pamTexto_(f[2], 100), autorizado: habilitado,
      plazos: { maracay: pamTexto_(f[3], 200), el_tigre: pamTexto_(f[4], 200), barquisimeto: pamTexto_(f[5], 200) } };
  });
  return Object.keys(mapa).filter(function(codigo) { return !repetidos.has(codigo) && mapa[codigo].autorizado; })
    .map(function(codigo) { return mapa[codigo]; })
    .sort(function(a, b) { return a.nombre.localeCompare(b.nombre, 'es'); });
}

function pamProveedor_(libro, codigo, nombreAnterior) {
  var lista = pamLeerProveedores_(libro), clave = pamTexto_(codigo, 100).toUpperCase();
  var candidatos = lista.filter(function(p) {
    return clave ? p.codigo === clave : p.nombre.toUpperCase() === pamTexto_(nombreAnterior, 200).toUpperCase();
  });
  if (candidatos.length !== 1) {
    throw new Error('Selecciona un proveedor autorizado por Compras. Si fue eliminado, desactivado o su código está duplicado, actualiza el directorio desde Compras.');
  }
  return candidatos[0];
}

function pamAsignarProveedor_(o, proveedor) {
  o.PROVEEDOR = proveedor.nombre;
  o.CODIGO_PROVEEDOR = proveedor.codigo;
  o.PLAZO_MARACAY = proveedor.plazos.maracay;
  o.PLAZO_EL_TIGRE = proveedor.plazos.el_tigre;
  o.PLAZO_BARQUISIMETO = proveedor.plazos.barquisimeto;
  o.PLAZO_ENTREGA = 'Maracay: ' + (proveedor.plazos.maracay || 'Por confirmar') +
    ' · El Tigre: ' + (proveedor.plazos.el_tigre || 'Por confirmar') +
    ' · Barquisimeto: ' + (proveedor.plazos.barquisimeto || 'Por confirmar');
}

// Reutilizar las fórmulas reales de M:N de Productos, nunca inferir un margen.
function pamFormulasDetal_(libro) {
  var origen = libro.getSheetByName('Productos');
  if (!origen || origen.getLastRow() < 2 || origen.getLastColumn() < 14) {
    throw new Error('No se encontraron las fórmulas de detal en las columnas M:N de Productos.');
  }
  var formulas = origen.getRange(2, 13, origen.getLastRow() - 1, 2).getFormulasR1C1();
  return [0, 1].map(function(columna) {
    var indice = formulas.findIndex(function(f) { return !!f[columna]; });
    if (indice < 0) throw new Error('Falta la fórmula de detal en Productos, columna ' + (columna === 0 ? 'M' : 'N') + '.');
    var formula = formulas[indice][columna];
    if (/\b[A-Za-z_][A-Za-z0-9_]*\[[^\]]*[A-Za-z_][^\]]*\]/.test(formula)) {
      throw new Error('La fórmula de detal usa referencias de tabla. Comparte las fórmulas de M:N para adaptar esa referencia al catálogo PAM de prueba.');
    }
    var matricial = /\b(?:ARRAYFORMULA|MAP|BYROW|SCAN)\s*\(/i.test(formula);
    if (matricial && indice !== 0) throw new Error('La fórmula matricial de detal debe iniciar en la fila 2 para reutilizarse en prueba.');
    // Referencias explícitas a la propia hoja deben calcular sobre las filas de prueba.
    formula = formula.replace(/(?:'Productos'|\bProductos)!/gi, "'PAM_Catalogo_Prueba'!");
    return { columna: columna + 13, formula: formula, matricial: matricial };
  });
}

function pamSiguienteFilaCatalogo_(hojas) {
  var max = 1;
  pamFilas_(hojas.catalogo, 19).forEach(function(f, i) { if (f[0] || f[16]) max = i + 2; });
  pamFilas_(hojas.operaciones, 8).forEach(function(op) {
    if (op[4] !== 'PENDIENTE') return;
    var plan = JSON.parse(op[5]);
    if (plan.filaCatalogo) max = Math.max(max, plan.filaCatalogo);
  });
  return max + 1;
}

function pamAplicarDetal_(hoja, fila, formulas) {
  formulas.forEach(function(regla) {
    if (regla.matricial) {
      var raiz = hoja.getRange(2, regla.columna);
      if (raiz.getFormulasR1C1()[0][0] !== regla.formula) {
        // Solo las columnas calculadas del catálogo de prueba. Las filas antiguas se recalculan.
        hoja.getRange(2, regla.columna, Math.max(hoja.getLastRow(), fila) - 1, 1).clearContent();
        raiz.setFormulaR1C1(regla.formula);
      }
    } else {
      hoja.getRange(fila, regla.columna).setFormulaR1C1(regla.formula);
    }
  });
}

function obtenerProveedoresPAM(rol) {
  pamExigirDemo_(rol, 'interno');
  return pamLeerProveedores_(pamLibro_());
}
