const logger = require("../config/logger");
const { pool } = require("../config/db");
const getSql = require("../utils/sqlLoader");

const sql = (file) => getSql(`reportes/regimen/${file}.sql`).replace("/*WHERE_CLAUSE*/", "");

const number = (v) => Number(v || 0);

const mapPrestamo = (row) => ({
  id: row.prr_id,
  noContrato: row.prr_no_contrato,
  tipoPersona: row.prr_tipo_persona,
  personaNombre: row.persona_nombre,
  manejoDescripcion: row.manejo_descripcion,
  bancoNombre: row.banco_nombre,
  monto: number(row.prr_monto),
  cuota: number(row.prr_cuota),
  plazoMeses: row.prr_plazo_meses,
  fechaInicio: row.prr_fecha_inicio,
  fechaFin: row.prr_fecha_fin,
  tasaInteres: number(row.prr_tasa_interes),
  estado: row.prr_estado,
  observaciones: row.prr_observaciones,
  fechaCreacion: row.prr_fecha_creacion
});

const mapJunta = (row) => ({
  id: row.jun_correlativo,
  idJunta: row.jun_id,
  nombre: row.jun_nombre,
  apellidos: row.jun_apellidos,
  tipoJunta: row.jun_tipo_junta,
  nit: row.jun_nit,
  puesto: row.jun_puesto,
  estado: row.jun_estado,
  fechaInicio: row.jun_fecha_inicio,
  fechaFinal: row.jun_fecha_final,
  manejoDescripcion: row.manejo_descripcion
});

const mapDieta = (row) => ({
  id: row.die_correlativo,
  miembroNombre: row.miembro_nombre,
  puesto: row.jun_puesto,
  tipoJunta: row.jun_tipo_junta,
  manejoDescripcion: row.manejo_descripcion,
  valor: number(row.die_valor),
  retencionIsr: number(row.die_retencion_isr),
  liquido: number(row.die_liquido),
  fechaSesion: row.die_fecha_sesion,
  fechaPago: row.die_fecha_pago,
  sesionesMes: row.die_sesiones_mes,
  acta: row.die_acta
});

const mapEmpleado = (row) => ({
  id: row.emp_correlativo,
  idEmpleado: row.emp_id,
  nombres: row.emp_nombres,
  apellidos: row.emp_apellidos,
  sexo: row.emp_sexo,
  dpi: row.emp_dpi,
  estadoCivil: row.emp_estado_civil,
  fechaNacimiento: row.emp_fecha_nacimiento,
  tipoPuesto: row.emp_tipo_puesto,
  puestoNombre: row.puesto_nombre,
  areaDescripcion: row.area_descripcion,
  manejoDescripcion: row.manejo_descripcion
});

const mapAportacion = (row) => ({
  id: row.apo_correlativo,
  aportanteId: row.apo_id,
  nombre: row.apo_nombre,
  apellido: row.apo_apellido,
  dpi: row.apo_dpi,
  gerencia: row.apo_gerencia,
  estado: row.apo_estado,
  manejoDescripcion: row.manejo_descripcion,
  totalAportado: number(row.total_aportado),
  cantidadAportes: number(row.cantidad_aportes)
});

const getPrestamosRegimen = async () => {
  logger.info("Reporte préstamos régimen solicitado");
  const [rows] = await pool.query(sql("reportePrestamosRegimen"));
  return rows.map(mapPrestamo);
};

const getJuntaDirectiva = async () => {
  logger.info("Reporte junta directiva solicitado");
  const [rows] = await pool.query(sql("reporteJunta"));
  return rows.map(mapJunta);
};

const getDietas = async () => {
  logger.info("Reporte dietas solicitado");
  const [rows] = await pool.query(sql("reporteDietas"));
  return rows.map(mapDieta);
};

const getEmpleadosRegimen = async () => {
  logger.info("Reporte empleados régimen solicitado");
  const [rows] = await pool.query(sql("reporteEmpleadosRegimen"));
  return rows.map(mapEmpleado);
};

const getAportaciones = async () => {
  logger.info("Reporte aportaciones empleados solicitado");
  const [rows] = await pool.query(sql("reporteAportaciones"));
  return rows.map(mapAportacion);
};

module.exports = { getPrestamosRegimen, getJuntaDirectiva, getDietas, getEmpleadosRegimen, getAportaciones };
