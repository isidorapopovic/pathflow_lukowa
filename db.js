const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

const createTablesQuery = `
  CREATE TABLE IF NOT EXISTS job_applications (
    id SERIAL PRIMARY KEY,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL,
    previous_job TEXT,
    years_on_job INT,
    expected_salary NUMERIC(10,2)
  );

  CREATE TABLE IF NOT EXISTS job_postings (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    location TEXT,
    salary NUMERIC(10,2),
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`;

pool.query(createTablesQuery)
    .then(() => {
        console.log("job_applications and job_postings tables are ready");
    })
    .catch((err) => {
        console.error("Error creating tables:", err);
    });



module.exports = pool;
