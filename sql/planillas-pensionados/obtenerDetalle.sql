SELECT
  id_jubilado, dpi, nombre_completo, fecha_jubilacion,
  pension_teorica, porcentaje_aplicado, pago_corriente,
  abono_historico, periodo_aplicado, total_ingreso,
  total_descuentos, neto_a_pagar, estado_planilla,
  cuenta_banco, forma_pago, banco_nombre
FROM V_DETALLE_NOMINA_PENSIONADOS
WHERE id_planilla = ?
ORDER BY nombre_completo ASC;
