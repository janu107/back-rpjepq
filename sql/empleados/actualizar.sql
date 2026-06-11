UPDATE RPJ_MNT_EMPLEADO
SET
  emp_tipo_manejo = ?,
  emp_id = ?,
  emp_nombres = ?,
  emp_apellidos = ?,
  emp_direccion = ?,
  emp_nit = ?,
  emp_dpi = ?,
  emp_estado_civil = ?,
  emp_profesion_oficio = ?,
  emp_fecha_nacimiento = ?,
  emp_fecha_ingreso = ?,
  emp_sexo = ?,
  emp_tipo_puesto = ?,
  emp_id_puesto = ?
WHERE emp_correlativo = ?;
