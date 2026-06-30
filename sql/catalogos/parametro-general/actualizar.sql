UPDATE RPJ_CAT_PARAMETRO_GENERAL
SET
  par_nombre_empresa = ?,
  par_nit = ?,
  par_telefono = ?,
  par_correo = ?,
  par_iva = ?,
  par_porcentaje_pagos = ?,
  par_isr = ?,
  par_porcentaje_tiempo_extra = ?,
  par_pago_dieta = ?,
  par_igss = ?,
  par_igss_patronal = ?,
  par_intecap = ?,
  par_desc_asociacion = ?,
  par_porcentaje_tiemext_doble = ?
WHERE par_id = ?;
