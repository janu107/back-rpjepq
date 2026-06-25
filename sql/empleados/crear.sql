INSERT INTO RPJ_MNT_EMPLEADO (
  emp_tipo_manejo,
  emp_id,
  emp_nombres,
  emp_apellidos,
  emp_direccion,
  emp_nit,
  emp_dpi,
  emp_estado_civil,
  emp_profesion_oficio,
  emp_fecha_nacimiento,
  emp_fecha_ingreso,
  emp_sexo,
  emp_tipo_puesto,
  emp_id_puesto,
  emp_estado,
  emp_usuario_creacion
)
-- CAMBIO X: emp_estado se fija en 'ACTIVO' al crear (antes quedaba NULL y el
-- empleado no aparecía como apto para generar nómina).
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVO', ?);
