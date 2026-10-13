<?php
declare(strict_types=1);

/*
 * Database settings. Edit these for your local XAMPP/MAMP/WAMP server
 * and again for your online host (or set the environment variables).
 */
const DB_HOST = 'localhost';
const DB_NAME = 'company_directory';
const DB_USER = 'root';
const DB_PASS = 'sunshine';
const DB_PORT = 3306;

function db(): PDO
{
    static $pdo = null;
    if ($pdo === null) {
        $localConfigPath = __DIR__ . '/config.local.php';
        $localConfig = is_file($localConfigPath) ? require $localConfigPath : [];
        $host = $localConfig['host'] ?? (getenv('CD_DB_HOST') ?: DB_HOST);
        $name = $localConfig['name'] ?? (getenv('CD_DB_NAME') ?: DB_NAME);
        $user = $localConfig['user'] ?? (getenv('CD_DB_USER') ?: DB_USER);
        $pass = $localConfig['pass'] ?? (getenv('CD_DB_PASS') !== false ? getenv('CD_DB_PASS') : DB_PASS);
        $port = $localConfig['port'] ?? (getenv('CD_DB_PORT') ?: DB_PORT);

        $pdo = new PDO(
            "mysql:host={$host};port={$port};dbname={$name};charset=utf8mb4",
            $user,
            $pass,
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
            ]
        );
    }
    return $pdo;
}
