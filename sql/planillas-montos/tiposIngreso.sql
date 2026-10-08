-- Tipos de ingreso para agregar renglones manuales en la edición de montos.
SELECT ti.tin_id AS id,
       CASE WHEN ti.tin_tipo_ingreso REGEXP '^[0-9]+$' AND COALESCE(ti.tin_descripcion, '') <> ''
            THEN CONCAT(ti.tin_tipo_ingreso, ' - ', ti.tin_descripcion)
            ELSE COALESCE(ti.tin_tipo_ingreso, ti.tin_descripcion, 'INGRESO') END AS nombre
  FROM RPJ_CAT_TIPO_INGRESO ti
 ORDER BY ti.tin_id;
