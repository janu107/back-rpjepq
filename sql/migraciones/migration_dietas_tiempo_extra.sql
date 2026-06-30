-- ============================================================================
-- MIGRACIÓN — Dietas (maestro-detalle) + Nómina de Tiempo Extra
-- Base de datos : apps_rpjepq
-- Motor         : MySQL 8 / MariaDB (portable, sin ADD COLUMN IF NOT EXISTS)
-- Idempotente, NO destructiva (sin DROP TABLE / TRUNCATE / DELETE de datos).
--
-- Hace:
--   1. Crea tablas del módulo de Dietas maestro-detalle:
--        RPJ_MNT_SESION (actas/reuniones), RPJ_MNT_DIETA (encabezado pago mensual,
--        modelo vdi_*) y RPJ_MNT_DIETA_DET (asistencia individual).
--   2. Agrega columnas nuevas:
--        RPJ_MNT_DIETA.vdi_periodo (YYYY-MM, para agrupar pagos por mes),
--        RPJ_CAT_PARAMETRO_GENERAL.par_porcentaje_tiemext_doble (multiplicador HE doble),
--        RPJ_MNT_TIEMPO_EXTRAORDINARIO.tex_fecha_pago (fecha de pago).
--   3. Siembra catálogos requeridos (best-effort, sin abortar):
--        tipos de ingreso HORA EXTRA / HORA EXTRA DOBLE, descuento IGSS,
--        tipo de planilla 3 (NOMINA TIEMPO EXTRA).
--   4. Crea el SP sp_generar_nomina_tiempo_extra (planilla tipo 3).
--
-- DECISIONES (sección 0 del spec):
--   #1 emp_estado se maneja como 'ACTIVO'/'INACTIVO' (consistente con el sistema).
--   #2 par_porcentaje_tiempo_extra y par_porcentaje_tiemext_doble son MULTIPLICADORES
--      completos (1.50 / 2.00). El SP usa: salario/30/8 * multiplicador.
--      *** Recordar fijar en producción par_porcentaje_tiempo_extra = 1.50 y
--          par_porcentaje_tiemext_doble = 2.00 (hoy puede venir 0.15). ***
--
-- NOTA: helpers SILENCIOSOS (sin SELECT interno) para compatibilidad phpMyAdmin.
-- ============================================================================

CREATE DATABASE IF NOT EXISTS `apps_rpjepq`
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `apps_rpjepq`;

SET @OLD_FK := @@FOREIGN_KEY_CHECKS;
SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================================
-- BLOQUE 0 — HELPERS idempotentes (silenciosos)
-- ============================================================================
DELIMITER $$

DROP PROCEDURE IF EXISTS _dt_add_column $$
CREATE PROCEDURE _dt_add_column(IN p_table VARCHAR(64), IN p_column VARCHAR(64), IN p_ddl TEXT)
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND COLUMN_NAME = p_column) THEN
    SET @s = CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN ', p_ddl);
    PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
  END IF;
END $$

-- Ejecuta un INSERT/DDL de "siembra" tolerando errores (catálogos que pudieran
-- tener columnas distintas según el entorno). NO usar para DDL crítico.
DROP PROCEDURE IF EXISTS _dt_safe $$
CREATE PROCEDURE _dt_safe(IN p_sql TEXT)
BEGIN
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION BEGIN END;
  SET @s = p_sql; PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
END $$

DELIMITER ;

-- ============================================================================
-- BLOQUE 1 — Tablas del módulo de Dietas (maestro-detalle)
-- ============================================================================
SELECT 'BLOQUE 1: tablas de dietas' AS etapa;

CREATE TABLE IF NOT EXISTS RPJ_MNT_SESION (
    ses_correlativo      INT AUTO_INCREMENT PRIMARY KEY,
    ses_acta             VARCHAR(100) NOT NULL UNIQUE,
    ses_fecha_sesion     DATE NOT NULL,
    ses_descripcion      VARCHAR(200),
    ses_estado           ENUM('ACTIVA','ANULADA') NOT NULL DEFAULT 'ACTIVA',
    ses_fecha_creacion   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ses_usuario_creacion VARCHAR(50) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Encabezado de pago mensual por miembro (en producción ya existe con vdi_*).
CREATE TABLE IF NOT EXISTS RPJ_MNT_DIETA (
    vdi_correlativo        INT AUTO_INCREMENT PRIMARY KEY,
    vdi_id_junta_directiva INT NOT NULL,
    vdi_no_documento       VARCHAR(50) NULL,
    vdi_tipo_documento     ENUM('CHEQUE','TRANSFERENCIA','DEPOSITO') NULL,
    vdi_banco              VARCHAR(100) NULL,
    vdi_fecha_pago         DATE NULL,
    vdi_fecha_recibido     DATE NULL,
    vdi_total_sesiones     INT DEFAULT 0,
    vdi_valor              DECIMAL(10,2) DEFAULT 0.00,
    vdi_isr                DECIMAL(10,2) DEFAULT 0.00,
    vdi_valor_pago         DECIMAL(10,2) DEFAULT 0.00,
    vdi_estado             ENUM('PENDIENTE','PAGADO','RECIBIDO','ANULADO') NOT NULL DEFAULT 'PENDIENTE',
    vdi_observaciones      VARCHAR(200),
    vdi_periodo            VARCHAR(7) NULL,
    vdi_fecha_creacion     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    vdi_usuario_creacion   VARCHAR(50) NOT NULL,
    CONSTRAINT fk_dieta_junta
        FOREIGN KEY (vdi_id_junta_directiva)
        REFERENCES RPJ_MNT_JUNTA_DIRECTIVA(jun_correlativo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS RPJ_MNT_DIETA_DET (
    die_correlativo      INT AUTO_INCREMENT PRIMARY KEY,
    die_id_dieta         INT NOT NULL,
    die_id_sesion        INT NOT NULL,
    die_valor            DECIMAL(10,2) NOT NULL,
    die_fecha_creacion   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    die_usuario_creacion VARCHAR(50) NOT NULL,
    CONSTRAINT fk_det_dieta  FOREIGN KEY (die_id_dieta)  REFERENCES RPJ_MNT_DIETA(vdi_correlativo) ON DELETE CASCADE,
    CONSTRAINT fk_det_sesion FOREIGN KEY (die_id_sesion) REFERENCES RPJ_MNT_SESION(ses_correlativo),
    UNIQUE KEY uk_dieta_sesion (die_id_dieta, die_id_sesion)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- BLOQUE 2 — Columnas nuevas
-- ============================================================================
SELECT 'BLOQUE 2: columnas nuevas' AS etapa;

CALL _dt_add_column('RPJ_MNT_DIETA', 'vdi_periodo', "vdi_periodo VARCHAR(7) NULL");
CALL _dt_add_column('RPJ_CAT_PARAMETRO_GENERAL', 'par_porcentaje_tiemext_doble',
     "par_porcentaje_tiemext_doble DECIMAL(6,2) NOT NULL DEFAULT 0.00");
CALL _dt_add_column('RPJ_MNT_TIEMPO_EXTRAORDINARIO', 'tex_fecha_pago', "tex_fecha_pago DATE NULL");

-- ============================================================================
-- BLOQUE 3 — Siembra de catálogos (best-effort, sin abortar)
-- ============================================================================
SELECT 'BLOQUE 3: siembra de catalogos' AS etapa;

CALL _dt_safe(
  "INSERT INTO RPJ_CAT_TIPO_INGRESO (tin_tipo_ingreso, tin_descripcion, tin_usuario_creacion)
   SELECT 'HORA EXTRA','Hora extra normal (tiempo extraordinario)','sistema'
   WHERE NOT EXISTS (SELECT 1 FROM RPJ_CAT_TIPO_INGRESO WHERE UPPER(tin_tipo_ingreso) = 'HORA EXTRA')");

CALL _dt_safe(
  "INSERT INTO RPJ_CAT_TIPO_INGRESO (tin_tipo_ingreso, tin_descripcion, tin_usuario_creacion)
   SELECT 'HORA EXTRA DOBLE','Hora extra doble (tiempo extraordinario)','sistema'
   WHERE NOT EXISTS (SELECT 1 FROM RPJ_CAT_TIPO_INGRESO WHERE UPPER(tin_tipo_ingreso) = 'HORA EXTRA DOBLE')");

CALL _dt_safe(
  "INSERT INTO RPJ_CAT_TIPO_DESCUENTO (tde_tipo_descuento, tde_descripcion, tde_usuario_creacion)
   SELECT 'IGSS','Cuota laboral IGSS','sistema'
   WHERE NOT EXISTS (SELECT 1 FROM RPJ_CAT_TIPO_DESCUENTO WHERE UPPER(tde_tipo_descuento) = 'IGSS')");

-- Tipo de planilla 3 (sólo para mostrar el nombre en pantallas; el SP usa el id 3 directo).
CALL _dt_safe(
  "INSERT INTO RPJ_CAT_TIPO_PLANILLA (tpl_id, tpl_tipo_planilla, tpl_descripcion, tpl_id_tipo_uso, tpl_usuario_creacion)
   SELECT 3,'NOMINA TIEMPO EXTRA','Nomina de tiempo extraordinario',
          (SELECT COALESCE(MIN(tpl_id_tipo_uso),1) FROM RPJ_CAT_TIPO_PLANILLA),'sistema'
   WHERE NOT EXISTS (SELECT 1 FROM RPJ_CAT_TIPO_PLANILLA WHERE tpl_id = 3)");

-- ============================================================================
-- BLOQUE 4 — SP sp_generar_nomina_tiempo_extra  (planilla tipo 3)
-- ============================================================================
SELECT 'BLOQUE 4: SP de nomina tiempo extra' AS etapa;

DROP PROCEDURE IF EXISTS sp_generar_nomina_tiempo_extra;
DELIMITER $$

CREATE PROCEDURE sp_generar_nomina_tiempo_extra(
    IN  p_id_planilla INT,
    IN  p_usuario     VARCHAR(50),
    OUT p_resultado   VARCHAR(200)
)
BEGIN
    DECLARE v_tipo_planilla   INT;
    DECLARE v_estado_proc     VARCHAR(20);
    DECLARE v_fecha_inicio    DATE;
    DECLARE v_fecha_final     DATE;
    DECLARE v_ya_procesada    INT DEFAULT 0;

    DECLARE v_pct_normal      DECIMAL(6,2) DEFAULT 0;
    DECLARE v_pct_doble       DECIMAL(6,2) DEFAULT 0;
    DECLARE v_pct_igss        DECIMAL(6,2) DEFAULT 0;

    DECLARE v_id_tin_normal   INT DEFAULT NULL;
    DECLARE v_id_tin_doble    INT DEFAULT NULL;
    DECLARE v_id_igss         INT DEFAULT NULL;

    DECLARE v_he_normal       INT DEFAULT 0;
    DECLARE v_he_doble        INT DEFAULT 0;
    DECLARE v_desc_igss       INT DEFAULT 0;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        SET p_resultado = 'ERROR: Ocurrio un problema durante el proceso. Se realizo ROLLBACK.';
    END;

    -- 1. Validar planilla: existe, tipo 3 y ABIERTA
    SELECT ppl_tipo_planilla, ppl_estado_proceso, ppl_fecha_inicio, ppl_fecha_final
      INTO v_tipo_planilla, v_estado_proc, v_fecha_inicio, v_fecha_final
      FROM RPJ_CAT_PARAMETRO_PLANILLA
     WHERE ppl_correlativo = p_id_planilla;

    IF v_estado_proc IS NULL THEN
        SET p_resultado = 'ERROR: La planilla no existe.';
    ELSEIF v_tipo_planilla <> 3 THEN
        SET p_resultado = 'ERROR: La planilla no es de tipo 3 (Tiempo Extra).';
    ELSEIF v_estado_proc <> 'ABIERTA' THEN
        SET p_resultado = 'ERROR: La planilla ya fue procesada o no esta ABIERTA.';
    ELSE
        -- 2. Idempotencia: que no existan ya ingresos de esta planilla tipo 3
        SELECT COUNT(*) INTO v_ya_procesada
          FROM RPJ_PRC_NOMINA_INGRESO
         WHERE nin_id_planilla = p_id_planilla AND nin_id_tipo_planilla = 3;

        IF v_ya_procesada > 0 THEN
            SET p_resultado = 'ERROR: Esta planilla ya fue procesada anteriormente.';
        ELSE
            -- 3. Parámetros vigentes (multiplicadores + IGSS)
            SELECT COALESCE(par_porcentaje_tiempo_extra,0),
                   COALESCE(par_porcentaje_tiemext_doble,0),
                   COALESCE(par_igss,0)
              INTO v_pct_normal, v_pct_doble, v_pct_igss
              FROM RPJ_CAT_PARAMETRO_GENERAL
             ORDER BY par_id DESC LIMIT 1;

            -- 4. Tipos de ingreso/descuento (por nombre, sin hardcodear ids)
            SELECT tin_id INTO v_id_tin_normal FROM RPJ_CAT_TIPO_INGRESO
             WHERE UPPER(tin_tipo_ingreso) IN ('HORA EXTRA','HORA EXTRA NORMAL','TIEMPO EXTRA','TIEMPO EXTRAORDINARIO')
             ORDER BY tin_id LIMIT 1;

            SELECT tin_id INTO v_id_tin_doble FROM RPJ_CAT_TIPO_INGRESO
             WHERE UPPER(tin_tipo_ingreso) IN ('HORA EXTRA DOBLE','TIEMPO EXTRA DOBLE')
             ORDER BY tin_id LIMIT 1;

            SELECT tde_id INTO v_id_igss FROM RPJ_CAT_TIPO_DESCUENTO
             WHERE UPPER(tde_tipo_descuento) = 'IGSS' LIMIT 1;

            IF v_id_tin_normal IS NULL OR v_id_tin_doble IS NULL THEN
                SET p_resultado = 'ERROR: Faltan tipos de ingreso HORA EXTRA / HORA EXTRA DOBLE en el catalogo.';
            ELSEIF v_pct_normal <= 0 OR v_pct_doble <= 0 THEN
                SET p_resultado = 'ERROR: Configure par_porcentaje_tiempo_extra y par_porcentaje_tiemext_doble (multiplicadores, ej. 1.50 y 2.00).';
            ELSE
                START TRANSACTION;

                -- 5. HE NORMALES (tex_tipo_hora = 1)
                INSERT INTO RPJ_PRC_NOMINA_INGRESO (
                    nin_tipo_manejo, nin_id_tipo_planilla, nin_id_planilla, nin_id_empleado,
                    nin_tipo_ingreso, nin_valor, nin_valor_teorico, nin_porcentaje_aplicado,
                    nin_pago_corriente, nin_abono_historico, nin_dias_trabajados,
                    nin_puesto, nin_area, nin_usuario_creacion
                )
                SELECT 1, 3, p_id_planilla, e.emp_correlativo,
                       v_id_tin_normal,
                       ROUND(base.salario / 30 / 8 * v_pct_normal * t.tex_cantidad_horas, 2),
                       ROUND(base.salario / 30 / 8 * v_pct_normal, 2),
                       v_pct_normal,
                       ROUND(base.salario / 30 / 8 * v_pct_normal * t.tex_cantidad_horas, 2),
                       0.00, t.tex_cantidad_horas,
                       e.emp_profesion_oficio, 'TRABAJADORES', p_usuario
                  FROM RPJ_MNT_TIEMPO_EXTRAORDINARIO t
                  INNER JOIN RPJ_MNT_EMPLEADO e
                          ON e.emp_correlativo = t.tex_id_empleado AND e.emp_tipo_manejo = 1
                  INNER JOIN (
                        SELECT s.sal_id_empleado, s.sal_salario AS salario
                          FROM RPJ_MNT_SALARIO s
                         WHERE s.sal_tipo_manejo = 1
                           AND s.sal_correlativo = (
                               SELECT MIN(s2.sal_correlativo) FROM RPJ_MNT_SALARIO s2
                                WHERE s2.sal_id_empleado = s.sal_id_empleado AND s2.sal_tipo_manejo = 1)
                  ) base ON base.sal_id_empleado = e.emp_correlativo
                 WHERE UPPER(COALESCE(e.emp_estado,'ACTIVO')) <> 'INACTIVO'
                   AND t.tex_tipo_hora = 1
                   AND COALESCE(t.tex_fecha_pago, DATE(t.tex_fecha_hora_inicio)) BETWEEN v_fecha_inicio AND v_fecha_final;
                SET v_he_normal = ROW_COUNT();

                -- 6. HE DOBLES (tex_tipo_hora = 2)
                INSERT INTO RPJ_PRC_NOMINA_INGRESO (
                    nin_tipo_manejo, nin_id_tipo_planilla, nin_id_planilla, nin_id_empleado,
                    nin_tipo_ingreso, nin_valor, nin_valor_teorico, nin_porcentaje_aplicado,
                    nin_pago_corriente, nin_abono_historico, nin_dias_trabajados,
                    nin_puesto, nin_area, nin_usuario_creacion
                )
                SELECT 1, 3, p_id_planilla, e.emp_correlativo,
                       v_id_tin_doble,
                       ROUND(base.salario / 30 / 8 * v_pct_doble * t.tex_cantidad_horas, 2),
                       ROUND(base.salario / 30 / 8 * v_pct_doble, 2),
                       v_pct_doble,
                       ROUND(base.salario / 30 / 8 * v_pct_doble * t.tex_cantidad_horas, 2),
                       0.00, t.tex_cantidad_horas,
                       e.emp_profesion_oficio, 'TRABAJADORES', p_usuario
                  FROM RPJ_MNT_TIEMPO_EXTRAORDINARIO t
                  INNER JOIN RPJ_MNT_EMPLEADO e
                          ON e.emp_correlativo = t.tex_id_empleado AND e.emp_tipo_manejo = 1
                  INNER JOIN (
                        SELECT s.sal_id_empleado, s.sal_salario AS salario
                          FROM RPJ_MNT_SALARIO s
                         WHERE s.sal_tipo_manejo = 1
                           AND s.sal_correlativo = (
                               SELECT MIN(s2.sal_correlativo) FROM RPJ_MNT_SALARIO s2
                                WHERE s2.sal_id_empleado = s.sal_id_empleado AND s2.sal_tipo_manejo = 1)
                  ) base ON base.sal_id_empleado = e.emp_correlativo
                 WHERE UPPER(COALESCE(e.emp_estado,'ACTIVO')) <> 'INACTIVO'
                   AND t.tex_tipo_hora = 2
                   AND COALESCE(t.tex_fecha_pago, DATE(t.tex_fecha_hora_inicio)) BETWEEN v_fecha_inicio AND v_fecha_final;
                SET v_he_doble = ROW_COUNT();

                -- 7. IGSS sobre el total de HE del empleado (solo si aplica en datos de planilla)
                IF v_id_igss IS NOT NULL AND v_pct_igss > 0 THEN
                    INSERT INTO RPJ_PRC_NOMINA_DESCUENTO (
                        nde_tipo_manejo, nde_id_tipo_planilla, nde_id_planilla, nde_id_empleado,
                        nde_tipo_descuento, nde_valor, nde_dias_trabajados,
                        nde_puesto, nde_area, nde_usuario_creacion
                    )
                    SELECT 1, 3, p_id_planilla, x.emp,
                           v_id_igss, ROUND(x.total_he * v_pct_igss / 100, 2), 0,
                           x.puesto, 'TRABAJADORES', p_usuario
                      FROM (
                            SELECT i.nin_id_empleado AS emp,
                                   MAX(i.nin_puesto)  AS puesto,
                                   SUM(i.nin_valor)   AS total_he
                              FROM RPJ_PRC_NOMINA_INGRESO i
                             WHERE i.nin_id_planilla = p_id_planilla
                               AND i.nin_id_tipo_planilla = 3
                               AND i.nin_tipo_manejo = 1
                             GROUP BY i.nin_id_empleado
                      ) x
                     WHERE x.total_he > 0
                       AND EXISTS (
                           SELECT 1 FROM RPJ_MNT_DATOS_PLANILLA d
                            WHERE d.dat_id_empleado = x.emp
                              AND d.dat_tipo_manejo = 1
                              AND d.dat_aplica_desc_igss = 1);
                    SET v_desc_igss = ROW_COUNT();
                END IF;

                -- 8. Marcar planilla como GENERADA
                UPDATE RPJ_CAT_PARAMETRO_PLANILLA
                   SET ppl_estado_proceso   = 'GENERADA',
                       ppl_fecha_generacion = NOW(),
                       ppl_usuario_genera   = p_usuario
                 WHERE ppl_correlativo = p_id_planilla;

                COMMIT;

                SET p_resultado = CONCAT('PROCESO EXITOSO. HE Normales: ', v_he_normal,
                                         '. HE Dobles: ', v_he_doble,
                                         '. Descuentos IGSS: ', v_desc_igss, '.');
            END IF;
        END IF;
    END IF;
END $$

DELIMITER ;

-- ============================================================================
-- BLOQUE 5 — VERIFICACIÓN
-- ============================================================================
SELECT 'BLOQUE 5: verificación' AS etapa;

SELECT TABLE_NAME
  FROM information_schema.TABLES
 WHERE TABLE_SCHEMA = DATABASE()
   AND TABLE_NAME IN ('RPJ_MNT_SESION','RPJ_MNT_DIETA','RPJ_MNT_DIETA_DET')
 ORDER BY TABLE_NAME;

SELECT COLUMN_NAME
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE()
   AND ((TABLE_NAME='RPJ_MNT_DIETA' AND COLUMN_NAME='vdi_periodo')
     OR (TABLE_NAME='RPJ_CAT_PARAMETRO_GENERAL' AND COLUMN_NAME='par_porcentaje_tiemext_doble')
     OR (TABLE_NAME='RPJ_MNT_TIEMPO_EXTRAORDINARIO' AND COLUMN_NAME='tex_fecha_pago'))
 ORDER BY TABLE_NAME, COLUMN_NAME;

SELECT ROUTINE_NAME
  FROM information_schema.ROUTINES
 WHERE ROUTINE_SCHEMA = DATABASE() AND ROUTINE_NAME = 'sp_generar_nomina_tiempo_extra';

-- ============================================================================
-- BLOQUE 6 — LIMPIEZA
-- ============================================================================
DROP PROCEDURE IF EXISTS _dt_add_column;
DROP PROCEDURE IF EXISTS _dt_safe;

SET FOREIGN_KEY_CHECKS = @OLD_FK;

SELECT 'MIGRACION DIETAS + TIEMPO EXTRA COMPLETADA. Revisar BLOQUE 5. Recordar: par_porcentaje_tiempo_extra=1.50 y par_porcentaje_tiemext_doble=2.00 en parametros.' AS estado;
-- ============================================================================
-- FIN
-- ============================================================================
