SELECT
  par_id,
  par_nombre_empresa,
  par_nit,
  par_telefono,
  par_correo,
  par_iva,
  par_porcentaje_pagos,
  par_isr,
  par_porcentaje_tiempo_extra,
  par_pago_dieta,
  par_igss,
  par_igss_patronal,
  par_intecap,
  par_desc_asociacion,
  par_porcentaje_tiemext_doble,
  par_fecha_creacion,
  par_usuario_creacion
FROM RPJ_CAT_PARAMETRO_GENERAL
ORDER BY par_id ASC;
