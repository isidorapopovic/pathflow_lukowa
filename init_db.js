// scripts/init_db.js
const pool = require("../db_pg");

async function init() {
    await pool.query(`
    CREATE TABLE IF NOT EXISTS applications (
      id SERIAL PRIMARY KEY,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      job_id INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

    console.log("applications table ready");
    await pool.end();
}

init().catch((e) => {
    console.error("init failed:", e);
    process.exit(1);
});
