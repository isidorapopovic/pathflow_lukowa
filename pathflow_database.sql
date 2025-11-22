CREATE DATABASE job_applications;
USE job_applications;

CREATE TABLE applications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(100),
    email VARCHAR(100),
    previous_job VARCHAR(100),
    years INT,
    salary FLOAT
);

