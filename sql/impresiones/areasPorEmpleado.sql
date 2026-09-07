-- Mapa empleado -> área y puesto, para las impresiones que agrupan por área.
--
-- Va como consulta APARTE (y no como JOIN dentro de cada reporte) a propósito:
-- si el catálogo de áreas/puestos no existe o está incompleto en un ambiente,
-- el reporte igual sale (todos bajo "SIN AREA") en vez de fallar entero.
SELECT
  e.emp_correlativo   AS id_empleado,
  pu.pue_nombre       AS puesto,
  ar.are_descripcion  AS area
FROM RPJ_MNT_EMPLEADO e
LEFT JOIN RPJ_CAT_PUESTO pu ON pu.pue_id = e.emp_id_puesto
LEFT JOIN RPJ_CAT_AREA   ar ON ar.are_id = pu.pue_id_area;
