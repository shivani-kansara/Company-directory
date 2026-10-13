# Company Directory

A responsive web app to find who works in the company, their department and office, and to add, view, edit and delete employees.

**Stack:** HTML5, CSS3 + Bootstrap 5, JavaScript + jQuery, AJAX, PHP (PDO), MySQL, JSON.

## Features

- 121 employees loaded from MySQL (name, job title, department, location, email, phone)
- Search by name plus department, job title and location filters that work together
- Create, read, update and delete employees (with validation and a delete confirmation)
- Full employee profile with manager and direct reports; change job title, department or office
- Departments and five office locations (London, New York, Paris, Munich, Rome), each linking to its employees
- Success/error messages after every save, update and delete; a helpful message when nothing matches
- Mobile layout with collapsible search and filters and full-screen profile/form dialogs

## Run locally (XAMPP / MAMP / WAMP)

1. Copy this folder into your web root (for XAMPP: `htdocs/company-directory`).
2. Start Apache and MySQL.
3. In MySQL Workbench open `database/company_directory.sql` and run it (lightning icon). It drops and recreates the `company_directory` database, tables and data, so back up any existing data first.
4. Set the `CD_DB_HOST`, `CD_DB_NAME`, `CD_DB_USER`, `CD_DB_PASS` and optional `CD_DB_PORT` environment variables for your PHP server, or create the ignored `php/config.local.php` file with your local settings.
5. Open `http://localhost/company-directory/`.

## Deploy online

1. Upload all files to your host (public_html or similar).
2. Create a MySQL database and user in your host's control panel and import `database/company_directory.sql` (remove the first lines `DROP DATABASE`, `CREATE DATABASE` and `USE`, or edit them to your database name).
3. Set the database environment variables on your host. Do not commit database credentials.

## Database

| Table | Columns |
|---|---|
| `location` | id, name |
| `department` | id, name, locationID |
| `personnel` | id, firstName, lastName, jobTitle, email, phone, departmentID, managerID |

An employee's location comes from their department. If your instructor supplies a different SQL file, adjust the queries in `php/api.php`.

## API (`php/api.php`, all responses are JSON)

| Action | Method | Purpose |
|---|---|---|
| `filters` | GET | Departments, locations, job titles with counts |
| `list` | GET | Employees; optional `search`, `departmentID`, `locationID`, `jobTitle` |
| `get` | GET | One full profile with manager and reports |
| `people` | GET | Names for the manager dropdown |
| `create` / `update` / `delete` | POST | Employee management |

All queries use prepared statements; all output is escaped in the browser.
