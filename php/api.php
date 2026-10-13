<?php
declare(strict_types=1);

require __DIR__ . '/config.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function respond(bool $ok, string $message, $data = null, array $errors = [], int $http = 200): void
{
    http_response_code($http);
    echo json_encode(
        ['success' => $ok, 'message' => $message, 'data' => $data, 'errors' => (object)$errors],
        JSON_UNESCAPED_UNICODE
    );
    exit;
}

function requirePost(): void
{
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        respond(false, 'This action must be sent with POST.', null, [], 405);
    }
}

function len(string $s): int
{
    return function_exists('mb_strlen') ? mb_strlen($s) : strlen($s);
}

function input(string $key): string
{
    return trim((string)($_POST[$key] ?? ''));
}

function validateLocation(PDO $pdo, ?int $editingId): array
{
    $name = input('name');
    $errors = [];
    if ($name === '') {
        $errors['name'] = 'Location name is required.';
    } elseif (len($name) > 60) {
        $errors['name'] = 'Location name must be 60 characters or fewer.';
    } else {
        $st = $pdo->prepare('SELECT id FROM location WHERE name = ? AND id <> ?');
        $st->execute([$name, $editingId ?? 0]);
        if ($st->fetchColumn()) {
            $errors['name'] = 'A location with this name already exists.';
        }
    }
    return [$name, $errors];
}

function validateDepartment(PDO $pdo, ?int $editingId): array
{
    $name = input('name');
    $locationId = (int)input('locationID');
    $errors = [];
    if ($name === '') {
        $errors['name'] = 'Department name is required.';
    } elseif (len($name) > 80) {
        $errors['name'] = 'Department name must be 80 characters or fewer.';
    } else {
        $st = $pdo->prepare('SELECT id FROM department WHERE name = ? AND id <> ?');
        $st->execute([$name, $editingId ?? 0]);
        if ($st->fetchColumn()) {
            $errors['name'] = 'A department with this name already exists.';
        }
    }

    $st = $pdo->prepare('SELECT COUNT(*) FROM location WHERE id = ?');
    $st->execute([$locationId]);
    if ($locationId < 1 || !$st->fetchColumn()) {
        $errors['locationID'] = 'Choose a valid location.';
    }
    return [['name' => $name, 'locationID' => $locationId], $errors];
}

function executeOrgMutation(PDOStatement $st, array $params): void
{
    try {
        $st->execute($params);
    } catch (PDOException $ex) {
        if ($ex->getCode() === '23000') {
            respond(false, 'The record conflicts with current database data. Refresh and try again.', null, [], 409);
        }
        throw $ex;
    }
}

function deleteRecord(PDO $pdo, PDOStatement $st, array $params, string $conflictMessage): void
{
    try {
        $st->execute($params);
        $pdo->commit();
    } catch (PDOException $ex) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        if ($ex->getCode() === '23000') {
            respond(false, $conflictMessage, null, [], 409);
        }
        throw $ex;
    }
}

const SELECT_EMPLOYEE = "
    SELECT p.id, p.firstName, p.lastName, p.jobTitle, p.email, p.phone,
           p.departmentID, d.name AS department,
           l.id AS locationID, l.name AS location,
           p.managerID
    FROM personnel p
    JOIN department d ON d.id = p.departmentID
    JOIN location l ON l.id = d.locationID";

/** Validate and normalise the employee form fields. */
function validateEmployee(PDO $pdo, ?int $editingId): array
{
    $v = [
        'firstName'    => input('firstName'),
        'lastName'     => input('lastName'),
        'jobTitle'     => input('jobTitle'),
        'email'        => strtolower(input('email')),
        'phone'        => input('phone'),
        'departmentID' => (int)input('departmentID'),
        'managerID'    => input('managerID') === '' ? null : (int)input('managerID'),
    ];
    $e = [];

    foreach (['firstName' => 'First name', 'lastName' => 'Last name', 'jobTitle' => 'Job title'] as $k => $label) {
        if ($v[$k] === '') {
            $e[$k] = "$label is required.";
        } elseif (len($v[$k]) > ($k === 'jobTitle' ? 100 : 50)) {
            $e[$k] = "$label is too long.";
        }
    }
    if ($v['email'] === '' || !filter_var($v['email'], FILTER_VALIDATE_EMAIL) || len($v['email']) > 120) {
        $e['email'] = 'Enter a valid email address, for example name@company.com.';
    }
    if (!preg_match('/^[0-9+()\-\s.]{5,30}$/', $v['phone'])) {
        $e['phone'] = 'Enter a phone number using digits, spaces, + ( ) - only.';
    }

    $st = $pdo->prepare('SELECT COUNT(*) FROM department WHERE id = ?');
    $st->execute([$v['departmentID']]);
    if (!$st->fetchColumn()) {
        $e['departmentID'] = 'Choose a department.';
    }

    if ($v['managerID'] !== null) {
        $st = $pdo->prepare('SELECT COUNT(*) FROM personnel WHERE id = ?');
        $st->execute([$v['managerID']]);
        if (!$st->fetchColumn()) {
            $e['managerID'] = 'The chosen manager does not exist.';
        } elseif ($editingId !== null) {
            // A person cannot report to themselves or to someone who reports to them.
            $cursor = $v['managerID'];
            $guard = 0;
            $q = $pdo->prepare('SELECT managerID FROM personnel WHERE id = ?');
            while ($cursor !== null && $guard++ < 50) {
                if ($cursor === $editingId) {
                    $e['managerID'] = 'An employee cannot report to themselves or to one of their own reports.';
                    break;
                }
                $q->execute([$cursor]);
                $next = $q->fetchColumn();
                $cursor = ($next === false || $next === null) ? null : (int)$next;
            }
        }
    }

    if (!isset($e['email'])) {
        $st = $pdo->prepare('SELECT id FROM personnel WHERE email = ? AND id <> ?');
        $st->execute([$v['email'], $editingId ?? 0]);
        if ($st->fetchColumn()) {
            $e['email'] = 'Another employee already uses this email address.';
        }
    }

    return [$v, $e];
}

try {
    $pdo = db();
    $action = $_GET['action'] ?? $_POST['action'] ?? '';

    switch ($action) {
        // ---------------------------------------------------------------- READ: filter lists + counts
        case 'filters':
            $locations = $pdo->query(
                'SELECT l.id, l.name, COUNT(p.id) AS employeeCount
                 FROM location l
                 LEFT JOIN department d ON d.locationID = l.id
                 LEFT JOIN personnel p ON p.departmentID = d.id
                 GROUP BY l.id, l.name ORDER BY l.name'
            )->fetchAll();
            $departments = $pdo->query(
                'SELECT d.id, d.name, d.locationID, l.name AS location, COUNT(p.id) AS employeeCount
                 FROM department d
                 JOIN location l ON l.id = d.locationID
                 LEFT JOIN personnel p ON p.departmentID = d.id
                 GROUP BY d.id, d.name, d.locationID, l.name ORDER BY d.name'
            )->fetchAll();
            $titles = $pdo->query(
                'SELECT jobTitle AS name, COUNT(*) AS employeeCount FROM personnel GROUP BY jobTitle ORDER BY jobTitle'
            )->fetchAll();
            $total = (int)$pdo->query('SELECT COUNT(*) FROM personnel')->fetchColumn();
            respond(true, 'OK', compact('locations', 'departments', 'titles', 'total'));

        // ---------------------------------------------------------------- READ: list with combined search/filters
        case 'list':
            $where = [];
            $params = [];
            $search = trim((string)($_GET['search'] ?? ''));
            if ($search !== '') {
                $like = '%' . addcslashes($search, '%_\\') . '%';
                $where[] = "(CONCAT(p.firstName, ' ', p.lastName) LIKE :s1 OR CONCAT(p.lastName, ' ', p.firstName) LIKE :s2)";
                $params[':s1'] = $like;
                $params[':s2'] = $like;
            }
            if (($_GET['departmentID'] ?? '') !== '') {
                $where[] = 'p.departmentID = :dep';
                $params[':dep'] = (int)$_GET['departmentID'];
            }
            if (($_GET['locationID'] ?? '') !== '') {
                $where[] = 'l.id = :loc';
                $params[':loc'] = (int)$_GET['locationID'];
            }
            if (trim((string)($_GET['jobTitle'] ?? '')) !== '') {
                $where[] = 'p.jobTitle = :title';
                $params[':title'] = trim((string)$_GET['jobTitle']);
            }
            $sql = SELECT_EMPLOYEE . ($where ? ' WHERE ' . implode(' AND ', $where) : '')
                 . ' ORDER BY p.lastName, p.firstName';
            $st = $pdo->prepare($sql);
            $st->execute($params);
            $rows = $st->fetchAll();
            respond(true, 'OK', $rows);

        // ---------------------------------------------------------------- READ: all names (for manager dropdown)
        case 'people':
            $rows = $pdo->query(
                'SELECT id, firstName, lastName, jobTitle FROM personnel ORDER BY lastName, firstName'
            )->fetchAll();
            respond(true, 'OK', $rows);

        // ---------------------------------------------------------------- READ: one full profile
        case 'get':
            $id = (int)($_GET['id'] ?? 0);
            $st = $pdo->prepare(SELECT_EMPLOYEE . ' WHERE p.id = ?');
            $st->execute([$id]);
            $emp = $st->fetch();
            if (!$emp) {
                respond(false, 'This employee no longer exists. They may have been removed.', null, [], 404);
            }
            $emp['manager'] = null;
            if ($emp['managerID'] !== null) {
                $m = $pdo->prepare('SELECT id, firstName, lastName, jobTitle FROM personnel WHERE id = ?');
                $m->execute([$emp['managerID']]);
                $emp['manager'] = $m->fetch() ?: null;
            }
            $r = $pdo->prepare(
                'SELECT id, firstName, lastName, jobTitle FROM personnel WHERE managerID = ? ORDER BY lastName, firstName'
            );
            $r->execute([$id]);
            $emp['reports'] = $r->fetchAll();
            respond(true, 'OK', $emp);

        // ---------------------------------------------------------------- CREATE
        case 'create':
            requirePost();
            [$v, $e] = validateEmployee($pdo, null);
            if ($e) {
                respond(false, 'Please fix the highlighted fields.', null, $e, 422);
            }
            $st = $pdo->prepare(
                'INSERT INTO personnel (firstName, lastName, jobTitle, email, phone, departmentID, managerID)
                 VALUES (:f, :l, :t, :e, :p, :d, :m)'
            );
            $st->execute([':f' => $v['firstName'], ':l' => $v['lastName'], ':t' => $v['jobTitle'],
                          ':e' => $v['email'], ':p' => $v['phone'], ':d' => $v['departmentID'], ':m' => $v['managerID']]);
            respond(true, "{$v['firstName']} {$v['lastName']} was added to the directory.", ['id' => (int)$pdo->lastInsertId()]);

        // ---------------------------------------------------------------- UPDATE
        case 'update':
            requirePost();
            $id = (int)input('id');
            $st = $pdo->prepare('SELECT COUNT(*) FROM personnel WHERE id = ?');
            $st->execute([$id]);
            if (!$st->fetchColumn()) {
                respond(false, 'This employee no longer exists, so the changes could not be saved.', null, [], 404);
            }
            [$v, $e] = validateEmployee($pdo, $id);
            if ($e) {
                respond(false, 'Please fix the highlighted fields.', null, $e, 422);
            }
            $st = $pdo->prepare(
                'UPDATE personnel SET firstName = :f, lastName = :l, jobTitle = :t, email = :e,
                        phone = :p, departmentID = :d, managerID = :m WHERE id = :id'
            );
            $st->execute([':f' => $v['firstName'], ':l' => $v['lastName'], ':t' => $v['jobTitle'],
                          ':e' => $v['email'], ':p' => $v['phone'], ':d' => $v['departmentID'],
                          ':m' => $v['managerID'], ':id' => $id]);
            respond(true, "{$v['firstName']} {$v['lastName']}'s details were updated.", ['id' => $id]);

        // ---------------------------------------------------------------- DELETE
        case 'delete':
            requirePost();
            $id = (int)input('id');
            $pdo->beginTransaction();
            $st = $pdo->prepare('SELECT firstName, lastName FROM personnel WHERE id = ? FOR UPDATE');
            $st->execute([$id]);
            $emp = $st->fetch();
            if (!$emp) {
                $pdo->rollBack();
                respond(false, 'This employee has already been removed.', null, [], 404);
            }
            $st = $pdo->prepare('SELECT COUNT(*) FROM personnel WHERE managerID = ?');
            $st->execute([$id]);
            $reportCount = (int)$st->fetchColumn();
            if ($reportCount > 0) {
                $pdo->rollBack();
                respond(false, 'This employee cannot be deleted while they have direct reports. Reassign those employees to another manager first.',
                    ['reportCount' => $reportCount], [], 409);
            }
            $st = $pdo->prepare('DELETE FROM personnel WHERE id = ?');
            deleteRecord($pdo, $st, [$id], 'This employee cannot be deleted because another record now depends on them.');
            respond(true, "{$emp['firstName']} {$emp['lastName']} was removed from the directory.");

        // ---------------------------------------------------------------- LOCATIONS
        case 'locationCreate':
            requirePost();
            [$name, $errors] = validateLocation($pdo, null);
            if ($errors) {
                respond(false, 'Please fix the highlighted fields.', null, $errors, 422);
            }
            $st = $pdo->prepare('INSERT INTO location (name) VALUES (?)');
            executeOrgMutation($st, [$name]);
            respond(true, "$name was added as a location.", ['id' => (int)$pdo->lastInsertId()]);

        case 'locationUpdate':
            requirePost();
            $id = (int)input('id');
            $st = $pdo->prepare('SELECT name FROM location WHERE id = ?');
            $st->execute([$id]);
            if (!$st->fetchColumn()) {
                respond(false, 'This location no longer exists.', null, [], 404);
            }
            [$name, $errors] = validateLocation($pdo, $id);
            if ($errors) {
                respond(false, 'Please fix the highlighted fields.', null, $errors, 422);
            }
            $st = $pdo->prepare('UPDATE location SET name = ? WHERE id = ?');
            executeOrgMutation($st, [$name, $id]);
            respond(true, "$name was updated.", ['id' => $id]);

        case 'locationDelete':
            requirePost();
            $id = (int)input('id');
            $pdo->beginTransaction();
            $st = $pdo->prepare('SELECT name FROM location WHERE id = ? FOR UPDATE');
            $st->execute([$id]);
            $location = $st->fetch();
            if (!$location) {
                $pdo->rollBack();
                respond(false, 'This location no longer exists.', null, [], 404);
            }
            $st = $pdo->prepare('SELECT COUNT(*) FROM department WHERE locationID = ?');
            $st->execute([$id]);
            $departmentCount = (int)$st->fetchColumn();
            if ($departmentCount > 0) {
                $pdo->rollBack();
                respond(false, 'This location cannot be deleted while departments use it. Move those departments to another location first.',
                    ['departmentCount' => $departmentCount], [], 409);
            }
            $st = $pdo->prepare('DELETE FROM location WHERE id = ?');
            deleteRecord($pdo, $st, [$id], 'This location cannot be deleted because departments still depend on it.');
            respond(true, "{$location['name']} was removed.");

        // ---------------------------------------------------------------- DEPARTMENTS
        case 'departmentCreate':
            requirePost();
            [$values, $errors] = validateDepartment($pdo, null);
            if ($errors) {
                respond(false, 'Please fix the highlighted fields.', null, $errors, 422);
            }
            $st = $pdo->prepare('INSERT INTO department (name, locationID) VALUES (?, ?)');
            executeOrgMutation($st, [$values['name'], $values['locationID']]);
            respond(true, "{$values['name']} was added as a department.", ['id' => (int)$pdo->lastInsertId()]);

        case 'departmentUpdate':
            requirePost();
            $id = (int)input('id');
            $st = $pdo->prepare('SELECT name FROM department WHERE id = ?');
            $st->execute([$id]);
            if (!$st->fetchColumn()) {
                respond(false, 'This department no longer exists.', null, [], 404);
            }
            [$values, $errors] = validateDepartment($pdo, $id);
            if ($errors) {
                respond(false, 'Please fix the highlighted fields.', null, $errors, 422);
            }
            $st = $pdo->prepare('UPDATE department SET name = ?, locationID = ? WHERE id = ?');
            executeOrgMutation($st, [$values['name'], $values['locationID'], $id]);
            respond(true, "{$values['name']} was updated.", ['id' => $id]);

        case 'departmentDelete':
            requirePost();
            $id = (int)input('id');
            $pdo->beginTransaction();
            $st = $pdo->prepare('SELECT name FROM department WHERE id = ? FOR UPDATE');
            $st->execute([$id]);
            $department = $st->fetch();
            if (!$department) {
                $pdo->rollBack();
                respond(false, 'This department no longer exists.', null, [], 404);
            }
            $st = $pdo->prepare('SELECT COUNT(*) FROM personnel WHERE departmentID = ?');
            $st->execute([$id]);
            $employeeCount = (int)$st->fetchColumn();
            if ($employeeCount > 0) {
                $pdo->rollBack();
                respond(false, 'This department cannot be deleted while employees belong to it. Move those employees to another department first.',
                    ['employeeCount' => $employeeCount], [], 409);
            }
            $st = $pdo->prepare('DELETE FROM department WHERE id = ?');
            deleteRecord($pdo, $st, [$id], 'This department cannot be deleted because employees still depend on it.');
            respond(true, "{$department['name']} was removed.");

        default:
            respond(false, 'Unknown action.', null, [], 400);
    }
} catch (PDOException $ex) {
    error_log('Company Directory DB error: ' . $ex->getMessage());
    respond(false, 'The database could not be reached or the request failed. Please try again.', null, [], 500);
} catch (Throwable $ex) {
    error_log('Company Directory error: ' . $ex->getMessage());
    respond(false, 'Something went wrong on the server. Please try again.', null, [], 500);
}
