import os
from flask import Flask, render_template, request, redirect, url_for
from sqlalchemy import create_engine, text

app = Flask(__name__)

# Use DATABASE_URL if present (Railway), otherwise fall back to local MySQL
DATABASE_URL = os.getenv("DATABASE_URL")  # e.g. mysql+mysqlconnector://user:pass@host:port/db
if not DATABASE_URL:
    # LOCAL fallback (edit if your local creds differ)
    DATABASE_URL = "mysql+mysqlconnector://root:Lukowa123!@localhost/job_applications"

engine = create_engine(DATABASE_URL, pool_pre_ping=True)

@app.route('/')
def index():
    return render_template('pathflow_page1.html')

@app.route('/submit', methods=['POST'])
def submit():
    try:
        full_name = request.form.get('full_name','').strip()
        email = request.form.get('email','').strip()
        previous_job = request.form.get('previous_job','').strip()
        years = int(request.form.get('years','0'))
        salary = float(request.form.get('salary','0'))

        with engine.connect() as conn:
            conn.execute(text("""
                INSERT INTO applications (full_name, email, previous_job, years, salary)
                VALUES (:full_name, :email, :previous_job, :years, :salary)
            """), {
                "full_name": full_name,
                "email": email,
                "previous_job": previous_job,
                "years": years,
                "salary": salary
            })
            conn.commit()

        return redirect(url_for('records'))
    except Exception as e:
        return f"Error: {e}", 500

@app.route('/records')
def records():
    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT id, full_name, email, previous_job, years, salary
            FROM applications
            ORDER BY id DESC
        """)).mappings().all()
    return render_template('records.html', rows=rows)

# Railway provides a PORT env var; locally this still works.
if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
