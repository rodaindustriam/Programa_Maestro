# Proceso PAM · Primera prueba funcional

Aplicación de Apps Script independiente de Maestro de Ventas y Maestro de Compras.
Esta versión guarda el flujo en la hoja central y publica únicamente en un catálogo de prueba.
No envía solicitudes HTTP a Kommo ni modifica Productos.

## Instalación

1. Crear un proyecto independiente de Google Apps Script llamado **RIM - Proceso PAM**.
2. Reemplazar Código.gs, crear el archivo HTML **PAM** y copiar el manifiesto appsscript.json.
3. La hoja central configurada es 1qzuGTk_Jvof6OTY2_WPiBjdpITWfeCibv0HNihKGCTA.
   Puede sustituirse mediante la propiedad de script PAM_SPREADSHEET_ID.
   La cuenta que ejecuta el proyecto debe tener permisos de edición en ese libro.
4. Ejecutar **inicializarProcesoPAM** desde el editor y conceder los permisos solicitados.
5. Comprobar las cuatro pestañas PAM creadas.
6. Implementar como aplicación web, ejecutar como la cuenta que despliega y seleccionar
   **Solo yo** para esta prueba inicial. Abrir el enlace con esa cuenta.

La prueba de acceso del equipo requiere una fase posterior de perfiles y autenticación,
como en las otras interfaces. El manifiesto inicial restringe el acceso al propietario del despliegue.

## Pestañas

| Nombre | Función |
| --- | --- |
| PAM_Solicitudes | Un producto por solicitud, etapa, cotización y ficha preparada por Data |
| PAM_Catalogo_Prueba | Ficha de 16 columnas compatible con el catálogo, más referencias internas de prueba |
| PAM_Eventos | Historial de acciones y autor |
| PAM_Operaciones | Estado de envíos y planes de recuperación |

Las 18 columnas originales de PAM_Solicitudes se conservan en su posición.
Se añaden nuevos campos al final. Si los encabezados existentes no coinciden, la aplicación
detiene la carga y avisa del conflicto. No reordena ni elimina pestañas.

## Prueba sugerida

1. Crear una solicitud manual con cliente, asesora, producto y cantidad. El lead es opcional.
2. Recargar el navegador: la solicitud debe continuar en Por ubicar.
3. Abrir Cargar cotización y guardar proveedor, costo positivo y plazo. Debe pasar a Data.
4. Preparar código, marca, código de proveedor, descripción y los cuatro precios positivos.
   Las medidas son opcionales y aceptan cero y decimales positivos.
5. Publicar en prueba y comprobar la fila en PAM_Catalogo_Prueba.
6. Comprobar Actividad. Recargar y verificar que el producto conserva su etapa.
7. Reenviar una operación con el mismo identificador no debe crear una segunda solicitud
   ni duplicar la publicación. Si aparece un envío pendiente, usar Reintentar.
8. Comprobar que Productos, las solicitudes de Compras y el histórico siguen intactos.

No hay registros ficticios precargados, márgenes automáticos ni mensajes que afirmen
que el lead se movió en Kommo.

## Datos para la futura integración

- ID del lead y del embudo.
- ID de la etapa de entrada (PAM o PAM VIP).
- ID del usuario responsable; su nombre se resolverá como asesora.
- ID del contacto, nombre del cliente y teléfono.
- Productos, cantidades y especificaciones mediante formulario o nota revisada.
- IDs de PAM, PAM VIP y Ya disponible configurados por embudo.
- Referencia de origen o evento para evitar reimportaciones duplicadas.

Las credenciales se configurarán del lado del servidor. Esta versión no incluye receptor
webhook ni importación masiva. El ID de lead puede repetirse en diferentes solicitudes
porque un cliente puede esperar varios productos. Su traslado a Ya disponible se habilitará
cuando se pueda verificar la publicación real y la resolución de sus productos pendientes.

## Compatibilidad y recuperación

Las operaciones usan bloqueo, versión del registro y un identificador por envío.
El plan se registra antes de cambiar la solicitud o el catálogo de prueba. Un reintento
completa las escrituras pendientes y registra un solo evento por operación.
Las cotizaciones y productos nunca se dan por guardados solo en memoria del navegador.

Las pruebas de código usan dobles de Google Sheets y un navegador local. La autorización,
la creación real de las pestañas y la ejecución en Google Apps Script deben comprobarse
durante la instalación con la cuenta propietaria.
