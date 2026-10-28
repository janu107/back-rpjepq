-- Datos FICTICIOS para probar la planilla de jubilados (base local rpj_pruebas).
-- No contiene datos reales. La planilla 900 es la del mes actual (ABIERTA).
SET FOREIGN_KEY_CHECKS = 0;
DELETE FROM RPJ_PRC_APLICACION_PAGO_BEN;
DELETE FROM RPJ_PRC_DEUDA_BENEFICIARIO;
DELETE FROM RPJ_MNT_TUTOR;
DELETE FROM RPJ_MNT_BENEFICIARIO;
DELETE FROM RPJ_MNT_OTRO_DESCUENTO;
DELETE FROM RPJ_PRC_APLICACION_PAGO;
DELETE FROM RPJ_PRC_NOMINA_DESCUENTO;
DELETE FROM RPJ_PRC_NOMINA_INGRESO;
DELETE FROM RPJ_PRC_DEUDA_JUBILADO;
DELETE FROM RPJ_MNT_PRESTAMOS_REGIMEN;
DELETE FROM RPJ_MNT_DATOS_PLANILLA;
DELETE FROM RPJ_MNT_SALARIO;
DELETE FROM RPJ_MNT_JUBILADO;
DELETE FROM RPJ_CAT_PARAMETRO_PLANILLA;
DELETE FROM RPJ_LOG_REVERSOS;
SET FOREIGN_KEY_CHECKS = 1;

INSERT INTO RPJ_MNT_JUBILADO (jub_correlativo, jub_tipo_manejo, jub_id, jub_nombres, jub_apellidos, jub_fecha_nacimiento, jub_dpi, jub_direccion, jub_profesion_oficio, jub_estado_civil, jub_estado, jub_fecha_jubilacion, jub_tipo_jubilacion, jub_usuario_creacion, jub_tipo_pago, jub_estado_pago) VALUES
 (1, 2, 1, 'JUAN',  'PEREZ (EXCEL)',     '1955-01-01', '9000000000001', 'PRUEBA', 'PRUEBA', 'CASADO', 'ACTIVO', '2019-01-01', 1, 'prueba', 'NORMAL', 'ACTIVO'),
 (2, 2, 2, 'ANA',   'INGRESO 2025',      '1960-01-01', '9000000000002', 'PRUEBA', 'PRUEBA', 'CASADO', 'ACTIVO', '2025-06-15', 1, 'prueba', 'NORMAL', 'ACTIVO'),
 (3, 2, 3, 'BETO',  'PRESTAMO BI',       '1955-01-01', '9000000000003', 'PRUEBA', 'PRUEBA', 'CASADO', 'ACTIVO', '2018-01-01', 1, 'prueba', 'NORMAL', 'ACTIVO'),
 (4, 2, 4, 'CARLA', 'DOS PRESTAMOS',     '1955-01-01', '9000000000004', 'PRUEBA', 'PRUEBA', 'CASADO', 'ACTIVO', '2018-01-01', 1, 'prueba', 'NORMAL', 'ACTIVO'),
 (5, 2, 5, 'ELSA',  'SIN PENSION',       '1955-01-01', '9000000000005', 'PRUEBA', 'PRUEBA', 'CASADO', 'ACTIVO', '2018-01-01', 1, 'prueba', 'NORMAL', 'ACTIVO'),
 (6, 2, 6, 'FABIO', 'RENOVACIONES',      '1955-01-01', '9000000000006', 'PRUEBA', 'PRUEBA', 'CASADO', 'ACTIVO', '2018-01-01', 1, 'prueba', 'NORMAL', 'ACTIVO');

-- Elsa (5) no tiene pensión registrada: no debe generar deuda.
INSERT INTO RPJ_MNT_SALARIO (sal_tipo_manejo, sal_id_jubilado, sal_tipo_ingreso, sal_salario, sal_usuario_creacion) VALUES
 (2, 1, 1, 8000.00, 'prueba'), (2, 2, 1, 6000.00, 'prueba'), (2, 3, 1, 5000.00, 'prueba'), (2, 4, 1, 7000.00, 'prueba'),
 (2, 6, 1, 5000.00, 'prueba');

-- Solo asociación (como hoy en producción); sin IGSS ni ISR.
INSERT INTO RPJ_MNT_DATOS_PLANILLA (dat_tipo_manejo, dat_id_jubilado, dat_id_banco, dat_forma_pago, dat_cuenta, dat_tipo_cuenta, dat_aplica_desc_igss, dat_aplica_desc_isr, dat_aplica_nomina, dat_aplica_dasociacion, dat_aplica_intecap, dat_usuario_creacion)
SELECT 2, jub_correlativo, 1, 'DEPOSITO', '000', 'MONETARIA', 0, 0, 1, 1, 0, 'prueba' FROM RPJ_MNT_JUBILADO;

INSERT INTO RPJ_MNT_PRESTAMOS_REGIMEN (prr_correlativo, prr_tipo_manejo, prr_id_jubilado, prr_id_banco, prr_no_referencia, prr_monto, prr_valor_mes, prr_saldo, prr_no_cuotas, prr_fecha_inicio, prr_fecha_fin, prr_estado, prr_usuario_creacion) VALUES
 (1, 2, 1, 2, 'P-JUAN',  120000, 2000.00, 30000.00, 60, '2023-01-01', '2027-12-31', 'ACTIVO', 'prueba'),
 (2, 2, 3, 4, 'P-BI',     24000,  500.00,  6000.00, 48, '2024-01-01', '2027-12-31', 'ACTIVO', 'prueba'),
 (3, 2, 4, 1, 'P-RURAL',  14400,  300.00,  3000.00, 48, '2024-01-01', '2027-12-31', 'ACTIVO', 'prueba'),
 (4, 2, 4, 2, 'P-TRAB',   33600,  700.00,  7000.00, 48, '2024-01-01', '2027-12-31', 'ACTIVO', 'prueba'),
 -- Fabio: renovó (BANRURAL terminado -> BANTRAB), uno creado por error y uno que empieza en el futuro.
 (5, 2, 6, 1, 'F-VIEJO',   5400,  300.00,     0.00, 18, '2023-01-01', '2024-06-30', 'INACTIVO', 'prueba'),
 (6, 2, 6, 2, 'F-NUEVO',  29400,  700.00,  7000.00, 42, '2024-07-01', '2027-12-31', 'ACTIVO', 'prueba'),
 (7, 2, 6, 4, 'F-ERROR',    999,  999.00,   999.00,  1, '2023-01-01', '2027-12-31', 'ANULADO', 'prueba'),
 (8, 2, 6, 3, 'F-FUTURO',  1200,  100.00,  1200.00, 12, '2030-01-01', '2030-12-31', 'ACTIVO', 'prueba');

INSERT INTO RPJ_CAT_PARAMETRO_PLANILLA (ppl_correlativo, ppl_tipo_planilla, ppl_numero, ppl_fecha_inicio, ppl_fecha_final, ppl_fecha_pago, ppl_frecuencia, ppl_estado, ppl_aplica_porcentaje, ppl_porcentaje_pago, ppl_estado_proceso, ppl_usuario_creacion)
VALUES (900, 2, CAST(DATE_FORMAT(CURDATE(), '%Y%m') AS UNSIGNED), DATE_FORMAT(CURDATE(), '%Y-%m-01'), LAST_DAY(CURDATE()), LAST_DAY(CURDATE()), 'MENSUAL', 'ACTIVO', 1, 50.00, 'ABIERTA', 'prueba');

-- Planilla REAL del mes anterior hecha a mano con un solo jubilado (Beto): la carga
-- histórica debe completar a los demás sin tocar el renglón de Beto.
INSERT INTO RPJ_CAT_PARAMETRO_PLANILLA (ppl_correlativo, ppl_tipo_planilla, ppl_numero, ppl_fecha_inicio, ppl_fecha_final, ppl_fecha_pago, ppl_frecuencia, ppl_estado, ppl_aplica_porcentaje, ppl_porcentaje_pago, ppl_estado_proceso, ppl_usuario_creacion)
VALUES (899, 2, CAST(DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 1 MONTH), '%Y%m') AS UNSIGNED), DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 1 MONTH), '%Y-%m-01'), LAST_DAY(DATE_SUB(CURDATE(), INTERVAL 1 MONTH)), LAST_DAY(DATE_SUB(CURDATE(), INTERVAL 1 MONTH)), 'MENSUAL', 'GRABADO', 1, 50.00, 'CERRADA', 'prueba');
INSERT INTO RPJ_PRC_NOMINA_INGRESO (nin_tipo_manejo, nin_id_tipo_planilla, nin_id_planilla, nin_id_jubilado, nin_tipo_ingreso, nin_valor, nin_valor_teorico, nin_porcentaje_aplicado, nin_pago_corriente, nin_abono_historico, nin_dias_trabajados, nin_puesto, nin_area, nin_usuario_creacion)
VALUES (2, 2, 899, 3, 1, 2500.00, 5000.00, 50.00, 2500.00, 0.00, 30, 'JUBILADO', 'ADMINISTRATIVA', 'prueba');
