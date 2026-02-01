// app.js
// -----------------------------------------
// Pathflow recruiting app (Node + Express + EJS)
// - Applicants: fill full info once -> view jobs -> apply with note per job
// - HR: login -> manage jobs -> see applicants & job applications
// -----------------------------------------

const express = require('express');
const session = require('express-session');
const mysql = require('mysql2/promise');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server on ${PORT}`));


// ---------- 1. MySQL connection (EDIT THIS) ----------
const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',       // TODO: change
    password: 'Lukowa123!', // TODO: change
    database: 'job_applications', // TODO: change if your DB has a different name
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
});

// ---------- 2. Basic Express & EJS setup ----------
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'templates'));

// ---------- 3. Sessions ----------
const HR_PASSWORD = '1234'; // TODO: change

app.use(
    session({
        secret: 'pathflow_secret_please_change_me', // TODO: change
        resave: false,
        saveUninitialized: false,
    })
);

function requireHR(req, res, next) {
    if (req.session && req.session.isHR) return next();
    return res.redirect('/hr/login');
}

// ---------- 4. Landing ----------
app.get('/', (req, res) => {
  // lets the landing page route recruiters smartly
  res.render('landing', { isHR: !!(req.session && req.session.isHR) }); // landing.ejs
});


// ---------- 5. Applicant info (master applicant record) ----------
app.get('/applicant/info', (req, res) => {
    const info = req.session.applicantInfo || null;
    res.render('applicant_info', { info, error: null }); // applicant_info.ejs
});

app.post('/applicant/info', async (req, res) => {
    const { full_name, email, previous_job, years, salary } = req.body;

    if (!full_name || !email || !previous_job || !years || !salary) {
        return res.render('applicant_info', {
            info: { full_name, email, previous_job, years, salary },
            error: 'Please fill in all fields.',
        });
    }

    try {
        const yearsNum = Number(years);
        const salaryNum = Number(salary);

        // Store applicant master data in applications table
        const [result] = await pool.query(
            `INSERT INTO applications
       (full_name, email, previous_job, years, salary)
       VALUES (?, ?, ?, ?, ?)`,
            [full_name, email, previous_job, yearsNum, salaryNum]
        );

        const applicantId = result.insertId;

        // Store in session so we know who they are
        req.session.applicantId = applicantId;
        req.session.applicantInfo = {
            full_name,
            email,
            previous_job,
            years: yearsNum,
            salary: salaryNum,
        };

        res.redirect('/jobs');
    } catch (err) {
        console.error('Error saving applicant info:', err);
        res.status(500).send('Error saving your information.');
    }
});

// Helper: ensure applicant exists in session
function requireApplicant(req, res, next) {
    if (!req.session.applicantId || !req.session.applicantInfo) {
        return res.redirect('/applicant/info');
    }
    next();
}

// ---------- 6. Applicant: jobs ----------
app.get('/jobs', requireApplicant, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT id, position_name, company, expected_years_exp, expected_salary
       FROM job_postings
       ORDER BY created_at DESC`
        );
        res.render('jobs', { rows }); // jobs.ejs
    } catch (err) {
        console.error('Error loading jobs:', err);
        res.status(500).send('Error loading job postings.');
    }
});

// ---------- 7. Applicant: apply to a job ----------
app.get('/apply/:jobId', requireApplicant, async (req, res) => {
    const { jobId } = req.params;

    try {
        const [rows] = await pool.query(
            `SELECT id, position_name, company
       FROM job_postings
       WHERE id = ?`,
            [jobId]
        );
        const job = rows[0];
        if (!job) return res.status(404).send('Job not found.');

        const applicant = req.session.applicantInfo;
        res.render('apply', { job, applicant, error: null }); // apply.ejs
    } catch (err) {
        console.error('Error loading job for apply:', err);
        res.status(500).send('Error loading job.');
    }
});

app.post('/apply/:jobId', requireApplicant, async (req, res) => {
    const { jobId } = req.params;
    const { note } = req.body;
    const applicantId = req.session.applicantId;

    if (!note || note.trim().length < 3) {
        // reload form with error
        try {
            const [rows] = await pool.query(
                `SELECT id, position_name, company
         FROM job_postings
         WHERE id = ?`,
                [jobId]
            );
            const job = rows[0];
            if (!job) return res.status(404).send('Job not found.');
            const applicant = req.session.applicantInfo;
            return res.render('apply', {
                job,
                applicant,
                error: 'Please add a short message.',
            });
        } catch (err) {
            console.error('Error reloading job for apply:', err);
            return res.status(500).send('Error submitting application.');
        }
    }

    try {
        await pool.query(
            `INSERT INTO job_applications
       (applicant_id, job_id, note)
       VALUES (?, ?, ?)`,
            [applicantId, jobId, note]
        );

        res.render('app_submitted'); // app_submitted.ejs
    } catch (err) {
        console.error('Error saving job application:', err);
        res.status(500).send('Error saving your application.');
    }
});

// ---------- 8. HR login / logout ----------
app.get('/hr/login', (req, res) => {
    res.render('hr_login', { error: null }); // hr_login.ejs
});

app.post('/hr/login', (req, res) => {
    const { password } = req.body;
    if (password === HR_PASSWORD) {
        req.session.isHR = true;
        return res.redirect('/hr/jobs');
    }
    res.render('hr_login', { error: 'Wrong password.' });
});

app.get('/hr/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/hr/login'));
});

// ---------- 9. HR: job postings ----------
app.get('/hr', requireHR, (req, res) => res.redirect('/hr/jobs'));

app.get('/hr/jobs', requireHR, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT id, position_name, company, expected_years_exp, expected_salary,
              recruiter_name, created_at
       FROM job_postings
       ORDER BY created_at DESC`
        );
        res.render('hr_jobs', { rows }); // hr_jobs.ejs
    } catch (err) {
        console.error('Error loading HR jobs:', err);
        res.status(500).send('Error loading job postings.');
    }
});

app.get('/hr/jobs/new', requireHR, (req, res) => {
    res.render('hr_new_job'); // hr_new_job.ejs
});

app.post('/hr/jobs/new', requireHR, async (req, res) => {
    const {
        position_name,
        position_description,
        company,
        expected_years_exp,
        expected_salary,
        recruiter_name,
    } = req.body;

    try {
        await pool.query(
            `INSERT INTO job_postings
       (position_name, position_description, company, expected_years_exp, expected_salary, recruiter_name)
       VALUES (?, ?, ?, ?, ?, ?)`,
            [
                position_name,
                position_description,
                company,
                expected_years_exp,
                expected_salary || null,
                recruiter_name,
            ]
        );
        res.redirect('/hr/jobs');
    } catch (err) {
        console.error('Error inserting job posting:', err);
        res.status(500).send('Error creating job posting.');
    }
});

app.get('/hr/jobs/:id', requireHR, async (req, res) => {
    const { id } = req.params;
    try {
        const [[job]] = await pool.query(`SELECT * FROM job_postings WHERE id = ?`, [id]);
        if (!job) return res.status(404).send('Job not found.');
        res.render('hr_job_detail', { job }); // hr_job_detail.ejs
    } catch (err) {
        console.error('Error loading job detail:', err);
        res.status(500).send('Error loading job.');
    }
});

// ---------- 10. HR: all applicants ----------
app.get('/hr/applicants', requireHR, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT id, full_name, email, previous_job, years, salary, created_at
       FROM applications
       ORDER BY created_at DESC`
        );
        res.render('hr_applicants', { rows }); // templates/hr_applicants.ejs
    } catch (err) {
        console.error('Error loading applicants:', err);
        res.status(500).send('Error loading applicants.');
    }
});



// ---------- 11. HR: applications per job ----------
app.get('/hr/applications', requireHR, async (req, res) => {
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
        sql += ' WHERE j.id = ?';
        params.push(jobFilter);
    }

    sql += ' ORDER BY ja.created_at DESC';

    try {
        const [rows] = await pool.query(sql, params);
        res.render('hr_applications', { rows }); // hr_applications.ejs
    } catch (err) {
        console.error('Error loading applications:', err);
        res.status(500).send('Error loading applications.');
    }
});

// ---------- 12. Fallback 404 ----------
app.use((req, res) => {
    res.status(404).send('404  Page not found: ' + req.originalUrl);
});

// ---------- 13. Start server ----------
app.listen(PORT, () => {
    console.log(`Pathflow recruiting app running at http://localhost:${PORT}`);
});


