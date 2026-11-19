// Presencia reciente. La sesión de Google se valida por separado.
var RIM_PRESENCIA_SEGUNDOS_ = 120;
var RIM_METRICAS_VENTAS_CACHE_ = 'RIM_METRICAS_VENTAS_V1';

function rimClavePresencia_(email) {
  return 'RIM_PRESENCIA_V1:' + rimHash_(email);
}

function actualizarPresenciaVentas(token) {
  var perfil = rimUsuario_(token);
  CacheService.getScriptCache().put(rimClavePresencia_(perfil.email), rimHash_(token), RIM_PRESENCIA_SEGUNDOS_);
  return true;
}

function obtenerPanelVentas(token) {
  var perfil = rimUsuario_(token);
  if (perfil.rol !== 'propietario' && perfil.rol !== 'supervisora') {
    throw new Error('ACCESO_DENEGADO: Este panel es para supervisión y administración.');
  }
  var cache = CacheService.getScriptCache();
  return { perfiles: rimPerfilesEnLinea_(cache), vendedores: rimMetricasVentas_(cache) };
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

function rimMetricasVentas_(cache) {
  var guardado = cache.get(RIM_METRICAS_VENTAS_CACHE_);
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
    var doc = fila[11] ? null : rimDocumentoFila_(fila);
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
      if (ticket && (!tickets.has(ticket) || !tickets.get(ticket).nombre)) tickets.set(ticket, { nombre: fila[4] });
    });
  });
  rimFilasPanelVentas_(libro, 'RIM_Envios_Pedidos', 5).forEach(function(fila) {
    var ticket = normalizar(fila[2]);
    if (!ticket || (!tickets.has(ticket) && normalizar(fila[4]) !== 'confirmado')) return;
    var pedido = tickets.get(ticket) || {};
    if (normalizar(fila[1])) pedido.email = fila[1];
    tickets.set(ticket, pedido);
  });
  tickets.forEach(function(pedido) {
    var responsable = vendedor(pedido.email, pedido.nombre);
    if (responsable) responsable.pedidos++;
  });

  var resultado = Object.keys(vendedores).map(function(email) { return vendedores[email]; });
  resultado.sort(function(a, b) { return a.nombre.localeCompare(b.nombre, 'es'); });
  cache.put(RIM_METRICAS_VENTAS_CACHE_, JSON.stringify(resultado), 60);
  return resultado;
}
