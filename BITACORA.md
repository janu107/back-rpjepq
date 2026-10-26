# Bitácora de cambios — Backend RPJEPQ

## 2026-06-30 — Correcciones Dietas / Tiempo Extra + Firmas en reportes

### Fechas devueltas como "Tue Jun 30" (formato incorrecto)
- **Causa:** mysql2 (sin `dateStrings`) devuelve DATE/DATETIME como objetos `Date`; el
  patrón `String(fecha).slice(0,10)` producía el `toString()` ("Tue Jun 30"), no la fecha ISO.
- **Cambio:** nuevo helper `src/utils/date.js` → `toISODate()` (usa partes locales del Date,
  sin desfase de zona horaria). Aplicado en:
  - `src/services/adminPagos.service.js` (config `tiempo-extra`: fechaPago/fechaInicio/fechaFinal).
  - `src/services/sesiones.service.js` (`mapSesion.fechaSesion`) — arregla que la fecha de
    sesión no se cargara al **editar** (el input date no podía parsear "Tue Jun 30").
  - `src/services/dietas.service.js` (`detalle` → fechaSesion del voucher).

### Error al GENERAR nómina de tiempo extra ("Se realizó ROLLBACK")
- **Causa 1:** los *seeds* de catálogos en `migration_dietas_tiempo_extra.sql` usaban
  `SELECT ... WHERE NOT EXISTS (...)` **sin `FROM DUAL`** → sintaxis inválida en MySQL →
  se ejecutaban dentro del helper silencioso `_dt_safe` y fallaban sin avisar. Resultado:
  el **tipo de planilla 3 nunca se creó**; si `RPJ_PRC_NOMINA_INGRESO.nin_id_tipo_planilla`
  tiene FK a `tpl_id`, el INSERT del SP fallaba y hacía ROLLBACK.
- **Causa 2:** el seed del tipo planilla 3 referenciaba la tabla destino en la lista SELECT
  (`(SELECT MIN(tpl_id_tipo_uso) FROM RPJ_CAT_TIPO_PLANILLA)`), riesgo de error 1093.
- **Cambio (`sql/migraciones/migration_dietas_tiempo_extra.sql`):**
  - Todos los seeds ahora usan `... FROM DUAL WHERE NOT EXISTS (...)`.
  - El `tpl_id_tipo_uso` se calcula antes en `@uso_tipo` y se inyecta con CONCAT.
  - El `EXIT HANDLER` del SP ahora usa `GET DIAGNOSTICS` y devuelve el error real
    (`ERROR: <errno> - <mensaje>`) en lugar del mensaje genérico.
- **Acción:** re-ejecutar `migration_dietas_tiempo_extra.sql` en la BD (es idempotente).

### Pago de Dietas — banco como catálogo
- El backend ya acepta `vdi_banco` como texto; ahora el frontend envía el nombre del banco
  elegido de `RPJ_CAT_BANCOS`. Sin cambios de esquema.

### Reportes — firmas (Elaborado/Revisado/Autorizado)
- Sin cambios de backend: el frontend consume el endpoint existente
  `GET /catalogos/firma-planilla` (`RPJ_CAT_FIRMA_PLANILLA`: nombre/puesto).

### Reporte de Pago de Dietas — Error 500
- **Causa:** tras migrar Dietas a `vdi_*`, la consulta del reporte
  (`sql/reportes/regimen/reporteDietas.sql`) seguía usando columnas `die_*`
  (`die_correlativo`, `die_valor`, `die_id_junta_directiva`, etc.), que ya no existen →
  la petición `GET /reportes/regimen/dietas` devolvía **500** ("Error interno del servidor").
- **Cambio:**
  - `sql/reportes/regimen/reporteDietas.sql`: reescrito al modelo `vdi_*`
    (encabezado mensual): periodo, total sesiones, valor, ISR, valor pago, estado, fecha pago;
    JOIN por `vdi_id_junta_directiva`.
  - `src/services/reportesRegimen.service.js` (`mapDieta`): mapea columnas `vdi_*`
    (agrega `periodo` y `estado`; quita `acta`/`fechaSesion` que no aplican al encabezado).
- **Verificado:** los 4 reportes cargan sin fallos. Las firmas
  (`/catalogos/firma-planilla`) ya funcionaban; el 500 era solo del reporte de dietas.

## 2026-07-03 — Fix SP tiempo extra: ERROR 1292 'MIXTA'

- **Síntoma (producción MySQL 8):** al generar nómina de tiempo extra:
  `ERROR 1292 - Truncated incorrect DOUBLE value: 'MIXTA'`.
- **Causa:** en `sp_generar_nomina_tiempo_extra` se comparaba `tex_tipo_hora = 1` /
  `= 2` (número), pero `tex_tipo_hora` es TEXTO y tiene valores viejos no numéricos
  (`'MIXTA'`, `'DIURNA'`, `'N/A'`). MySQL 8 (estricto) convierte 'MIXTA'→DOUBLE y lanza 1292.
  (MariaDB local es permisivo y solo advierte, por eso no reventaba en local.)
- **Cambio:** comparar como texto: `tex_tipo_hora = '1'` y `= '2'` (en
  `sql/migraciones/migration_dietas_tiempo_extra.sql`). Sin conversión numérica → sin 1292.
  Funcional: incluye tipo '1'/'2' y excluye los no numéricos.
- **Aplicado y verificado en PRODUCCIÓN** (SP recreado directamente en el servidor de producción).
  También aplicado en la BD local. Falta commitear el archivo de migración al repo.

### Recordatorio pendiente
- Fijar en Parámetros Generales: `par_porcentaje_tiempo_extra = 1.50` y
  `par_porcentaje_tiemext_doble = 2.00` (multiplicadores). **Importante:** el generar ya no
  falla, pero si el parámetro sigue en 0.15 los montos de hora extra saldrán bajos.

## 2026-10-25 — Seguridad y mantenimiento

- **Admin sin contraseña por defecto:** `createInitialAdmin` ya no usa `Admin123!`; exige
  `ADMIN_PASSWORD` (mín. 10 caracteres) para crear el admin. La contraseña del usuario
  `admin` en producción se cambió (era la de por defecto).
- **`/api/health/db`** (público) ya no devuelve el error de MySQL ni nombre/versión de la base.
- **Dependencias:** `npm audit fix` (proxy-addr, multer, body-parser, qs, mysql2…). Queda
  `uuid` vía `exceljs`, que solo usa v4 y no está afectado.
- **`app.js`:** se sube al repo la versión que estaba solo en el servidor (commit local
  `ee1a2ad`: CORS de producción + `trust proxy` = 1), para que el repo y producción coincidan.
- **Backups:** se borra el `.sql` sin comprimir tras generar el `.gz`; se cierran los archivos
  abiertos; la contraseña de la BD se pasa por `MYSQL_PWD` y no aparece en `ps`.
- **Limpieza:** se eliminó la carpeta suelta `front-rpjepq/` dentro del backend y se ignoran
  los `.DS_Store`.
- **Sesiones al día:** `auth.middleware` confirma contra la base, en cada petición (caché de
  30 s en `src/utils/sessionCache.js`), que el usuario sigue ACTIVO y usa sus roles ACTUALES.
  El token lleva una huella de la contraseña (`pv`): si la contraseña cambia, las sesiones
  anteriores dejan de valer. Desde Usuarios/Roles el cambio aplica al instante.
  **Al desplegar, todos los usuarios deben iniciar sesión una vez** (los tokens viejos no
  traen huella).
