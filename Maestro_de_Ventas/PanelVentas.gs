// Presencia reciente. La sesión de Google se valida por separado.
var RIM_PRESENCIA_SEGUNDOS_ = 120;
var RIM_METRICAS_VENTAS_CACHE_ = 'RIM_METRICAS_VENTAS_V2';

function rimClavePresencia_(email) {
  return 'RIM_PRESENCIA_V1:' + rimHash_(email);
}

function actualizarPresenciaVentas(token) {
  var perfil = rimUsuario_(token);
  CacheService.getScriptCache().put(rimClavePresencia_(perfil.email), rimHash_(token), RIM_PRESENCIA_SEGUNDOS_);
  return true;
}

function obtenerPanelVentas(filtros, token) {
  // Permite que una pestaña de la versión anterior siga consultando el día actual.
  if (typeof filtros === 'string' && token == null) { token = filtros; filtros = {}; }
  var perfil = rimUsuario_(token);
  if (perfil.rol !== 'propietario' && perfil.rol !== 'supervisora') {
    throw new Error('ACCESO_DENEGADO: Este panel es para supervisión y administración.');
  }
  var cache = CacheService.getScriptCache();
  var rango = rimRangoPanelVentas_(filtros);
  return { perfiles: rimPerfilesEnLinea_(cache), vendedores: rimMetricasVentas_(cache, rango), rango: rango };
}

function rimPerfilesEnLinea_(cache) {
  var correos = Object.keys(RIM_PROPIETARIOS_).concat(Object.keys(RIM_SUPERVISORAS_), Object.keys(RIM_VENDEDORES_));
  var claves = Array.from(new Set(correos.map(rimClavePresencia_)));
  if (!claves.length) return [];
  var activos = cache.getAll(claves);
  var sesiones = PropertiesService.getScriptProperties().getProperties();
  var ahora = Date.now();
  var perfiles = [];
  Array.from(new Set(correos)).forEach(function(email) {
    var huella = activos[rimClavePresencia_(email)];
    if (!huella) return;
    var raw = sesiones[RIM_SESION_PREFIJO_ + huella];
    var duracion = (raw ? RIM_SESION_DIAS_ : 0.25) * 86400000;
    if (!raw) raw = cache.get('sesion:' + huella);
    if (!raw) return;
    var sesion;
    try { sesion = JSON.parse(raw); } catch (e) { return; }
    var perfil = rimPerfil_(email);
    if (!perfil || sesion.email !== perfil.email || sesion.nombre !== perfil.nombre || !(sesion.vence > ahora)) return;
    var inicio = Number(sesion.inicio) || Number(sesion.vence) - duracion;
    perfiles.push({ nombre: perfil.nombre, rol: perfil.rol, segundos: Math.max(0, Math.floor((ahora - inicio) / 1000)) });
  });
  return perfiles;
}

function rimFilasPanelVentas_(libro, nombre, ancho) {
  var hoja = libro.getSheetByName(nombre);
  if (!hoja || hoja.getLastRow() < 2) return [];
  return hoja.getRange(2, 1, hoja.getLastRow() - 1, Math.min(ancho, hoja.getLastColumn())).getValues();
}

function rimMetricasVentas_(cache, rango) {
  var clave = RIM_METRICAS_VENTAS_CACHE_ + ':' + rango.desde + ':' + rango.hasta;
  var guardado = cache.get(clave);
  if (guardado) return JSON.parse(guardado);
  var libro = obtenerLibroCentral_();
  var vendedores = Object.create(null), porNombre = Object.create(null);
  function normalizar(valor) { return String(valor == null ? '' : valor).trim().toLowerCase(); }
  function vendedor(email, nombre) {
    return normalizar(email) ? vendedores[normalizar(email)] : porNombre[normalizar(nombre)];
  }
  Object.keys(RIM_VENDEDORES_).forEach(function(email) {
    var perfil = rimPerfil_(email);
    if (perfil.rol !== 'vendedor') return;
    var fila = { nombre: perfil.nombre, cotizaciones: 0, pedidos: 0 };
    vendedores[email] = fila;
    porNombre[normalizar(perfil.nombre)] = fila;
  });

  var folios = new Set();
  rimFilasCotizaciones_().forEach(function(fila) {
    var folio = normalizar(fila[0]);
    if (!folio || folios.has(folio)) return;
    var doc = rimDocumentoFila_(fila);
    if (!rimFechaEnRangoPanel_(fila[1] || (doc && doc.fecha), rango)) return;
    var responsable = vendedor(fila[11] || (doc && doc.emailVendedor), doc && doc.vendedor);
    if (responsable) {
      responsable.cotizaciones++;
      folios.add(folio);
    }
  });

  var tickets = new Map();
  ['Solicitudes_Pedidos', 'Historico_Pedidos'].forEach(function(nombre) {
    rimFilasPanelVentas_(libro, nombre, 5).forEach(function(fila) {
      var ticket = normalizar(fila[0]);
      if (ticket && (!tickets.has(ticket) || !tickets.get(ticket).nombre)) tickets.set(ticket, { nombre: fila[4], fecha: fila[2] });
    });
  });
  rimFilasPanelVentas_(libro, 'RIM_Envios_Pedidos', 5).forEach(function(fila) {
    var ticket = normalizar(fila[2]);
    if (!ticket || (!tickets.has(ticket) && normalizar(fila[4]) !== 'confirmado')) return;
    var pedido = tickets.get(ticket) || {};
    if (normalizar(fila[1])) pedido.email = fila[1];
    if (!pedido.fecha) pedido.fecha = fila[3];
    tickets.set(ticket, pedido);
  });
  tickets.forEach(function(pedido) {
    if (!rimFechaEnRangoPanel_(pedido.fecha, rango)) return;
    var responsable = vendedor(pedido.email, pedido.nombre);
    if (responsable) responsable.pedidos++;
  });

  var resultado = Object.keys(vendedores).map(function(email) { return vendedores[email]; });
  resultado.sort(function(a, b) { return a.nombre.localeCompare(b.nombre, 'es'); });
  cache.put(clave, JSON.stringify(resultado), 60);
  return resultado;
}


function rimDiaPanelValido_(dia) {
  if (typeof dia !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) return false;
  var fecha = new Date(dia + 'T00:00:00Z');
  return isFinite(fecha.getTime()) && fecha.toISOString().slice(0, 10) === dia;
}

function rimRangoPanelVentas_(filtros) {
  filtros = filtros || {};
  var hoy = Utilities.formatDate(new Date(), 'America/Caracas', 'yyyy-MM-dd');
  var periodo = filtros.periodo || 'hoy';
  var dias = { hoy: 1, '7dias': 7, '15dias': 15, mes: 30 };
  if (periodo === 'personalizado') {
    if (!rimDiaPanelValido_(filtros.desde) || !rimDiaPanelValido_(filtros.hasta) || filtros.desde > filtros.hasta) {
      throw new Error('RANGO_INVALIDO: Selecciona una fecha inicial y final válidas, en ese orden.');
    }
    return { desde: filtros.desde, hasta: filtros.hasta };
  }
  if (!Object.prototype.hasOwnProperty.call(dias, periodo)) throw new Error('RANGO_INVALIDO: Período desconocido.');
  var inicio = new Date(hoy + 'T00:00:00Z');
  inicio.setUTCDate(inicio.getUTCDate() - dias[periodo] + 1);
  return { desde: inicio.toISOString().slice(0, 10), hasta: hoy };
}

function rimFechaEnRangoPanel_(valor, rango) {
  var dia = '';
  if (valor instanceof Date) {
    if (!isFinite(valor.getTime())) return false;
    dia = Utilities.formatDate(valor, 'America/Caracas', 'yyyy-MM-dd');
  } else if (typeof valor === 'string') {
    valor = valor.trim();
    if (rimDiaPanelValido_(valor)) {
      dia = valor;
    } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(valor)) {
      var fecha = new Date(valor);
      if (!isFinite(fecha.getTime())) return false;
      dia = Utilities.formatDate(fecha, 'America/Caracas', 'yyyy-MM-dd');
    } else {
      var partes = valor.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,T]+\d{1,2}:\d{2}(?::\d{2})?)?$/);
      if (!partes) return false;
      dia = partes[3] + '-' + partes[2].padStart(2, '0') + '-' + partes[1].padStart(2, '0');
      if (!rimDiaPanelValido_(dia)) return false;
    }
  }
  return !!dia && dia >= rango.desde && dia <= rango.hasta;
}
