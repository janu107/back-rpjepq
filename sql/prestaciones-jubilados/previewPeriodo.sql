-- Prestaciones jubilados: previsualización antes de generar (activos, amparistas
-- y beneficiarios) con el % que se vaya a usar. Aplica el mismo criterio que
-- los SP para que el total mostrado sea el real.
-- Params, en orden: [fechaFin, fechaIni, fechaIni, porcentaje,  -- activos NORMAL
--                     fechaFin, fechaIni, fechaIni,              -- amparistas (100 fijo)
--                     fechaFin, fechaIni, fechaIni, porcentaje]. -- beneficiarios
SELECT
  acti.total AS total_activos, acti.estimado AS estimado_activos,
  ampa.total AS total_amparistas, ampa.estimado AS estimado_amparistas,
  bene.total AS total_beneficiarios, bene.estimado AS estimado_beneficiarios
FROM (
  SELECT COUNT(*) AS total, COALESCE(SUM(ROUND(x.pension * x.dias / 365 * ? / 100, 2)), 0) AS estimado
    FROM (
      SELECT s.sal_salario AS pension,
             LEAST(365, GREATEST(0, DATEDIFF(?, GREATEST(?, COALESCE(j.jub_fecha_jubilacion, ?))) + 1)) AS dias
        FROM RPJ_MNT_JUBILADO j
        INNER JOIN RPJ_MNT_SALARIO s ON s.sal_id_jubilado = j.jub_correlativo AND s.sal_tipo_manejo = 2 AND s.sal_tipo_ingreso = 1
       WHERE j.jub_tipo_manejo = 2 AND j.jub_estado = 'ACTIVO' AND j.jub_tipo_pago = 'NORMAL' AND j.jub_estado_pago = 'ACTIVO'
         AND s.sal_salario > 0
    ) x WHERE x.dias > 0
) acti,
(
  SELECT COUNT(*) AS total, COALESCE(SUM(ROUND(x.pension * x.dias / 365, 2)), 0) AS estimado
    FROM (
      SELECT s.sal_salario AS pension,
             LEAST(365, GREATEST(0, DATEDIFF(?, GREATEST(?, COALESCE(j.jub_fecha_jubilacion, ?))) + 1)) AS dias
        FROM RPJ_MNT_JUBILADO j
        INNER JOIN RPJ_MNT_SALARIO s ON s.sal_id_jubilado = j.jub_correlativo AND s.sal_tipo_manejo = 2 AND s.sal_tipo_ingreso = 1
       WHERE j.jub_tipo_manejo = 2 AND j.jub_estado = 'ACTIVO' AND j.jub_tipo_pago = 'AMPARISTA' AND j.jub_estado_pago = 'ACTIVO'
         AND s.sal_salario > 0
    ) x WHERE x.dias > 0
) ampa,
(
  SELECT COUNT(*) AS total, COALESCE(SUM(ROUND(x.pension * x.dias / 365 * ? / 100 * x.ben_pct / 100, 2)), 0) AS estimado
    FROM (
      SELECT s.sal_salario AS pension, b.ben_porcentaje AS ben_pct,
             LEAST(365, GREATEST(0, DATEDIFF(?, GREATEST(?, COALESCE(j.jub_fecha_jubilacion, ?))) + 1)) AS dias
        FROM RPJ_MNT_BENEFICIARIO b
        INNER JOIN RPJ_MNT_JUBILADO j ON j.jub_correlativo = b.ben_id_jubilado AND j.jub_tipo_manejo = 2 AND j.jub_estado_pago = 'FALLECIDO'
        INNER JOIN RPJ_MNT_SALARIO s ON s.sal_id_jubilado = j.jub_correlativo AND s.sal_tipo_manejo = 2 AND s.sal_tipo_ingreso = 1
       WHERE b.ben_estado = 'ACTIVO' AND s.sal_salario > 0
    ) x WHERE x.dias > 0
) bene;
