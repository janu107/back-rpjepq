-- MIGRACION VERSION VI
-- Ejecutar una vez contra la base de datos apps_rpjepq
-- Revisar si las columnas ya existen antes de correr

-- 1. Campo SEXO en aportaciones EPQ (VARCHAR(4) para guardar M/F)
ALTER TABLE RPJ_MNT_APORTACION_EPQ
  ADD COLUMN IF NOT EXISTS apo_sexo VARCHAR(4) NULL AFTER apo_fecha_nacimiento;

-- 2. Relacion salario <-> empleado y jubilado especifico
--    (antes el salario era por tipo de manejo, compartido entre todos)
ALTER TABLE RPJ_MNT_SALARIO
  ADD COLUMN IF NOT EXISTS sal_id_empleado INT NULL AFTER sal_tipo_manejo,
  ADD COLUMN IF NOT EXISTS sal_id_jubilado INT NULL AFTER sal_id_empleado;

-- 3. Indices para acelerar filtros por entidad
CREATE INDEX IF NOT EXISTS idx_salario_empleado ON RPJ_MNT_SALARIO (sal_id_empleado);
CREATE INDEX IF NOT EXISTS idx_salario_jubilado ON RPJ_MNT_SALARIO (sal_id_jubilado);
CREATE INDEX IF NOT EXISTS idx_aportacion_apo_id ON RPJ_MNT_APORTACION_EPQ (apo_id);

-- 4. Directorio de migracion de datos opcional:
--    Los registros de salario existentes quedan con sal_id_empleado = NULL
--    y ya no aparecen en el listado de ningun empleado especifico.
--    Son "heredados" del sistema anterior y no bloquean la operacion.
--    Si se desea limpiarlos ejecutar:
--    DELETE FROM RPJ_MNT_SALARIO WHERE sal_id_empleado IS NULL AND sal_id_jubilado IS NULL;
