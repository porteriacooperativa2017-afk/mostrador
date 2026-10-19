/**
 * Integración del portal de socios y del control de entregas.
 *
 * procesarFormularioSocios es llamada por el formulario HTML mediante
 * google.script.run. doPost recibe las entregas de server.js.
 * Para doPost, crear VALE_API_TOKEN en las propiedades del script, desplegar
 * como aplicación web ejecutada como propietario y definir REGISTRO_WRITE_URL
 * y REGISTRO_API_TOKEN en el entorno de Node.js.
 */
var VALE_API_VERSION = '2026-10-17-tiempo-espera-6';

function doGet() {
  return HtmlService.createHtmlOutputFromFile('FormularioSocios')
    .setTitle('Portal de Socios - Autorización de Retiro')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  try {
    var payload = JSON.parse(e && e.postData && e.postData.contents || '{}');
    var expectedToken = PropertiesService.getScriptProperties().getProperty('VALE_API_TOKEN');
    if (!expectedToken || payload.apiToken !== expectedToken) {
      return jsonResponse({ ok: false, error: 'No autorizado.' });
    }
    if (payload.action === 'verificarConexion') {
      return jsonResponse({ ok: true, version: VALE_API_VERSION });
    }
    if (payload.action !== 'registrarEntrega') {
      return jsonResponse({ ok: false, error: 'Acción no válida.' });
    }

    var result = registrarEntregaMostrador(
      payload.codigoFarmacia,
      payload.persona,
      payload.cantidadPedidos,
      payload.operarioLogueado,
      payload.inicioEspera
    );
    return jsonResponse({
      ok: true,
      estado: result.estado,
      mensaje: result.mensaje,
      persona: result.persona,
      farmacia: result.farmacia,
      tiempoEspera: result.tiempoEspera,
      avisoCorreo: result.avisoCorreo
    });
  } catch (error) {
    return jsonResponse({ ok: false, error: String(error && error.message || error) });
  }
}

function jsonResponse(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function procesarFormularioSocios(datos) {
  try {
    if (!datos || typeof datos !== 'object') {
      throw new Error('No se recibieron los datos del formulario.');
    }

    var email = String(datos.email || '').trim();
    var farmacia = String(datos.farmacia || '').trim();
    var codigo = String(datos.codigo || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('Ingresa una dirección de correo electrónico válida.');
    }
    if (!farmacia) throw new Error('Ingresa el nombre de la farmacia.');
    if (!/^\d+$/.test(codigo)) throw new Error('El código de farmacia debe contener solo números.');

    var personas = [];
    var dnis = [];
    for (var i = 1; i <= 6; i++) {
      var persona = String(datos['p' + i] || '').trim();
      var dniOriginal = String(datos['dni' + i] || '').trim();
      var dni = soloDigitos(dniOriginal);
      if (persona && (!dni || !/^[\d\s.-]+$/.test(dniOriginal))) {
        throw new Error('Completa el DNI con números para el personal autorizado ' + i + '.');
      }
      if (!persona && dni) {
        throw new Error('Completa el nombre del personal autorizado ' + i + ' o deja su DNI vacío.');
      }
      personas.push(persona);
      dnis.push(dni);
    }
    if (!personas.some(function(persona) { return Boolean(persona); })) {
      throw new Error('Ingresa al menos una persona autorizada con su DNI.');
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var hoja = ss.getSheetByName('Respuestas de formulario 1');
    if (!hoja) throw new Error('No existe la pestaña "Respuestas de formulario 1".');

    // La hoja usa A:D para los datos de la farmacia, E:J para los nombres,
    // K como separador y L:Q para los DNIs 1:6.
    var fila = new Array(17).fill('');
    fila[0] = new Date();
    fila[1] = email;
    fila[2] = farmacia;
    fila[3] = codigo;
    for (var j = 0; j < 6; j++) {
      fila[4 + j] = personas[j];
      fila[11 + j] = dnis[j];
    }
    hoja.appendRow(fila);

    var autorizados = personas
      .map(function(persona, index) {
        return persona ? '<li>' + escaparHTML(persona) + ' (DNI: ' + escaparHTML(dnis[index]) + ')</li>' : '';
      })
      .filter(function(item) { return Boolean(item); })
      .join('');
    var asunto = 'Confirmación de autorización de retiro de vales - Código: ' + codigo;
    var cuerpoHTML = '<div style="font-family:Arial,sans-serif;color:#333;max-width:600px;margin:0 auto;padding:20px;border:1px solid #e0e0e0;border-radius:8px;">' +
      '<h2 style="color:#2c3e50;border-bottom:2px solid #3498db;padding-bottom:10px;">Confirmación de registro de autorizados</h2>' +
      '<p>Estimado equipo de <strong>' + escaparHTML(farmacia) + '</strong>:</p>' +
      '<p>Recibimos el listado de personal autorizado para retirar pedidos bajo el código <strong>' + escaparHTML(codigo) + '</strong>.</p>' +
      '<ul style="background-color:#f9f9f9;padding:15px 20px;border-radius:5px;list-style-type:square;">' + autorizados + '</ul>' +
      '<p>El registro fue recibido y guardado para las gestiones en mostrador.</p>' +
      '<p>Atentamente,<br><strong>Departamento de Logística y Entregas</strong></p>' +
      '<hr style="border:none;border-top:1px solid #eee;margin-top:20px;">' +
      '<p style="font-size:11px;color:#999;text-align:center;">Mensaje automático; por favor, no responda a este correo.</p></div>';

    try {
      MailApp.sendEmail({ to: email, subject: asunto, htmlBody: cuerpoHTML });
      return { exito: true };
    } catch (emailError) {
      Logger.log('La autorización se guardó, pero no se pudo enviar el correo: ' + emailError);
      return {
        exito: true,
        aviso: 'La autorización se guardó en la hoja, pero no se pudo enviar el correo de confirmación.'
      };
    }
  } catch (error) {
    Logger.log('Error al procesar el formulario de socios: ' + error);
    return { exito: false, error: String(error && error.message || error) };
  }
}

function escaparHTML(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function registrarEntregaMostrador(codigoFarmaciaIngresado, personaIngresada, cantidadPedidos, operarioLogueado, inicioEspera) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hojaRespuestas = ss.getSheetByName('Respuestas de formulario 1');
  var hojaRegistro = ss.getSheetByName('REGISTRO');
  if (!hojaRespuestas) throw new Error('No existe la pestaña "Respuestas de formulario 1".');
  if (!hojaRegistro) throw new Error('No existe la pestaña "REGISTRO".');

  var codigo = soloDigitos(codigoFarmaciaIngresado);
  var persona = String(personaIngresada || '').trim();
  var cantidad = Number(cantidadPedidos);
  var operario = String(operarioLogueado || '').trim();
  if (!codigo) throw new Error('El código de farmacia no es válido.');
  if (!persona) throw new Error('No se recibió el nombre de la persona seleccionada.');
  if (!Number.isSafeInteger(cantidad) || cantidad < 0 || cantidad > 10000) {
    throw new Error('La cantidad de pedidos debe ser un número entero entre 0 y 10000.');
  }
  if (!operario) throw new Error('No se recibió el operario de la sesión. Cierra sesión e ingresa nuevamente.');

  var rows = hojaRespuestas.getDataRange().getValues();
  var authorizedName = '';
  var pharmacyName = '';
  var pharmacyEmail = '';
  var personaDni = extraerDniPersona(persona);

  for (var rowIndex = 1; rowIndex < rows.length; rowIndex++) {
    var row = rows[rowIndex];
    if (soloDigitos(row[3]) !== codigo) continue;

    pharmacyName = String(row[2] || '').trim();
    for (var personIndex = 4; personIndex <= 9; personIndex++) {
      var nameInSheet = String(row[personIndex] || '').trim();
      var dniInSheet = soloDigitos(row[11 + personIndex - 4]);
      if (personaDni && dniInSheet === personaDni) {
        authorizedName = nameInSheet;
        pharmacyEmail = String(row[1] || '').trim();
        break;
      }
    }
    if (authorizedName) break;
  }

  var authorized = Boolean(authorizedName);
  var state = authorized ? 'AUTORIZADO' : 'DENEGADO';
  var registeredName = authorized ? authorizedName : persona + ' (No autorizado)';
  var fechaRegistro = new Date();
  var tiempoEspera = formatearTiempoEspera_(inicioEspera, fechaRegistro);

  hojaRegistro.appendRow([
    fechaRegistro,
    codigo,
    registeredName,
    authorized ? cantidad : 0,
    state,
    operario,
    tiempoEspera
  ]);
  var avisoCorreo = '';
  if (authorized) {
    avisoCorreo = enviarAvisoRetiroVale_(
      pharmacyEmail, pharmacyName, codigo, authorizedName, cantidad, operario, fechaRegistro, ss.getSpreadsheetTimeZone()
    );
  }

  return {
    estado: state,
    mensaje: authorized
      ? 'Acceso autorizado para: ' + authorizedName + '. Registro guardado.'
      : 'Acceso denegado: el nombre no figura autorizado para esta farmacia.',
    persona: registeredName,
    farmacia: pharmacyName,
    tiempoEspera: tiempoEspera,
    avisoCorreo: avisoCorreo
  };
}

function enviarAvisoRetiroVale_(email, farmacia, codigo, persona, cantidad, operario, fecha, zonaHoraria) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    Logger.log('El retiro quedó registrado, pero no se envió el aviso: la farmacia no tiene un correo válido en la columna B.');
    return 'El retiro quedó registrado, pero no se pudo enviar el aviso: falta un correo válido de la farmacia en la columna B del formulario.';
  }

  var fechaTexto = Utilities.formatDate(fecha, zonaHoraria, 'dd/MM/yyyy HH:mm:ss');
  var asunto = 'Aviso de retiro de vales - ' + farmacia + ' (' + codigo + ')';
  var mensaje = 'AVISO DE ENTREGA REGISTRADA\n\n' +
    'Farmacia: ' + farmacia + ' (código ' + codigo + ')\n' +
    'Persona: ' + persona + '\n' +
    'Cantidad de vales: ' + cantidad + '\n' +
    'Operario: ' + operario + '\n' +
    'Fecha y hora: ' + fechaTexto + '\n\n' +
    'Mensaje automático del sistema de entregas. Por favor, no responda a este correo.';
  var cuerpoHTML = '<div style="margin:0;padding:32px 16px;background-color:#f3f6fa;font-family:Arial,Helvetica,sans-serif;color:#243247;">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;margin:0 auto;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">' +
    '<tr><td style="padding:24px 32px;background-color:#17324d;color:#ffffff;">' +
    '<p style="margin:0 0 8px;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#b9d5e8;">Sistema de entregas</p>' +
    '<h1 style="margin:0;font-size:22px;line-height:1.3;font-weight:700;">Entrega registrada</h1>' +
    '</td></tr>' +
    '<tr><td style="padding:28px 32px 12px;">' +
    '<p style="margin:0 0 12px;font-size:15px;line-height:1.6;">Estimado equipo de <strong>' + escaparHTML(farmacia) + '</strong>:</p>' +
    '<p style="margin:0;font-size:14px;line-height:1.6;color:#526174;">Se registró correctamente el retiro de vales correspondiente a su farmacia.</p>' +
    '</td></tr>' +
    '<tr><td style="padding:16px 32px 28px;">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background-color:#f7f9fc;border:1px solid #e7edf4;border-radius:8px;">' +
    '<tr><td style="padding:12px 16px;border-bottom:1px solid #e7edf4;font-size:13px;color:#68778a;">Código de farmacia</td><td style="padding:12px 16px;border-bottom:1px solid #e7edf4;text-align:right;font-size:14px;font-weight:700;color:#243247;">' + escaparHTML(codigo) + '</td></tr>' +
    '<tr><td style="padding:12px 16px;border-bottom:1px solid #e7edf4;font-size:13px;color:#68778a;">Persona autorizada</td><td style="padding:12px 16px;border-bottom:1px solid #e7edf4;text-align:right;font-size:14px;font-weight:700;color:#243247;">' + escaparHTML(persona) + '</td></tr>' +
    '<tr><td style="padding:12px 16px;border-bottom:1px solid #e7edf4;font-size:13px;color:#68778a;">Cantidad de vales</td><td style="padding:12px 16px;border-bottom:1px solid #e7edf4;text-align:right;font-size:14px;font-weight:700;color:#243247;">' + escaparHTML(cantidad) + '</td></tr>' +
    '<tr><td style="padding:12px 16px;border-bottom:1px solid #e7edf4;font-size:13px;color:#68778a;">Operario</td><td style="padding:12px 16px;border-bottom:1px solid #e7edf4;text-align:right;font-size:14px;font-weight:700;color:#243247;">' + escaparHTML(operario) + '</td></tr>' +
    '<tr><td style="padding:12px 16px;font-size:13px;color:#68778a;">Fecha y hora</td><td style="padding:12px 16px;text-align:right;font-size:14px;font-weight:700;color:#243247;">' + escaparHTML(fechaTexto) + '</td></tr>' +
    '</table></td></tr>' +
    '<tr><td style="padding:16px 32px 24px;border-top:1px solid #edf1f5;">' +
    '<p style="margin:0;text-align:center;font-size:11px;line-height:1.5;color:#8793a2;">Este es un mensaje automático del sistema de entregas. Por favor, no responda a este correo.</p>' +
    '</td></tr></table></div>';
  try {
    MailApp.sendEmail({ to: email, subject: asunto, body: mensaje, htmlBody: cuerpoHTML });
    return '';
  } catch (emailError) {
    Logger.log('El retiro quedó registrado, pero no se pudo enviar el aviso a ' + email + ': ' + emailError);
    return 'El retiro quedó registrado, pero Gmail no pudo enviar el aviso al correo de la farmacia. Revisa los permisos y la cuota de envío de Apps Script.';
  }
}

function formatearTiempoEspera_(inicioEspera, fechaRegistro) {
  var inicio = new Date(String(inicioEspera || ''));
  var inicioMs = inicio.getTime();
  var finMs = fechaRegistro.getTime();
  if (!Number.isFinite(inicioMs) || inicioMs > finMs) {
    throw new Error('La fecha y hora de ingreso de la persona no son válidas.');
  }
  var segundos = Math.floor((finMs - inicioMs) / 1000);
  if (segundos > 12 * 60 * 60) return 'EXEDIDO';
  var horas = String(Math.floor(segundos / 3600)).padStart(2, '0');
  var minutos = String(Math.floor((segundos % 3600) / 60)).padStart(2, '0');
  return horas + ':' + minutos;
}

function normalizarPersona(value) {
  return String(value == null ? '' : value)
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/\s+/g, ' ');
}

function extraerDniPersona(value) {
  var match = String(value == null ? '' : value).match(/(?:^|\D)(\d{7,8})(?=\D|$)/);
  return match ? match[1] : '';
}

function soloDigitos(value) {
  return String(value == null ? '' : value).replace(/\D/g, '');
}
