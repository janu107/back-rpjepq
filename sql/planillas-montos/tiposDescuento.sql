-- Tipos de descuento para agregar renglones manuales en la edición de montos.
SELECT td.tde_id AS id,
       CASE WHEN td.tde_tipo_descuento REGEXP '^[0-9]+$' AND COALESCE(td.tde_descripcion, '') <> ''
            THEN CONCAT(td.tde_tipo_descuento, ' - ', td.tde_descripcion)
            ELSE COALESCE(td.tde_tipo_descuento, td.tde_descripcion, 'DESCUENTO') END AS nombre
  FROM RPJ_CAT_TIPO_DESCUENTO td
 ORDER BY td.tde_id;
