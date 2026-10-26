# Pruebas de la planilla de jubilados

Corren contra una base **local** `rpj_pruebas` (estructura de producción, sin datos reales)
con jubilados ficticios. Nunca tocan producción.

## Preparar la base local (una vez)
1. MySQL 8 local (`brew install mysql@8.0 && brew services start mysql@8.0`).
2. Crear `rpj_pruebas` con la estructura (`mysqldump --no-data --routines` de producción,
   quitando los `DEFINER`) y copiar los catálogos (`RPJ_CAT_*`).
3. Instalar la migración a probar apuntando a la base local:
   `DB_HOST=127.0.0.1 DB_USER=root DB_PASSWORD= DB_NAME=rpj_pruebas node scripts/runSqlFile.js sql/migraciones/<archivo>.sql`

## Correr
`MYSQL_BIN=/opt/homebrew/opt/mysql@8.0/bin/mysql node pruebas/planilla-jubilados/regla_50_liquido.test.js`

Casos: Juan (ejemplo del Excel), sin deuda, préstamo BI, dos préstamos, abono que alcanza
para varios meses; generar, reversar completa, regenerar y reversar un solo jubilado.
