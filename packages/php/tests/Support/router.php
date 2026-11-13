<?php

declare(strict_types=1);

/** Router for `php -S`: records each request, with its arrival time on the monotonic clock, in requests.jsonl and answers with the next
    reply in script.json, or 200 {} once it runs out. Both files live in the folder named by SOLVERR_TEST_DIR. */

$dir = getenv('SOLVERR_TEST_DIR');
$headers = array_change_key_case(getallheaders(), CASE_LOWER);
$record = [
    'method' => $_SERVER['REQUEST_METHOD'],
    'path' => $_SERVER['REQUEST_URI'],
    'headers' => $headers,
    'body' => file_get_contents('php://input'),
    'received_at' => hrtime(true) / 1e9,
];
file_put_contents("{$dir}/requests.jsonl", json_encode($record) . "\n", FILE_APPEND | LOCK_EX);

$script = json_decode((string) file_get_contents("{$dir}/script.json"), true) ?: [];
$reply = array_shift($script) ?? ['status' => 200, 'headers' => [], 'body' => '{}'];
file_put_contents("{$dir}/script.json", json_encode($script), LOCK_EX);

http_response_code($reply['status']);
header('Content-Type: application/json');
foreach ($reply['headers'] as $name => $value) {
    header("{$name}: {$value}");
}
echo $reply['body'];
