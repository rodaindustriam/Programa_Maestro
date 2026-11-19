// ========================================================
// PROYECTO INDEPENDIENTE: PANEL DE COMPRAS & REABASTECIMIENTO
// RODAINDUSTRIA MARACAY C.A.
// ========================================================

// ID DE LA HOJA DE CÁLCULO CENTRAL (DONDE SE ENCUENTRAN Solicitudes_Pedidos y Comentarios_Tickets)
// Coloca aquí el ID de tu Google Sheet:
const SPREADSHEET_ID_CENTRAL = "TU_ID_AQUI"; 

function obtenerLibroCentral_() {
  if (SPREADSHEET_ID_CENTRAL && SPREADSHEET_ID_CENTRAL.trim() !== "" && SPREADSHEET_ID_CENTRAL !== "TU_ID_AQUI") {
    return SpreadsheetApp.openById(SPREADSHEET_ID_CENTRAL.trim());
  }
  return SpreadsheetApp.getActiveSpreadsheet();
}

function doGet(e) {
  if (e && e.parameter && (e.parameter.state || e.parameter.code || e.parameter.error)) return comprasCallbackOAuth_(e);
  return HtmlService.createHtmlOutputFromFile('Compras')
    .setTitle('Panel de Compras & Reabastecimiento · Rodaindustria Maracay')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ========================================================
// 1. LECTURA DE SOLICITUDES ACTIVAS E HISTÓRICO (19 COLUMNAS)
// ========================================================
// ========================================================
// 1.1 LEYENDA DE PROVEEDORES, RUBROS Y TIEMPOS DE ENTREGA
// ========================================================
function obtenerProveedores_() {
  try {
    var libro = obtenerLibroCentral_();
    var hoja = libro.getSheetByName("Leyenda_Proveedores") || libro.getSheetByName("Leyenda de proveedores");
    if (!hoja || hoja.getLastRow() <= 1) {
      return { exito: true, proveedores: [] };
    }

    var valores = hoja.getDataRange().getValues();
    var proveedores = [];

    for (var i = 1; i < valores.length; i++) {
      var fila = valores[i];
      var nombreReal = String(fila[0] || "").trim();
      var codigo = String(fila[1] || "").trim().toUpperCase();
      if (!nombreReal && !codigo) continue;

      var rubrosRaw = String(fila[6] || "").trim();
      var rubrosArr = rubrosRaw ? rubrosRaw.split(",").map(function(r) { return r.trim(); }).filter(Boolean) : [];

      proveedores.push({
        fila: i + 1,
        nombre: nombreReal || codigo,
        codigo: codigo,
        origen: String(fila[2] || "Venezuela"),
        tiempo_maracay: String(fila[3] || "1 día"),
        tiempo_el_tigre: String(fila[4] || "1-2 días"),
        tiempo_barquisimeto: String(fila[5] || "1-2 días"),
        rubros: rubrosArr,
        contacto: String(fila[7] || "")
      });
    }

    return { exito: true, proveedores: proveedores };
  } catch (err) {
    Logger.log("Error en obtenerProveedores: " + err.toString());
    return { exito: false, error: err.toString(), proveedores: [] };
  }
}

function guardarDatosProveedorCompleto_(datos) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(12000);
    var libro = obtenerLibroCentral_();
    var hoja = libro.getSheetByName("Leyenda_Proveedores") || libro.getSheetByName("Leyenda de proveedores");

    if (!hoja) {
      hoja = libro.insertSheet("Leyenda_Proveedores");
      hoja.appendRow([
        "Proveedor Real", "CODIGO NUEVO", "ciudad/origen", 
        "tiempo entrega Maracay", "Tiempo de entrega El tigre", "Tiempo de entrega Barquisimeto", 
        "RUBROS", "CONTACTO"
      ]);
      hoja.getRange(1, 1, 1, 8).setFontWeight("bold").setBackground("#e2e8f0");
    }

    // Asegurar encabezados hasta la columna H
    var headers = hoja.getRange(1, 1, 1, Math.max(hoja.getLastColumn(), 8)).getValues()[0];
    if (!headers[6] || String(headers[6]).trim() === "") hoja.getRange(1, 7).setValue("RUBROS").setFontWeight("bold");
    if (!headers[7] || String(headers[7]).trim() === "") hoja.getRange(1, 8).setValue("CONTACTO").setFontWeight("bold");

    var nombreReal = String(datos.nombre || "").trim();
    var codigo = String(datos.codigo || "").trim().toUpperCase();
    var origen = String(datos.origen || "").trim();
    var tMaracay = String(datos.tiempo_maracay || "").trim();
    var tTigre = String(datos.tiempo_el_tigre || "").trim();
    var tBqto = String(datos.tiempo_barquisimeto || "").trim();
    var rubrosStr = Array.isArray(datos.rubros) ? datos.rubros.join(", ") : String(datos.rubros || "");
    var contacto = String(datos.contacto || "").trim();

    if (!codigo || !nombreReal) {
      return { exito: false, error: "El Nombre y el Código PRV son obligatorios" };
    }

    var valores = hoja.getDataRange().getValues();
    var filaExistente = -1;
    var codigoOriginal = String(datos.codigoOriginal || codigo).trim().toUpperCase();

    for (var i = 1; i < valores.length; i++) {
      if (String(valores[i][1] || "").trim().toUpperCase() === codigoOriginal) {
        filaExistente = i + 1;
        break;
      }
    }

    var filaData = [nombreReal, codigo, origen, tMaracay, tTigre, tBqto, rubrosStr, contacto];

    if (filaExistente !== -1) {
      // Edición de proveedor existente
      hoja.getRange(filaExistente, 1, 1, 8).setValues([filaData]);
    } else {
      // Alta de nuevo proveedor
      hoja.appendRow(filaData);
    }

    return { 
      exito: true, 
      proveedor: {
        nombre: nombreReal,
        codigo: codigo,
        origen: origen,
        tiempo_maracay: tMaracay,
        tiempo_el_tigre: tTigre,
        tiempo_barquisimeto: tBqto,
        rubros: rubrosStr ? rubrosStr.split(",").map(function(s){return s.trim();}).filter(Boolean) : [],
        contacto: contacto
      }
    };
  } catch (err) {
    Logger.log("Error al guardar proveedor: " + err.toString());
    return { exito: false, error: err.toString() };
  } finally {
    lock.releaseLock();
  }
}

function guardarRubrosProveedor_(codigoPrv, rubrosArray) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var libro = obtenerLibroCentral_();
    var hoja = libro.getSheetByName("Leyenda_Proveedores") || libro.getSheetByName("Leyenda de proveedores");
    if (!hoja) return { exito: false, error: "Hoja de proveedores no encontrada" };

    var data = hoja.getDataRange().getValues();
    var codigoBuscado = String(codigoPrv || "").trim().toUpperCase();
    var targetRow = -1;

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][1] || "").trim().toUpperCase() === codigoBuscado) {
        targetRow = i + 1;
        break;
      }
    }

    if (targetRow === -1) {
      return { exito: false, error: "Proveedor no encontrado" };
    }

    // Asegurar encabezado de Rubros en la columna G (col 7)
    if (hoja.getRange(1, 7).getValue() === "") {
      hoja.getRange(1, 7).setValue("RUBROS").setFontWeight("bold");
    }

    var rubrosStr = Array.isArray(rubrosArray) ? rubrosArray.join(", ") : String(rubrosArray || "");
    hoja.getRange(targetRow, 7).setValue(rubrosStr);

    return { exito: true, codigo: codigoPrv, rubros: rubrosStr };
  } catch (err) {
    Logger.log("Error al guardar rubros: " + err.toString());
    return { exito: false, error: err.toString() };
  } finally {
    lock.releaseLock();
  }
}

// ========================================================
// 2. SISTEMA DE COMENTARIOS / NOTAS POR TICKET (CHAT)
// ========================================================
function obtenerComentariosYEstadoTickets_(solicitanteOpcional) {
  try {
    var libro = obtenerLibroCentral_();
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

        if (solicitanteOpcional && solicitanteOpcional.trim() !== "") {
          if (solicitante.toUpperCase() !== solicitanteOpcional.trim().toUpperCase()) continue;
        }

        if (!ticketsMap[nro]) {
          var fVal = row[2];
          var fStr = (fVal instanceof Date) ? Utilities.formatDate(fVal, Session.getScriptTimeZone() || "GMT-4", "dd/MM/yyyy HH:mm") : String(fVal || "");
          ticketsMap[nro] = {
            ticket: nro,
            fecha: fStr,
            sucursal_origen: String(row[3] || ""),
            responsable: solicitante,
            sucursal_entrega: String(row[5] || ""),
            cliente: String(row[6] || ""),
            estado: esHist ? "DESPACHADO_CONFORME" : String(row[18] || "PENDIENTE"),
            items: []
          };
        }
        ticketsMap[nro].items.push({
          item: String(row[8] || ""),
          marca: String(row[9] || ""),
          cant: parseInt(row[15], 10) || 1
        });
      }
    }

    mapearPedidos(hojaPedidos, false);
    mapearPedidos(hojaHistorico, true);

    var comentariosArr = [];
    if (hojaComentarios && hojaComentarios.getLastRow() > 1) {
      var cData = hojaComentarios.getDataRange().getValues();
      for (var j = 1; j < cData.length; j++) {
        var cRow = cData[j];
        var tId = String(cRow[1] || "").trim();
        if (!solicitanteOpcional || ticketsMap[tId]) {
          var fcVal = cRow[2];
          var fcStr = (fcVal instanceof Date) ? Utilities.formatDate(fcVal, Session.getScriptTimeZone() || "GMT-4", "dd/MM/yyyy HH:mm") : String(fcVal || "");
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

function agregarComentarioTicket_(datos) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(8000);
    var libro = obtenerLibroCentral_();
    var hojaComentarios = libro.getSheetByName("Comentarios_Tickets");

    if (!hojaComentarios) {
      hojaComentarios = libro.insertSheet("Comentarios_Tickets");
      hojaComentarios.appendRow(["ID_COMENTARIO", "NRO_TICKET", "FECHA_HORA", "AUTOR", "ROL", "MENSAJE"]);
      hojaComentarios.getRange(1, 1, 1, 6).setFontWeight("bold").setBackground("#e2e8f0");
    }

    var nroTicket = String(datos.ticket || "").trim();
    var autor = String(datos.autor || "Compras").trim();
    var rol = String(datos.rol || "Compras").trim();
    var mensaje = String(datos.mensaje || "").trim();

    if (!nroTicket || !mensaje) {
      return { exito: false, error: "Ticket o mensaje no proporcionado" };
    }

    var idComentario = "CMT-" + Utilities.getUuid();
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
// 3. ACTUALIZAR ESTADO DE UN TICKET EN EL KANBAN
// ========================================================
// Las operaciones de estado y archivo se implementan en GestionCompras.gs.
