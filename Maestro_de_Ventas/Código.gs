// ========================================================
// PROYECTO PRINCIPAL: MAESTRO DE PRODUCTOS & VENTAS
// RODAINDUSTRIA MARACAY C.A.
// ========================================================

function obtenerLibroCentral_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function doGet(e) {
  if (e && e.parameter && (e.parameter.state || e.parameter.code || e.parameter.error)) return rimCallbackOAuth_(e);
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('Maestro de Productos · Rodaindustria Maracay')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ========================================================
// CONSULTA AUTOMÁTICA DE TASA OFICIAL BCV
// ========================================================
function obtenerTasaBCVOficial() {
  var cache = CacheService.getScriptCache();
  var tasaCacheada = cache.get("TASA_BCV_HOY");
  if (tasaCacheada) {
    return { exito: true, tasa: parseFloat(tasaCacheada), origen: "cache" };
  }

  var urlOficial = "https://ve.dolarapi.com/v1/dolares/oficial";

  try {
    var resp = UrlFetchApp.fetch(urlOficial, { 
      muteHttpExceptions: true, 
      timeout: 4000,
      headers: { "Accept": "application/json" }
    });
    
    if (resp.getResponseCode() === 200) {
      var json = JSON.parse(resp.getContentText());
      var tasa = null;

      if (json.promedio) {
        tasa = parseFloat(json.promedio);
      } else if (json.price) {
        tasa = parseFloat(json.price);
      }

      if (tasa && !isNaN(tasa) && tasa > 0) {
        // Cachear por 1 hora (3600 s)
        cache.put("TASA_BCV_HOY", tasa.toString(), 3600);
        return { exito: true, tasa: tasa, origen: "api" };
      }
    }
  } catch (e) {
    Logger.log("Fallo consulta BCV en " + urlOficial + ": " + e.toString());
  }

  return { exito: false, tasa: null, error: "No se pudo consultar el servicio externo" };
}

// ========================================================
// LECTURA DE CATÁLOGO / INVENTARIO
// ========================================================
function obtenerInventario() {
  try {
    var libro = obtenerLibroCentral_();
    var hoja = libro.getSheetByName("Productos");
    if (!hoja) throw new Error("No existe la hoja Productos");
    var datos = hoja.getDataRange().getValues();

    if (datos.length <= 1) return [];

    var headers = datos[0].map(function(h) { return String(h || "").trim().toUpperCase(); });

    function col(nombre, defecto) {
      for (var c = 0; c < headers.length; c++) {
        if (headers[c].indexOf(nombre) !== -1) return c;
      }
      return defecto;
    }

    var cMaracay = col("MARACAY", 7);
    var cTigre   = col("TIGRE", 8);
    var cBqto    = col("BARQUISIMETO", 9);
    var cOrig    = col("ORIGINAL", 15);

    var plazosPorProveedor = ventasLeerPlazosProveedores_(libro);
    var lista = [];
    for (var i = 1; i < datos.length; i++) {
      var f = datos[i];
      var itemCodigo = String(f[0] || "").trim();
      if (!itemCodigo) continue;

      function n(v) {
        if (typeof v === 'number') return v;
        var m = String(v || "").match(/[-+]?[0-9]+([.,][0-9]+)?/);
        return m ? parseFloat(m[0].replace(",", ".")) : 0;
      }

      var valOrig = f[cOrig];
      var esOriginal = (valOrig === true || String(valOrig).toUpperCase() === 'TRUE' || String(valOrig).toUpperCase() === 'SI' || valOrig === 1);

      lista.push({
        item: itemCodigo,
        marca: String(f[1] || ""),
        med_interna: f[2] == null || String(f[2]).trim() === '' ? null : n(f[2]),
        med_externa: f[3] == null || String(f[3]).trim() === '' ? null : n(f[3]),
        ancho: f[4] == null || String(f[4]).trim() === '' ? null : n(f[4]),
        otras_ref: String(f[5] || ""),
        descripcion: String(f[6] || ""),
        stock_maracay: n(f[cMaracay]),
        stock_el_tigre: n(f[cTigre]),
        stock_barquisimeto: n(f[cBqto]),
        precio_bcv: n(f[10]),
        precio_divisa: n(f[11]),
        bcv_detal: n(f[12]),
        divisa_detal: n(f[13]),
        prv: String(f[14] || "PRV"),
        tiempos_entrega: plazosPorProveedor[ventasClaveProveedor_(f[14])] || { maracay: '', elTigre: '', barquisimeto: '' },
        es_original: esOriginal
      });
    }

    return lista;
  } catch (error) {
    throw new Error('No se pudo leer el inventario. Revisa la hoja Productos y vuelve a intentar.');
  }
}

// ========================================================
// REGISTRO DE COTIZACIONES Y FOLIO CORRELATIVO
// ========================================================
// ========================================================
// REGISTRO DE REQUERIMIENTOS / PEDIDOS PARA COMPRAS (19 COLUMNAS)
// ========================================================
function registrarSolicitudPedido_(datos) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
    var libro = obtenerLibroCentral_(), hoja = libro.getSheetByName('Solicitudes_Pedidos');
    if (!hoja) hoja = libro.insertSheet('Solicitudes_Pedidos');
    if (hoja.getLastRow() === 0) {
      hoja.appendRow(['NRO_TICKET','ID_ITEM','FECHA_HORA','SUCURSAL_ORIGEN','RESPONSABLE','SUCURSAL_ENTREGA','CLIENTE','ESTATUS_PAGO','ITEM_CODIGO','MARCA','PROVEEDOR_ORIGEN','DESCRIPCION','STOCK_MARACAY','STOCK_TIGRE','STOCK_BQTO','CANTIDAD_SOLICITADA','URGENCIA','OBSERVACION_MOTIVO','ESTADO']);
      hoja.getRange(1,1,1,19).setFontWeight('bold').setBackground('#eeeeee');
    }
    // Reservar el recibo ANTES de escribir el pedido permite recuperarse de una
    // interrupción entre ambas escrituras, conservando las 19 columnas de compras.
    var recibos = libro.getSheetByName('RIM_Envios_Pedidos');
    if (!recibos) { recibos = libro.insertSheet('RIM_Envios_Pedidos'); recibos.appendRow(['ID_SOLICITUD','EMAIL','TICKET','FECHA','ESTADO_ENVIO','FILAS_JSON']); }
    var registros = recibos.getLastRow() > 1 ? recibos.getRange(2,1,recibos.getLastRow()-1,6).getValues() : [];
    var activos = hoja.getLastRow() > 1 ? hoja.getRange(2,1,hoja.getLastRow()-1,19).getValues() : [];
    var historico = libro.getSheetByName('Historico_Pedidos');
    var archivados = historico && historico.getLastRow() > 1 ? historico.getRange(2,1,historico.getLastRow()-1,1).getValues() : [];
    var nroTicket, filas, filaRecibo, repetido = false;
    for (var r = 0; r < registros.length; r++) {
      if (registros[r][0] === datos.requestId && registros[r][1] === datos.email) {
        nroTicket = String(registros[r][2]); filaRecibo = r + 2; repetido = true;
        var registrado = registros[r][4] === 'CONFIRMADO' || activos.some(function(f) { return String(f[0]) === nroTicket; }) || archivados.some(function(f) { return String(f[0]) === nroTicket; });
        if (registrado) {
          recibos.getRange(filaRecibo,5,1,1).setValues([['CONFIRMADO']]);
          SpreadsheetApp.flush();
          return { exito: true, ticket: nroTicket, repetido: true };
        }
        filas = JSON.parse(String(registros[r][5]));
        if (!Array.isArray(filas) || !filas.length) throw new Error('No se pudo recuperar el envío pendiente. Conserva el recibo y solicita revisión.');
        // JSON serializa fechas como texto: restaurar el tipo Date esperado por compras.
        filas.forEach(function(f) { f[2] = new Date(f[2]); });
        break;
      }
    }
    if (!nroTicket) {
      var max = 0;
      activos.concat(archivados).forEach(function(f) { var m = String(f[0]).match(/^TCK-(\d+)$/); if (m) max = Math.max(max, Number(m[1])); });
      registros.forEach(function(f) { var m = String(f[2]).match(/^TCK-(\d+)$/); if (m) max = Math.max(max, Number(m[1])); });
      nroTicket = 'TCK-' + String(max + 1).padStart(5,'0');
      var fecha = new Date();
      filas = datos.items.map(function(it,i) {
        return [nroTicket,nroTicket+'-'+(i+1),fecha,datos.sucursal_origen,datos.responsable,datos.sucursal_entrega,datos.cliente,datos.estatus_pago,it.item,it.marca,it.prv,it.descripcion,it.stock_maracay,it.stock_el_tigre,it.stock_barquisimeto,it.cant,datos.urgencia,datos.motivo,'PENDIENTE'];
      });
      var json = JSON.stringify(filas);
      if (json.length > 45000) throw new Error('DATOS_INVALIDOS: El pedido es demasiado extenso. Divídelo en dos solicitudes.');
      recibos.appendRow([datos.requestId,datos.email,nroTicket,fecha,'PENDIENTE',json]);
      filaRecibo = recibos.getLastRow();
      SpreadsheetApp.flush();
    }
    hoja.getRange(hoja.getLastRow()+1,1,filas.length,19).setValues(filas);
    SpreadsheetApp.flush();
    recibos.getRange(filaRecibo,5,1,1).setValues([['CONFIRMADO']]);
    SpreadsheetApp.flush();
    return { exito: true, ticket: nroTicket, totalItems: filas.length, repetido: repetido };
  } catch (e) {
    return { exito: false, error: String(e.message || e), definitivo: /DATOS_INVALIDOS:/.test(String(e.message || e)) };
  } finally { lock.releaseLock(); }
}

// ========================================================
// SEGUIMIENTO DE TICKETS EN VIVO PARA VENTAS Y NOTIFICACIONES
// ========================================================
function obtenerComentariosYEstadoTickets_(solicitanteOpcional) {
  try {
    var libro = SpreadsheetApp.getActiveSpreadsheet();
    var hojaPedidos = libro.getSheetByName("Solicitudes_Pedidos");
    var hojaHistorico = libro.getSheetByName("Historico_Pedidos");
    var hojaComentarios = libro.getSheetByName("Comentarios_Tickets");

    var ticketsMap = {};

    function mapearPedidos(hoja, esHist) {
      if (!hoja || hoja.getLastRow() <= 1) return;
      var data = hoja.getDataRange().getValues();

      for (var i = 1; i < data.length; i++) {
        var row = data[i];
        var nro = String(row[0] || "").trim();
        if (!nro) continue;

        var solicitante = String(row[4] || "").trim();

        // Si se pasa solicitante específico (y no es vacío ni TODOS), filtramos por su nombre
        if (solicitanteOpcional && solicitanteOpcional.trim() !== "" && solicitanteOpcional.trim().toUpperCase() !== "TODOS") {
          if (solicitante.toUpperCase() !== solicitanteOpcional.trim().toUpperCase()) continue;
        }

        if (!ticketsMap[nro]) {
          var fVal = row[2];
          var fStr = (fVal instanceof Date) 
            ? Utilities.formatDate(fVal, Session.getScriptTimeZone() || "GMT-4", "dd/MM/yyyy HH:mm") 
            : String(fVal || "");

          ticketsMap[nro] = {
            ticket: nro,
            fecha: fStr,
            sucursal_origen: String(row[3] || ""),
            responsable: solicitante,
            sucursal_entrega: String(row[5] || ""),
            cliente: String(row[6] || ""),
            estatus_pago: String(row[7] || "PAGADO"),
            estado: esHist ? "DESPACHADO_CONFORME" : String(row[18] || "PENDIENTE"),
            items: []
          };
        }

        // Datos del ítem sin revelar proveedor interno a ventas
        ticketsMap[nro].items.push({
          item: String(row[8] || ""),
          marca: String(row[9] || ""),
          cant: parseInt(row[15], 10) || 1
        });
      }
    }

    mapearPedidos(hojaPedidos, false);
    mapearPedidos(hojaHistorico, true);

    // Lectura del hilo de comentarios
    var comentariosArr = [];
    if (hojaComentarios && hojaComentarios.getLastRow() > 1) {
      var cData = hojaComentarios.getDataRange().getValues();
      for (var j = 1; j < cData.length; j++) {
        var cRow = cData[j];
        var tId = String(cRow[1] || "").trim();

        var fcVal = cRow[2];
        var fcStr = (fcVal instanceof Date) 
          ? Utilities.formatDate(fcVal, Session.getScriptTimeZone() || "GMT-4", "dd/MM/yyyy HH:mm") 
          : String(fcVal || "");

        comentariosArr.push({
          id: String(cRow[0] || ""),
          ticket: tId,
          fecha: fcStr,
          autor: String(cRow[3] || "Usuario"),
          rol: String(cRow[4] || "Ventas"),
          mensaje: String(cRow[5] || "")
        });
      }
    }

    return {
      exito: true,
      tickets: Object.values(ticketsMap).reverse(),
      comentarios: comentariosArr
    };
  } catch (err) {
    Logger.log("Error en obtenerComentariosYEstadoTickets: " + err.toString());
    return { exito: false, error: err.toString(), tickets: [], comentarios: [] };
  }
}

// ========================================================
// AGREGAR COMENTARIO AL CHAT / BITÁCORA DEL TICKET
// ========================================================
function agregarComentarioTicket_(datos) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(8000);
    var libro = obtenerLibroCentral_();
    var hojaComentarios = libro.getSheetByName("Comentarios_Tickets");

    // Auto-creación de la pestaña si aún no existe
    if (!hojaComentarios) {
      hojaComentarios = libro.insertSheet("Comentarios_Tickets");
      hojaComentarios.appendRow(["ID_COMENTARIO", "NRO_TICKET", "FECHA_HORA", "AUTOR", "ROL", "MENSAJE"]);
      hojaComentarios.getRange(1, 1, 1, 6).setFontWeight("bold").setBackground("#e2e8f0");
    }

    var nroTicket = String(datos.ticket || "").trim();
    var autor = String(datos.autor || "Vendedora").trim();
    var rol = String(datos.rol || "Ventas").trim();
    var mensaje = String(datos.mensaje || "").trim();

    if (!nroTicket || !mensaje) {
      return { exito: false, error: "Datos incompletos" };
    }

    var idComentario = "CMT-" + Date.now();
    var fechaActual = new Date();

    hojaComentarios.appendRow([
      idComentario,
      nroTicket,
      fechaActual,
      autor,
      rol,
      mensaje
    ]);

    var fechaStr = Utilities.formatDate(fechaActual, Session.getScriptTimeZone() || "GMT-4", "dd/MM/yyyy HH:mm");

    return {
      exito: true,
      comentario: {
        id: idComentario,
        ticket: nroTicket,
        fecha: fechaStr,
        autor: autor,
        rol: rol,
        mensaje: mensaje
      }
    };
  } catch (err) {
    Logger.log("Error al agregar comentario: " + err.toString());
    return { exito: false, error: err.toString() };
  } finally {
    lock.releaseLock();
  }
}

// ========================================================
// ASISTENTE DE IA GEMINI EN BACKEND (FOTOS, PDFS Y EXCEL)
// ========================================================
function analizarConGeminiBackend_(datos) {
  try {
    var apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') || '';
    
    if (!apiKey || apiKey.trim() === "") {
      return { exito: false, error: "No se ha configurado una clave API de Gemini" };
    }

    var modelo = datos.modelo || "gemini-3-flash-preview";
    var promptInstruccion = "Eres un asistente de repuestos automotrices e industriales de Rodaindustria Maracay. " +
      "Lee la imagen o documento adjunto con precisión y extrae TODOS los repuestos, rodamientos, medidas y marcas que contenga, con su cantidad solicitada. " +
      "Devuelve ÚNICAMENTE un array JSON válido con la estructura exacta: [{\"item\":\"codigo_o_descripcion\",\"cant\":1,\"marca\":\"opcional\"}]. " +
      "No agregues texto explicativo ni formato Markdown adicional, solo el JSON puro.";

    var contentsParts = [];

    if (datos.esTabTexto) {
      contentsParts.push({ text: promptInstruccion + "\n\nTexto recibido:\n" + (datos.texto || "") });
    } else if (datos.contenidoExcel) {
      contentsParts.push({ text: promptInstruccion + "\n\nContenido CSV de Excel:\n" + datos.contenidoExcel });
    } else if (datos.base64Data) {
      contentsParts.push({
        inline_data: {
          mime_type: datos.mimeType || "image/png",
          data: datos.base64Data
        }
      });
      contentsParts.push({ text: promptInstruccion });
    } else {
      return { exito: false, error: "No se proporcionó archivo para analizar" };
    }

    // Exclusivamente modelos de Generación 3 vigentes
    var modelosProbar = [modelo, "gemini-3-flash-preview", "gemini-3.1-pro-preview"];
    var ultimoError = "";

    for (var m = 0; m < modelosProbar.length; m++) {
      var mod = modelosProbar[m];
      var url = "https://generativelanguage.googleapis.com/v1beta/models/" + mod + ":generateContent?key=" + encodeURIComponent(apiKey);
      
      var options = {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify({ contents: [{ parts: contentsParts }] }),
        headers: {
          "x-goog-api-key": apiKey
        },
        muteHttpExceptions: true
      };

      try {
        var response = UrlFetchApp.fetch(url, options);
        var code = response.getResponseCode();
        var respText = response.getContentText();

        if (code === 200) {
          var resJson = JSON.parse(respText);
          if (resJson.candidates && resJson.candidates[0] && resJson.candidates[0].content && resJson.candidates[0].content.parts) {
            var rawText = resJson.candidates[0].content.parts[0].text;
            var limpio = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
            var items = JSON.parse(limpio);
            if (Array.isArray(items) && items.length > 0) {
              return { exito: true, items: items };
            }
          }
        } else {
          ultimoError = "HTTP " + code + ": " + respText;
          Logger.log("Error con modelo " + mod + ": " + ultimoError);
        }
      } catch (errLoop) {
        ultimoError = errLoop.toString();
        Logger.log("Excepción probando modelo " + mod + ": " + ultimoError);
      }
    }

    return { exito: false, error: ultimoError || "No se pudo interpretar la respuesta de Gemini" };
  } catch (e) {
    Logger.log("Error general en analizarConGeminiBackend: " + e.toString());
    return { exito: false, error: e.toString() };
  }
}
// Solo lectura: el catálogo público recibe plazos, no contactos ni nombres reales.
function ventasClaveProveedor_(valor) {
  return String(valor || '').trim().toUpperCase().replace(/[\u2010-\u2015]/g, '-');
}
function ventasLeerPlazosProveedores_(libro) {
  var hoja = libro.getSheetByName('Leyenda_Proveedores') || libro.getSheetByName('Leyenda de proveedores');
  if (!hoja || hoja.getLastRow() < 2) return {};
  // No se leen las columnas G:H de rubros/contactos.
  var filas = hoja.getRange(1, 1, hoja.getLastRow(), 6).getValues();
  function cabecera(v) { return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  var encabezados = filas[0].map(cabecera);
  function columna(prueba, defecto) { for (var i=0;i<encabezados.length;i++) if(prueba(encabezados[i])) return i; return defecto; }
  var codigo = columna(function(h){return h.indexOf('CODIGO')>=0;}, 1);
  var maracay = columna(function(h){return h.indexOf('MARACAY')>=0;}, 3);
  var tigre = columna(function(h){return h.indexOf('TIGRE')>=0;}, 4);
  var bqto = columna(function(h){return h.indexOf('BARQUISIMETO')>=0;}, 5);
  var mapa = Object.create(null);
  for (var i=1;i<filas.length;i++) {
    var fila=filas[i],clave=ventasClaveProveedor_(fila[codigo]);if(!clave)continue;
    // Un código duplicado no debe mostrar el plazo arbitrario de uno de ellos.
    if(Object.prototype.hasOwnProperty.call(mapa,clave)){mapa[clave]={maracay:'',elTigre:'',barquisimeto:''};continue;}
    function texto(v) { return v == null ? '' : String(v).trim(); }
    mapa[clave]={maracay:texto(fila[maracay]),elTigre:texto(fila[tigre]),barquisimeto:texto(fila[bqto])};
  }
  return mapa;
}

// Conserva la utilidad de autorización incorporada durante la instalación de Ventas.
function autorizarServiciosRIM() {
  var respuesta = UrlFetchApp.fetch('https://accounts.google.com/.well-known/openid-configuration');
  Logger.log('Conexión con Google: HTTP ' + respuesta.getResponseCode());
}
