require("dotenv").config();

const express = require("express");
const session = require("express-session");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 4000;

// ---------- 1) Postgres / Neon connection ----------
const connectionString =
    process.env.DATABASE_URL ||
    "postgresql://neondb_owner:npg_eZnKWGlc0aX4@ep-little-glade-anr49t1z-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";

const isNeon = connectionString.includes("neon.tech");
const wantsSsl =
    isNeon ||
    /sslmode=require/i.test(connectionString) ||
    /sslmode=verify-ca/i.test(connectionString) ||
    /sslmode=verify-full/i.test(connectionString);

const pool = new Pool({
    connectionString,
    ssl: wantsSsl ? { rejectUnauthorized: false } : false,
});

console.log("✅ Using PostgreSQL connection");
if (isNeon) {
    console.log("✅ Neon database detected");
}

// Optional DB connection test
pool
    .query("SELECT NOW()")
    .then(() => console.log("✅ Database connection successful"))
    .catch((err) => {
        console.error("❌ Database connection failed:", err);
        process.exit(1);
    });

// ---------- 2) Basic Express & EJS setup ----------
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "templates"));

// ---------- 3) Sessions ----------
const HR_PASSWORD = process.env.HR_PASSWORD || "1234";

app.use(
    session({
        secret: process.env.SESSION_SECRET || "pathflow_secret_please_change_me",
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: false, // keep false for local development on http://localhost
            httpOnly: true,
            sameSite: "lax",
        },
    })
);

function isJsonRequest(req) {
    const accept = req.headers.accept || "";
    return req.originalUrl.startsWith("/api/") || accept.includes("application/json");
}

function requireHR(req, res, next) {
    if (req.session && req.session.isHR) return next();
    if (isJsonRequest(req)) return res.status(401).json({ error: "Not authenticated" });
    return res.redirect("/hr/login");
}

function requireApplicant(req, res, next) {
    if (!req.session.applicantId || !req.session.applicantInfo) {
        if (isJsonRequest(req)) return res.status(401).json({ error: "Applicant not set" });
        return res.redirect("/applicant/info");
    }
    next();
}

// ---------- 4) DB schema init ----------
async function initDb() {
    await pool.query(`
    CREATE TABLE IF NOT EXISTS applications (
      id SERIAL PRIMARY KEY,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL,
      previous_job TEXT NOT NULL,
      years INTEGER NOT NULL,
      salary NUMERIC NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

    await pool.query(`
    CREATE TABLE IF NOT EXISTS job_postings (
      id SERIAL PRIMARY KEY,
      position_name TEXT NOT NULL,
      position_description TEXT,
      company TEXT NOT NULL,
      expected_years_exp INTEGER,
      expected_salary NUMERIC,
      recruiter_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

    await pool.query(`
    CREATE TABLE IF NOT EXISTS job_applications (
      id SERIAL PRIMARY KEY,
      applicant_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      job_id INTEGER NOT NULL REFERENCES job_postings(id) ON DELETE CASCADE,
      note TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

    await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_job_apps_applicant_id
    ON job_applications(applicant_id);
  `);

    await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_job_apps_job_id
    ON job_applications(job_id);
  `);
}

initDb()
    .then(() => console.log("✅ Database ready"))
    .catch((err) => {
        console.error("❌ Database init error:", err);
        process.exit(1);
    });

// ---------- 5) Landing ----------
app.get("/", (req, res) => {
    res.render("landing", { isHR: !!(req.session && req.session.isHR) });
});

// ---------- 6) Applicant info ----------
app.get("/applicant/info", (req, res) => {
    const info = req.session.applicantInfo || null;
    res.render("applicant_info", { info, error: null });
});

app.post("/applicant/info", async (req, res) => {
    const { full_name, email, previous_job, years, salary } = req.body;

    if (!full_name || !email || !previous_job || !years || !salary) {
        return res.render("applicant_info", {
            info: { full_name, email, previous_job, years, salary },
            error: "Please fill in all fields.",
        });
    }

    try {
        const yearsNum = Number(years);
        const salaryNum = Number(salary);

        if (!Number.isFinite(yearsNum) || !Number.isFinite(salaryNum)) {
            return res.render("applicant_info", {
                info: { full_name, email, previous_job, years, salary },
                error: "Years and salary must be numbers.",
            });
        }

        const result = await pool.query(
            `INSERT INTO applications (full_name, email, previous_job, years, salary)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
            [full_name.trim(), email.trim(), previous_job.trim(), yearsNum, salaryNum]
        );

        const applicantId = result.rows[0].id;

        req.session.applicantId = applicantId;
        req.session.applicantInfo = {
            full_name: full_name.trim(),
            email: email.trim(),
            previous_job: previous_job.trim(),
            years: yearsNum,
            salary: salaryNum,
        };

        res.redirect("/jobs");
    } catch (err) {
        console.error("Error saving applicant info:", err);
        res.status(500).send("Error saving your information.");
    }
});

// ---------- 7) Applicant: jobs ----------
app.get("/jobs", requireApplicant, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, position_name, company, expected_years_exp, expected_salary
       FROM job_postings
       ORDER BY created_at DESC`
        );
        res.render("jobs", { rows: result.rows });
    } catch (err) {
        console.error("Error loading jobs:", err);
        res.status(500).send("Error loading job postings.");
    }
});

app.get("/api/jobs", requireApplicant, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, position_name, company, expected_years_exp, expected_salary
       FROM job_postings
       ORDER BY created_at DESC`
        );
        res.json({ rows: result.rows });
    } catch (err) {
        console.error("Error loading jobs (API):", err);
        res.status(500).json({ error: "Error loading job postings." });
    }
});

// ---------- 8) Applicant: apply ----------
app.get("/apply/:jobId", requireApplicant, async (req, res) => {
    const { jobId } = req.params;

    try {
        const result = await pool.query(
            `SELECT id, position_name, company
       FROM job_postings
       WHERE id = $1`,
            [jobId]
        );

        const job = result.rows[0];
        if (!job) return res.status(404).send("Job not found.");

        const applicant = req.session.applicantInfo;
        res.render("apply", { job, applicant, error: null });
    } catch (err) {
        console.error("Error loading job for apply:", err);
        res.status(500).send("Error loading job.");
    }
});

app.post("/apply/:jobId", requireApplicant, async (req, res) => {
    const { jobId } = req.params;
    const { note } = req.body;
    const applicantId = req.session.applicantId;

    if (!note || note.trim().length < 3) {
        try {
            const result = await pool.query(
                `SELECT id, position_name, company
         FROM job_postings
         WHERE id = $1`,
                [jobId]
            );
            const job = result.rows[0];
            if (!job) return res.status(404).send("Job not found.");

            const applicant = req.session.applicantInfo;
            return res.render("apply", { job, applicant, error: "Please add a short message." });
        } catch (err) {
            console.error("Error reloading job for apply:", err);
            return res.status(500).send("Error submitting application.");
        }
    }

    try {
        await pool.query(
            `INSERT INTO job_applications (applicant_id, job_id, note)
       VALUES ($1, $2, $3)`,
            [applicantId, jobId, note.trim()]
        );

        res.render("app_submitted");
    } catch (err) {
        console.error("Error saving job application:", err);
        res.status(500).send("Error saving your application.");
    }
});

// ---------- 9) HR login / logout ----------
app.get("/hr/login", (req, res) => {
    res.render("hr_login", { error: null });
});

app.post("/hr/login", (req, res) => {
    const { password } = req.body;
    if (password === HR_PASSWORD) {
        req.session.isHR = true;
        return res.redirect("/hr/jobs");
    }
    res.render("hr_login", { error: "Wrong password." });
});

app.get("/hr/logout", (req, res) => {
    req.session.destroy(() => res.redirect("/hr/login"));
});

// ---------- 10) HR: job postings ----------
app.get("/hr", requireHR, (req, res) => res.redirect("/hr/jobs"));

app.get("/hr/jobs", requireHR, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, position_name, company, expected_years_exp, expected_salary,
              recruiter_name, created_at
       FROM job_postings
       ORDER BY created_at DESC`
        );
        res.render("hr_jobs", { rows: result.rows });
    } catch (err) {
        console.error("Error loading HR jobs:", err);
        res.status(500).send("Error loading job postings.");
    }
});

app.get("/api/hr/jobs", requireHR, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, position_name, company, expected_years_exp, expected_salary,
              recruiter_name, created_at
       FROM job_postings
       ORDER BY created_at DESC`
        );
        res.json({ rows: result.rows });
    } catch (err) {
        console.error("Error loading HR jobs (API):", err);
        res.status(500).json({ error: "Error loading job postings." });
    }
});

app.get("/hr/jobs/new", requireHR, (req, res) => {
    res.render("hr_new_job");
});

app.post("/hr/jobs/new", requireHR, async (req, res) => {
    const {
        position_name,
        position_description,
        company,
        expected_years_exp,
        expected_salary,
        recruiter_name,
    } = req.body;

    try {
        const yearsExp = expected_years_exp ? Number(expected_years_exp) : null;
        const salaryExp = expected_salary ? Number(expected_salary) : null;

        await pool.query(
            `INSERT INTO job_postings
       (position_name, position_description, company, expected_years_exp, expected_salary, recruiter_name)
       VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                position_name,
                position_description || null,
                company,
                Number.isFinite(yearsExp) ? yearsExp : null,
                Number.isFinite(salaryExp) ? salaryExp : null,
                recruiter_name || null,
            ]
        );

        res.redirect("/hr/jobs");
    } catch (err) {
        console.error("Error inserting job posting:", err);
        res.status(500).send("Error creating job posting.");
    }
});

app.get("/hr/jobs/:id", requireHR, async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query(`SELECT * FROM job_postings WHERE id = $1`, [id]);
        const job = result.rows[0];
        if (!job) return res.status(404).send("Job not found.");
        res.render("hr_job_detail", { job });
    } catch (err) {
        console.error("Error loading job detail:", err);
        res.status(500).send("Error loading job.");
    }
});

// ---------- 11) HR: all applicants ----------
app.get("/hr/applicants", requireHR, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, full_name, email, previous_job, years, salary, created_at
       FROM applications
       ORDER BY created_at DESC`
        );
        res.render("hr_applicants", { rows: result.rows });
    } catch (err) {
        console.error("Error loading applicants:", err);
        res.status(500).send("Error loading applicants.");
    }
});

// ---------- 12) HR: applications per job ----------
app.get("/hr/applications", requireHR, async (req, res) => {
    const jobFilter = req.query.job || null;

    let sql = `
    SELECT
      ja.id,
      ja.note,
      ja.created_at,
      a.full_name,
      a.email,
      a.previous_job,
      a.years,
      a.salary,
      j.id AS job_id,
      j.position_name,
      j.company
    FROM job_applications ja
    JOIN applications a ON ja.applicant_id = a.id
    JOIN job_postings j ON ja.job_id = j.id
  `;
    const params = [];

    if (jobFilter) {
        sql += ` WHERE j.id = $1`;
        params.push(jobFilter);
    }

    sql += ` ORDER BY ja.created_at DESC`;

    try {
        const result = await pool.query(sql, params);
        res.render("hr_applications", { rows: result.rows });
    } catch (err) {
        console.error("Error loading applications:", err);
        res.status(500).send("Error loading applications.");
    }
});


// ---------- 13) Fallback 404 ----------
app.use((req, res) => {
    res.status(404).send("404 – Page not found: " + req.originalUrl);
});

// ---------- 14) Start server ----------
app.listen(PORT, () => {
    console.log(`Pathflow recruiting app running on port ${PORT}`);
});