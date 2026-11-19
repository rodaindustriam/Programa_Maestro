// Acceso Google mediante OAuth/OpenID Connect. No utiliza contraseñas de vendedores.
// Propiedades del script: RIM_GOOGLE_CLIENT_ID, RIM_GOOGLE_CLIENT_SECRET,
// RIM_OAUTH_REDIRECT_URI (URL /exec de este despliegue), GEMINI_API_KEY.
// Duración fija desde el inicio de sesión: cambia 3 por 6 si prefieres seis días.
var RIM_SESION_DIAS_ = 3;
var RIM_SESION_PREFIJO_ = "RIM_SESION_V1:";

var RIM_VENDEDORES_ = {
  'komo.rodaindustria01@gmail.com': 'Neiger',
  'komo.rodaindustria03@gmail.com': 'Yuliana',
  'komo.rodaindustria05@gmail.com': 'Elieska',
  'komo.rodaindustria06@gmail.com': 'Jason',
  'komo.rodaindustria04@gmail.com': 'Keicson (Detal Maracay)'
};

// Propietarios separados del directorio de vendedores.
var RIM_PROPIETARIOS_ = {
  'alzurokelvin17@gmail.com': 'Kelvin (Propietario / Desarrollador)'
};

// Supervisión de Ventas, independiente del perfil de propietario y de Compras.
var RIM_SUPERVISORAS_ = {
  'rodaindustriamaracay.ventas01@gmail.com': 'Melisa (Supervisora)',
  'dianaherrera0206@gmail.com': 'Diana (Directivo)'
};

function rimPerfil_(email) {
  email = String(email || '').trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(RIM_PROPIETARIOS_, email)) {
    return { email: email, nombre: RIM_PROPIETARIOS_[email], rol: 'propietario', esPropietario: true };
  }
  if (Object.prototype.hasOwnProperty.call(RIM_SUPERVISORAS_, email)) {
    return { email: email, nombre: RIM_SUPERVISORAS_[email], rol: 'supervisora', esPropietario: false };
  }
  if (Object.prototype.hasOwnProperty.call(RIM_VENDEDORES_, email)) {
    return { email: email, nombre: RIM_VENDEDORES_[email], rol: 'vendedor', esPropietario: false };
  }
  return null;
}

function rimId_() { return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''); }
function rimHash_(s) {
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s))).replace(/=+$/, '');
}
function rimConfig_() {
  var p = PropertiesService.getScriptProperties();
  var c = { id: p.getProperty('RIM_GOOGLE_CLIENT_ID'), secreto: p.getProperty('RIM_GOOGLE_CLIENT_SECRET'), redirect: p.getProperty('RIM_OAUTH_REDIRECT_URI') };
  if (!c.id || !c.secreto || !c.redirect || !/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(c.redirect)) {
    throw new Error('Falta configurar el acceso Google en las propiedades del script. Consulta INSTALACION.md.');
  }
  return c;
}
function prepararInicioSesion() {
  var c = rimConfig_(), state = rimId_(), consulta = rimId_(), verifier = rimId_();
  CacheService.getScriptCache().put('oauth:' + state, JSON.stringify({ consulta: rimHash_(consulta), verifier: verifier }), 600);
  var params = {
    client_id: c.id, redirect_uri: c.redirect, response_type: 'code', scope: 'openid email profile',
    state: state, prompt: 'select_account', access_type: 'online',
    code_challenge: rimHash_(verifier), code_challenge_method: 'S256'
  };
  return { estado: state, consulta: consulta, url: 'https://accounts.google.com/o/oauth2/v2/auth?' + Object.keys(params).map(function(k) { return k + '=' + encodeURIComponent(params[k]); }).join('&') };
}
function consultarInicioSesion(estado, consulta) {
  var cache = CacheService.getScriptCache(), raw = cache.get('oauth:' + String(estado));
  if (!raw) throw new Error('El inicio de sesión venció. Inténtalo nuevamente.');
  var tx = JSON.parse(raw);
  if (rimHash_(consulta) !== tx.consulta) throw new Error('Solicitud de acceso inválida.');
  if (tx.error) { cache.remove('oauth:' + estado); throw new Error(tx.error); }
  if (!tx.sesion) return { pendiente: true };
  cache.remove('oauth:' + estado);
  return { pendiente: false, token: tx.sesion, usuario: rimUsuario_(tx.sesion) };
}
function rimCallbackOAuth_(e) {
  var state = String(e.parameter.state || '');
  var cache = CacheService.getScriptCache();
  var tx, mensaje, etapa = 'recuperar solicitud', bloqueado = false;
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    bloqueado = true;
    var raw = cache.get('oauth:' + state);
    if (!raw) throw new Error('Solicitud vencida.');
    tx = JSON.parse(raw);
    if (tx.procesando || tx.sesion || tx.error) throw new Error('Solicitud utilizada.');
    tx.procesando = true;
    cache.put('oauth:' + state, JSON.stringify(tx), 600);
  } catch (err) {
    return HtmlService.createHtmlOutput('<p>Solicitud vencida o utilizada. Cancela el acceso en el maestro e inicia uno nuevo.</p>');
  } finally {
    if (bloqueado) lock.releaseLock();
  }
  try {
    if (e.parameter.error || !e.parameter.code) throw new Error('RIM-01: Acceso cancelado en Google.');
    etapa = 'leer propiedades OAuth';
    var c = rimConfig_();
    etapa = 'intercambiar codigo con Google';
    var respuesta = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
      method: 'post',
      payload: {
        code: e.parameter.code,
        client_id: c.id,
        client_secret: c.secreto,
        redirect_uri: c.redirect,
        grant_type: 'authorization_code',
        code_verifier: tx.verifier
      },
      muteHttpExceptions: true
    });
    if (respuesta.getResponseCode() !== 200) {
      var causa = '';
      try {
        var codigo = JSON.parse(respuesta.getContentText()).error;
        if (['invalid_client', 'invalid_grant', 'redirect_uri_mismatch', 'unauthorized_client'].indexOf(codigo) >= 0) causa = ' (' + codigo + ')';
      } catch (ignorado) {}
      throw new Error('RIM-02: Google rechazo el intercambio, HTTP ' + respuesta.getResponseCode() + causa + '.');
    }
    var tokens = JSON.parse(respuesta.getContentText());
    if (!tokens.access_token || String(tokens.token_type).toLowerCase() !== 'bearer') {
      throw new Error('RIM-03: Google no devolvio un token de acceso valido.');
    }
    etapa = 'consultar identidad verificada';
    // El token procede del intercambio servidor a servidor con el cliente OAuth,
    // su secreto, el redirect y el verificador PKCE. Nunca lo aporta el navegador.
    // Se consulta Google con una URL corta; el token va en el encabezado HTTPS.
    var verificacion = UrlFetchApp.fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: 'Bearer ' + tokens.access_token },
      muteHttpExceptions: true
    });
    if (verificacion.getResponseCode() !== 200) {
      throw new Error('RIM-04: Google no pudo devolver la identidad, HTTP ' + verificacion.getResponseCode() + '.');
    }
    var claims = JSON.parse(verificacion.getContentText());
    var email = String(claims.email || '').trim().toLowerCase();
    if (!claims.sub || !email || String(claims.email_verified) !== 'true') {
      throw new Error('RIM-05: Google no confirmo un correo verificado.');
    }
    var perfil = rimPerfil_(email);
    if (!perfil) {
    throw new Error(
    'RIM-06: Correo recibido: ' + email +
    '. Revision: MELISA-01.'
        );
        }
    etapa = 'crear sesion del maestro';
    var sesion = rimId_();
    rimGuardarSesion_(sesion, {
      email: email,
      nombre: perfil.nombre,
      rol: perfil.rol,
      sub: claims.sub,
      vence: Date.now() + RIM_SESION_DIAS_ * 86400000
    });
    tx = { consulta: tx.consulta, sesion: sesion };
    mensaje = 'Acceso confirmado. Regresa a la pestana del maestro. Puedes cerrar esta ventana.';
  } catch (err) {
    var detalle = String(err.message || '');
    var errorSeguro;
    if (/^RIM-0[1-6]:/.test(detalle)) errorSeguro = detalle;
    else if (/script\.external_request|permission|permisos|autorizaci/i.test(detalle)) {
      errorSeguro = 'RIM-07: Falta autorizar las solicitudes externas con la cuenta propietaria y publicar la nueva version.';
    } else {
      errorSeguro = 'RIM-08: Fallo durante el paso: ' + etapa + '.';
    }
    // No registrar tokens, secretos, codigos ni respuestas de autenticacion.
    Logger.log(errorSeguro);
    tx = { consulta: tx.consulta, error: errorSeguro };
    mensaje = errorSeguro + ' Regresa al maestro para volver a intentarlo.';
  }
  cache.put('oauth:' + state, JSON.stringify(tx), 600);
  return HtmlService.createHtmlOutput(
    '<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Acceso RIM</title><body style="font-family:Arial;padding:32px;background:#f5f5f5;color:#262626">' +
    '<h2>Acceso Rodaindustria</h2><p>' + rimEscape_(mensaje) + '</p></body></html>'
  );
}

function rimGuardarSesion_(token, usuario) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var props = PropertiesService.getScriptProperties();
    var todas = props.getProperties();
    Object.keys(todas).forEach(function(k) {
      if (k.indexOf(RIM_SESION_PREFIJO_) !== 0) return;
      try { if (JSON.parse(todas[k]).vence > Date.now()) return; } catch (e) {}
      props.deleteProperty(k);
    });
    // Se almacena únicamente la huella del token, nunca el token utilizable.
    props.setProperty(RIM_SESION_PREFIJO_ + rimHash_(token), JSON.stringify(usuario));
  } finally { lock.releaseLock(); }
}

function rimUsuario_(token) {
  var valido = typeof token === 'string' && /^[a-zA-Z0-9_-]{32,128}$/.test(token);
  var clave = valido ? RIM_SESION_PREFIJO_ + rimHash_(token) : '';
  var props = PropertiesService.getScriptProperties();
  var raw = clave && props.getProperty(clave);
  // Compatibilidad temporal con sesiones anteriores de seis horas.
  if (!raw && valido) raw = CacheService.getScriptCache().get('sesion:' + rimHash_(token));
  if (!raw) throw new Error('SESION_REQUERIDA: Inicia sesión con tu cuenta Google autorizada.');
  var u = JSON.parse(raw);
  var perfil = rimPerfil_(u.email);
  if (!isFinite(u.vence) || u.vence <= Date.now() || !perfil || perfil.nombre !== u.nombre) {
    if (clave) props.deleteProperty(clave);
    throw new Error('SESION_REQUERIDA: Tu sesión venció.');
  }
  // El rol se deriva del directorio del servidor, nunca del navegador o del cache.
  return { email: perfil.email, nombre: perfil.nombre, rol: perfil.rol, esPropietario: perfil.esPropietario, esSupervisora: perfil.rol === 'supervisora', vence: u.vence };
}
function obtenerSesion(token) { return rimUsuario_(token); }
function cerrarSesion(token) {
  if (typeof token === 'string' && /^[a-zA-Z0-9_-]{32,128}$/.test(token)) {
    PropertiesService.getScriptProperties().deleteProperty(RIM_SESION_PREFIJO_ + rimHash_(token));
    CacheService.getScriptCache().remove('sesion:' + rimHash_(token));
  }
  return true;
}
function rimEscape_(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function rimTexto_(v, max) { return String(v == null ? '' : v).trim().slice(0, max || 300); }
function rimCelda_(v) { return /^[=+@\-]/.test(String(v)) ? "'" + v : v; }
function rimMoneda_(v) { return Math.round((Number(v) + Number.EPSILON) * 100) / 100; }
function rimRequestId_(v) {
  if (!/^[a-zA-Z0-9_-]{20,100}$/.test(String(v || ''))) throw new Error('DATOS_INVALIDOS: Identificador de solicitud inválido.');
  return String(v);
}
function rimItems_(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 200) throw new Error('DATOS_INVALIDOS: La solicitud debe tener entre 1 y 200 productos.');
  return items.map(function(it) {
    var cant = Number(it.cant), precio = Number(it.precio);
    if (!rimTexto_(it.item, 200) || !isFinite(cant) || cant <= 0 || cant > 1000000 || !Number.isInteger(cant)) throw new Error('DATOS_INVALIDOS: Producto o cantidad inválida.');
    return { item: rimTexto_(it.item, 200), marca: rimTexto_(it.marca, 100), cant: cant,
      precio: isFinite(precio) ? precio : null };
  });
}

function registrarSolicitudPedido(datos, token) {
  var u = rimUsuario_(token);
  if (!datos || typeof datos !== 'object') throw new Error('DATOS_INVALIDOS: Solicitud inválida.');
  rimRequestId_(datos.requestId);
  var items = rimItems_(datos.items);
  var origenes = ['MARACAY', 'EL TIGRE', 'BARQUISIMETO'];
  if (origenes.indexOf(datos.sucursal_origen) === -1 || origenes.concat(['DIRECTO A CLIENTE']).indexOf(datos.sucursal_entrega) === -1) throw new Error('DATOS_INVALIDOS: Sucursal inválida.');
  if (['PAGADO','ANTICIPO','CRÉDITO','CREDITO','ANTICIPO / ABONO'].indexOf(datos.estatus_pago) === -1) throw new Error('DATOS_INVALIDOS: Estatus de pago inválido.');
  if (['Normal','Media','Alta','Urgente'].indexOf(datos.urgencia) === -1) throw new Error('DATOS_INVALIDOS: Urgencia inválida.');
  // Nunca confiar en el vendedor enviado por el navegador.
  var limpio = {
    requestId: datos.requestId, email: u.email, responsable: u.nombre.toUpperCase(), solicitante: u.nombre.toUpperCase(),
    sucursal_origen: datos.sucursal_origen, sucursal_entrega: datos.sucursal_entrega,
    cliente: rimCelda_(rimTexto_(datos.cliente, 300) || 'CLIENTE GENERAL'), estatus_pago: datos.estatus_pago,
    urgencia: datos.urgencia, motivo: rimCelda_(rimTexto_(datos.motivo, 1500)),
    items: items.map(function(it, i) {
      var original = datos.items[i];
      return { item: rimCelda_(it.item), marca: rimCelda_(it.marca), cant: it.cant,
        descripcion: rimCelda_(rimTexto_(original.descripcion, 1000)), prv: rimCelda_(rimTexto_(original.prv, 200)),
        stock_maracay: Number(original.stock_maracay) || 0, stock_el_tigre: Number(original.stock_el_tigre) || 0,
        stock_barquisimeto: Number(original.stock_barquisimeto) || 0 };
    })
  };
  return registrarSolicitudPedido_(limpio);
}
function obtenerComentariosYEstadoTickets(filtro, token) {
  rimUsuario_(token);
  return obtenerComentariosYEstadoTickets_(rimTexto_(filtro, 100));
}
function agregarComentarioTicket(datos, token) {
  var u = rimUsuario_(token);
  if (!datos || !/^TCK-\d+$/.test(String(datos.ticket)) || !rimTexto_(datos.mensaje, 2000)) throw new Error('Comentario inválido.');
  return agregarComentarioTicket_({ ticket: datos.ticket, autor: u.nombre, rol: u.esPropietario ? 'Propietario' : 'Ventas', mensaje: rimCelda_(rimTexto_(datos.mensaje, 2000)) });
}
function analizarConGeminiBackend(datos, token) { rimUsuario_(token); return analizarConGeminiBackend_(datos); }

function comprobarAccesoMelisa() {
  Logger.log(JSON.stringify(
    rimPerfil_('rodaindustriamaracay.ventas01@gmail.com')
  ));

  Logger.log(
    'Callback actualizado: ' +
    rimCallbackOAuth_.toString().includes('MELISA-01')
  );

  Logger.log(
    'Retorno configurado: ' +
    PropertiesService.getScriptProperties()
      .getProperty('RIM_OAUTH_REDIRECT_URI')
  );
}
