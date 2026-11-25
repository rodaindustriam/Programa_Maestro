// DEMO: el selector permite ensayar roles; no identifica ni autentica al usuario.
// Mantener el despliegue "Solo yo" hasta incorporar identidad real.
var PAM_EMBUDOS_DEMO_ = [
  { id: 'demo-elieska', nombre: 'ELIESKA' },
  { id: 'demo-jason', nombre: 'JASON' },
  { id: 'demo-keicson', nombre: 'KEICSON (DETAL MARACAY)' },
  { id: 'demo-neiger', nombre: 'NEIGER' },
  { id: 'demo-yuliana', nombre: 'YULIANA' }
];

function pamPerfilDemo_(rol) {
  rol = rol || 'administrador';
  var perfiles = {
    ventas: { nombre: 'Ventas', interno: false, procura: false, data: false },
    procura: { nombre: 'Procura', interno: true, procura: true, data: false },
    data: { nombre: 'Data', interno: true, procura: false, data: true },
    administrador: { nombre: 'Administrador', interno: true, procura: true, data: true }
  };
  if (!Object.prototype.hasOwnProperty.call(perfiles, rol)) throw new Error('Perfil de demo no válido.');
  var perfil = perfiles[rol];
  return { rol: rol, nombre: perfil.nombre, interno: perfil.interno, procura: perfil.procura, data: perfil.data, demo: true };
}

function pamExigirDemo_(rol, permiso) {
  var perfil = pamPerfilDemo_(rol);
  if (permiso && !perfil[permiso]) throw new Error('ACCESO_DENEGADO: Esta acción corresponde al perfil ' + (permiso === 'data' ? 'Data' : 'interno de Procura') + '.');
  return perfil;
}

function pamEmbudoDemo_(id) {
  var embudo = PAM_EMBUDOS_DEMO_.find(function(e) { return e.id === id; });
  if (!embudo) throw new Error('Selecciona el embudo de prueba. El nombre se completa automáticamente.');
  return embudo;
}

function pamAsignacionDemo_(o, datos) {
  var embudo = pamEmbudoDemo_(datos.embudo_demo);
  o.ASESORA = embudo.nombre;
  o.EMBUDO_ORIGEN = embudo.nombre;
  o.ORIGEN = 'DEMO';
  o.CONFIRMACION_VENTAS = o.CONFIRMACION_VENTAS || '';
  // Los IDs demo no se utilizan como IDs reales de Kommo.
  o.KOMMO_ESTADO = o.KOMMO_ESTADO === 'DEMO_DISPONIBLE' ? o.KOMMO_ESTADO : 'DEMO_PAM';
}

function pamComercial_(p) {
  // Lista explícita de campos. Ni proveedor, ni costo, ni notas internas viajan a Ventas.
  return {
    id: p.id, lead_id: p.lead_id, fecha: p.fecha, actualizado: p.actualizado, asesora: p.asesora,
    cliente: p.cliente, ultimos_4: p.ultimos_4, prioridad: p.prioridad, item: p.item, cant: p.cant,
    etapa: p.etapa, codigo_maestro: p.codigo_maestro, version: p.version, embudo_origen: p.embudo_origen,
    pipeline_id: p.pipeline_id, grupo: p.grupo, estado_cliente: p.estado_cliente,
    confirmado: p.confirmado, fecha_confirmacion: p.fecha_confirmacion
  };
}

function pamEsMiEmbudoDemo_(o, datos) {
  var embudo = pamEmbudoDemo_(datos.embudo_demo);
  if (String(o.EMBUDO_ORIGEN || o.ASESORA).toUpperCase() !== embudo.nombre) {
    throw new Error('En la vista de Ventas solo puedes modificar o confirmar las solicitudes de tu embudo de prueba.');
  }
}

function moverLeadDisponibleDemoPAM(datos, rol) {
  pamExigirDemo_(rol, 'data');
  return pamConBloqueo_(function() {
    datos = datos || {};
    var hojas = pamPreparar_(pamLibro_());
    var principal = pamBuscar_(hojas.solicitudes, pamTexto_(datos.id, 100));
    if (!principal) throw new Error('Solicitud no encontrada.');
    var o = principal.objeto;
    var registros = pamFilas_(hojas.solicitudes, PAM_COLUMNAS_.length).map(function(f, i) {
      return { fila: i + 2, objeto: pamObjeto_(f) };
    }).filter(function(r) {
      return o.ID_LEAD_KOMMO ? String(r.objeto.ID_LEAD_KOMMO) === String(o.ID_LEAD_KOMMO) : r.objeto.ID_PAM === o.ID_PAM;
    });
    var catalogo = pamFilas_(hojas.catalogo, 19);
    registros.forEach(function(r) {
      if (r.objeto.ETAPA_PAM !== 'DISPONIBLE') throw new Error('El cliente todavía tiene productos pendientes de Procura o Data.');
      if (!catalogo.some(function(f) { return String(f[16]) === r.objeto.ID_PAM && String(pamLeerCelda_(f[0])) === r.objeto.CODIGO_MAESTRO; })) {
        throw new Error('Falta comprobar la publicación de uno de los productos en el catálogo de prueba.');
      }
    });
    var pendientes = pamFilas_(hojas.operaciones, 8);
    if (registros.some(function(r) { return pendientes.some(function(op) { return op[2] === r.objeto.ID_PAM && op[4] === 'PENDIENTE'; }); })) {
      throw new Error('Primero confirma los envíos pendientes de este cliente.');
    }
    var fecha = new Date().toISOString();
    registros.forEach(function(r) {
      if (r.objeto.KOMMO_ESTADO === 'DEMO_DISPONIBLE') return;
      r.objeto.KOMMO_ESTADO = 'DEMO_DISPONIBLE';
      r.objeto.FECHA_ACTUALIZACION = fecha;
      r.objeto.VERSION++;
      hojas.solicitudes.getRange(r.fila, 1, 1, PAM_COLUMNAS_.length).setValues([pamFilaObjeto_(r.objeto)]);
    });
    SpreadsheetApp.flush();
    var op = 'DEMO-DISPONIBLE-' + o.ID_PAM;
    if (!pamFilas_(hojas.eventos, 7).some(function(f) { return f[0] === op; })) {
      hojas.eventos.getRange(hojas.eventos.getLastRow() + 1, 1, 1, 7).setValues([[
        op,fecha,o.ID_PAM,'DEMO_YA_DISPONIBLE','PAM','YA_DISPONIBLE','Demo · Data'
      ]]);
    }
    return { exito: true, id: o.ID_PAM, simulado: true, productos: registros.length };
  });
}
