-- Prestaciones: crea una planilla de prestación en estado ABIERTA.
-- Params: [tipoPlanilla, numero, fechaInicio, fechaFinal, fechaPago, usuario].
INSERT INTO RPJ_CAT_PARAMETRO_PLANILLA (
  ppl_tipo_planilla,
  ppl_numero,
  ppl_fecha_inicio,
  ppl_fecha_final,
  ppl_fecha_pago,
  ppl_frecuencia,
  ppl_estado,
  ppl_aplica_porcentaje,
  ppl_porcentaje_pago,
  ppl_estado_proceso,
  ppl_usuario_creacion
) VALUES (?, ?, ?, ?, ?, 'ANUAL', 'GRABADO', 0, 100, 'ABIERTA', ?);
