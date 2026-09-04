require("dotenv").config();
const mysql = require("mysql2/promise");
(async () => {
  const c = await mysql.createConnection({ host: process.env.DB_HOST, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME, port: Number(process.env.DB_PORT) });
  const [r] = await c.query("SELECT ROUTINE_DEFINITION d FROM information_schema.routines WHERE routine_schema=DATABASE() AND routine_name=?", [process.argv[2]]);
  console.log(r[0]?.d || "NO EXISTE");
  await c.end();
})();
