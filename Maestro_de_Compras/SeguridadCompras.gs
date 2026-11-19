// SOLO COMPRAS. No instalar en Ventas.
var COMPRAS_SESION_DIAS_ = 6;
var COMPRAS_SESION_PREFIJO_ = "COMPRAS_SESION_V1:";

var COMPRAS_PERFILES_ = {
  'compras-administradora@example.invalid': { nombre: 'Maribel', rol: 'administradora', etiqueta: 'Administradora', editar: true },
  'compras-procura@example.invalid': { nombre: 'Monica', rol: 'procura', etiqueta: 'Procura', editar: false },
  'compras-lprocura@example.invalid': { nombre: 'Paola', rol: 'lprocura', etiqueta: 'LProcura', editar: false },
  'compras-desarrollador@example.invalid': { nombre: 'Kelvin', rol: 'desarrollador', etiqueta: 'Desarrollador', editar: true }
};
function comprasPerfil_(email) {
  email = String(email || '').trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(COMPRAS_PERFILES_, email)) return null;
  var p = COMPRAS_PERFILES_[email];
  return { email: email, nombre: p.nombre, rol: p.rol, etiqueta: p.etiqueta, puedeEditarProveedores: p.editar, esPropietario: p.rol === 'desarrollador' };
}
function comprasId_() { return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''); }
function comprasHash_(s) {
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s))).replace(/=+$/, '');
}
function comprasConfig_() {
  var p = PropertiesService.getScriptProperties();
  var c = { id: p.getProperty('COMPRAS_GOOGLE_CLIENT_ID'), secreto: p.getProperty('COMPRAS_GOOGLE_CLIENT_SECRET'), redirect: p.getProperty('COMPRAS_OAUTH_REDIRECT_URI') };
  if (!c.id || !c.secreto || !c.redirect || !/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(c.redirect)) {
    throw new Error('Falta configurar el acceso Google en las propiedades del script. Consulta INSTALACION-COMPRAS.md.');
  }
  return c;
}
function prepararInicioSesionCompras(emailSolicitado) {
  var emailEsperado = String(emailSolicitado || '').trim().toLowerCase();
  if (!comprasPerfil_(emailEsperado)) throw new Error('Este correo no esta autorizado para Compras.');
  var c = comprasConfig_(), state = comprasId_(), consulta = comprasId_(), verifier = comprasId_();
  CacheService.getScriptCache().put('compras:oauth:' + state, JSON.stringify({ consulta: comprasHash_(consulta), verifier: verifier, emailEsperado: emailEsperado }), 600);
  var params = {
    client_id: c.id, redirect_uri: c.redirect, response_type: 'code', scope: 'openid email profile',
    state: state, login_hint: emailEsperado, prompt: 'select_account', access_type: 'online',
    code_challenge: comprasHash_(verifier), code_challenge_method: 'S256'
  };
  return { estado: state, consulta: consulta, url: 'https://accounts.google.com/o/oauth2/v2/auth?' + Object.keys(params).map(function(k) { return k + '=' + encodeURIComponent(params[k]); }).join('&') };
}
function consultarInicioSesionCompras(estado, consulta) {
  var cache = CacheService.getScriptCache(), raw = cache.get('compras:oauth:' + String(estado));
  if (!raw) throw new Error('El inicio de sesión venció. Inténtalo nuevamente.');
  var tx = JSON.parse(raw);
  if (comprasHash_(consulta) !== tx.consulta) throw new Error('Solicitud de acceso inválida.');
  if (tx.error) { cache.remove('compras:oauth:' + estado); throw new Error(tx.error); }
  if (!tx.sesion) return { pendiente: true };
  cache.remove('compras:oauth:' + estado);
  return { pendiente: false, token: tx.sesion, usuario: comprasUsuario_(tx.sesion) };
}
function comprasCallbackOAuth_(e) {
  var state = String(e.parameter.state || '');
  var cache = CacheService.getScriptCache();
  var tx, mensaje, etapa = 'recuperar solicitud', bloqueado = false;
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    bloqueado = true;
    var raw = cache.get('compras:oauth:' + state);
    if (!raw) throw new Error('Solicitud vencida.');
    tx = JSON.parse(raw);
    if (tx.procesando || tx.sesion || tx.error) throw new Error('Solicitud utilizada.');
    tx.procesando = true;
    cache.put('compras:oauth:' + state, JSON.stringify(tx), 600);
  } catch (err) {
    return HtmlService.createHtmlOutput('<p>Solicitud vencida o utilizada. Cancela el acceso en el panel de Compras e inicia uno nuevo.</p>');
  } finally {
    if (bloqueado) lock.releaseLock();
  }
  try {
    if (e.parameter.error || !e.parameter.code) throw new Error('RIM-01: Acceso cancelado en Google.');
    etapa = 'leer propiedades OAuth';
    var c = comprasConfig_();
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
    if (email !== tx.emailEsperado) throw new Error('RIM-09: La cuenta Google elegida no coincide con el correo ingresado.');
    var perfil = comprasPerfil_(email);
    if (!perfil) {
      throw new Error('RIM-06: Este correo no esta autorizado para el panel de Compras.');
    }
    etapa = 'crear sesion del panel de Compras';
    var sesion = comprasId_();
    comprasGuardarSesion_(sesion, {
      email: email,
      nombre: perfil.nombre,
      rol: perfil.rol,
      sub: claims.sub,
      vence: Date.now() + COMPRAS_SESION_DIAS_ * 86400000
    });
    tx = { consulta: tx.consulta, sesion: sesion };
    mensaje = 'Acceso confirmado. Regresa a la pestana del panel de Compras. Puedes cerrar esta ventana.';
  } catch (err) {
    var detalle = String(err.message || '');
    var errorSeguro;
    if (/^RIM-0[1-69]:/.test(detalle)) errorSeguro = detalle;
    else if (/script\.external_request|permission|permisos|autorizaci/i.test(detalle)) {
      errorSeguro = 'RIM-07: Falta autorizar las solicitudes externas con la cuenta propietaria y publicar la nueva version.';
    } else {
      errorSeguro = 'RIM-08: Fallo durante el paso: ' + etapa + '.';
    }
    // No registrar tokens, secretos, codigos ni respuestas de autenticacion.
    Logger.log(errorSeguro);
    tx = { consulta: tx.consulta, error: errorSeguro };
    mensaje = errorSeguro + ' Regresa al panel de Compras para volver a intentarlo.';
  }
  cache.put('compras:oauth:' + state, JSON.stringify(tx), 600);
  return HtmlService.createHtmlOutput(
    '<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Acceso Compras RIM</title><body style="font-family:Arial;padding:32px;background:#f5f5f5;color:#262626">' +
    '<h2>Acceso a Compras · Rodaindustria</h2><p>' + comprasEscape_(mensaje) + '</p></body></html>'
  );
}

function comprasGuardarSesion_(token, usuario) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var props = PropertiesService.getScriptProperties();
    var todas = props.getProperties();
    Object.keys(todas).forEach(function(k) {
      if (k.indexOf(COMPRAS_SESION_PREFIJO_) !== 0) return;
      try { if (JSON.parse(todas[k]).vence > Date.now()) return; } catch (e) {}
      props.deleteProperty(k);
    });
    // Se almacena únicamente la huella del token, nunca el token utilizable.
    props.setProperty(COMPRAS_SESION_PREFIJO_ + comprasHash_(token), JSON.stringify(usuario));
  } finally { lock.releaseLock(); }
}

function comprasUsuario_(token) {
  var valido = typeof token === 'string' && /^[a-zA-Z0-9_-]{32,128}$/.test(token);
  var clave = valido ? COMPRAS_SESION_PREFIJO_ + comprasHash_(token) : '';
  var props = PropertiesService.getScriptProperties();
  var raw = clave && props.getProperty(clave);
  // Compatibilidad con las sesiones anteriores hasta su vencimiento original.
  if (!raw && valido) raw = CacheService.getScriptCache().get('compras:sesion:' + comprasHash_(token));
  if (!raw) throw new Error('SESION_REQUERIDA: Inicia sesión con tu cuenta Google autorizada.');
  var u = JSON.parse(raw);
  var perfil = comprasPerfil_(u.email);
  if (!isFinite(u.vence) || u.vence <= Date.now() || !perfil || perfil.nombre !== u.nombre) {
    if (clave) props.deleteProperty(clave);
    throw new Error('SESION_REQUERIDA: Tu sesión venció.');
  }
  // El rol se deriva del directorio del servidor, nunca del navegador o del cache.
  return { email: perfil.email, nombre: perfil.nombre, rol: perfil.rol, etiqueta: perfil.etiqueta, puedeEditarProveedores: perfil.puedeEditarProveedores, esPropietario: perfil.esPropietario, vence: u.vence };
}
function obtenerSesionCompras(token) { return comprasUsuario_(token); }
function cerrarSesionCompras(token) {
  if (typeof token === 'string' && /^[a-zA-Z0-9_-]{32,128}$/.test(token)) {
    PropertiesService.getScriptProperties().deleteProperty(COMPRAS_SESION_PREFIJO_ + comprasHash_(token));
    CacheService.getScriptCache().remove('compras:sesion:' + comprasHash_(token));
  }
  return true;
}
function comprasEscape_(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

function comprasExigirEditor_(token) {
  var u = comprasUsuario_(token);
  if (!u.puedeEditarProveedores) throw new Error('ACCESO_DENEGADO: Solo Administradora y Desarrollador pueden añadir o modificar proveedores y rubros.');
  return u;
}
function obtenerSolicitudesCompras(token) { var u=comprasUsuario_(token); return comprasLeerActivas_(u); }
function obtenerProveedores(token) { comprasUsuario_(token); return obtenerProveedores_(); }
function guardarDatosProveedorCompleto(datos, token) { comprasExigirEditor_(token); return guardarDatosProveedorCompleto_(datos); }
function guardarRubrosProveedor(codigo, rubros, token) { comprasExigirEditor_(token); return guardarRubrosProveedor_(codigo, rubros); }
function obtenerComentariosYEstadoTickets(filtro, token) { comprasUsuario_(token); return obtenerComentariosYEstadoTickets_(filtro); }
function agregarComentarioTicket(datos, token) {
  var u = comprasUsuario_(token);
  if (!datos || !/^TCK-\d+$/.test(String(datos.ticket || '')) || !String(datos.mensaje || '').trim()) throw new Error('Ticket o mensaje inválido.');
  // Mantener rol Compras para que Ventas notifique los mensajes; el autor distingue el perfil real.
  return agregarComentarioTicket_({ticket: datos.ticket, mensaje: String(datos.mensaje).trim().slice(0,2000), autor: u.nombre + ' (' + u.etiqueta + ')', rol: 'Compras'});
}
function actualizarEstadoTicket(ticket, estado, anterior, operacion, token) {
  var u=comprasUsuario_(token);
  return comprasEjecutarAccion_('CAMBIO_ESTADO',{ticket:comprasTicket_(ticket),nuevo:comprasEstado_(estado),anterior:comprasEstado_(anterior),motivo:''},operacion,u);
}
function despacharYArchivarTicket(ticket, operacion, token) {
  var u=comprasUsuario_(token);
  return comprasEjecutarAccion_('ARCHIVAR',{ticket:comprasTicket_(ticket),motivo:'Despacho confirmado'},operacion,u);
}
function cambiarProveedorSolicitud(ticket,idItem,nuevo,anterior,operacion,token) {
  var u=comprasUsuario_(token);
  return comprasEjecutarAccion_('ASIGNAR_PROVEEDOR',{ticket:comprasTicket_(ticket),idItem:comprasTexto_(idItem,150),nuevo:comprasTexto_(nuevo,100),anterior:comprasTexto_(anterior,100),motivo:'Cambio de proveedor en Compras'},operacion,u);
}
function reintentarOperacionCompras(id,token) {
  var u=comprasUsuario_(token),op=comprasBuscarOperacion_(comprasIdOperacion_(id));
  if(!op||(op.valores[3]!==u.email&&!u.puedeEditarProveedores))throw new Error('Operación no encontrada para tu cuenta.');
  return comprasEjecutarAccion_(op.valores[1],op.datos.solicitud,id,u,true);
}
function obtenerHistoricoCompras(filtros,token) { comprasUsuario_(token);return comprasLeerHistorico_(filtros); }
function obtenerComentariosCompras(cursor,token) { comprasUsuario_(token);return comprasLeerComentarios_(cursor); }
function obtenerBitacoraCompras(ticket,token) {
  comprasUsuario_(token);ticket=comprasTicket_(ticket);
  var h=obtenerLibroCentral_().getSheetByName(COMPRAS_HOJAS_GESTION_.bitacora[0]);
  return {exito:true,eventos:comprasFilas_(h,10).filter(function(f){return String(f[2])===ticket;}).reverse().map(function(f){return {fecha:f[1] instanceof Date?Utilities.formatDate(f[1],'America/Caracas','dd/MM/yyyy HH:mm'):String(f[1]),accion:String(f[4]),anterior:String(f[5]),nuevo:String(f[6]),autor:String(f[7]),id_item:String(f[3])};})};
}
function autorizarServiciosCompras() {
  var r = UrlFetchApp.fetch('https://accounts.google.com/.well-known/openid-configuration');
  obtenerLibroCentral_().getId();
  Logger.log('Compras: conexión Google HTTP ' + r.getResponseCode() + '; acceso al libro central confirmado.');
}

function consultarOperacionCompras(id,token) {
  var u=comprasUsuario_(token),op=comprasBuscarOperacion_(comprasIdOperacion_(id));
  if(!op)return {exito:true,encontrada:false};
  if(op.valores[3]!==u.email&&!u.puedeEditarProveedores)throw new Error('Operación no encontrada para tu cuenta.');
  return {exito:true,encontrada:true,estado:String(op.valores[6])};
}
