<?php

declare(strict_types=1);

namespace Solverr\Tests\Support;

/** A `php -S` server on 127.0.0.1 that answers from a script of replies and records every request it receives. */
final class LocalServer
{
    /** @var resource */
    private $process;

    private function __construct(public readonly string $baseUrl, private readonly string $dir, $process)
    {
        $this->process = $process;
    }

    public static function start(): self
    {
        $dir = sys_get_temp_dir() . '/solverr-php-test-' . bin2hex(random_bytes(6));
        mkdir($dir);
        $port = self::freePort();
        $command = [PHP_BINARY, '-S', "127.0.0.1:{$port}", __DIR__ . '/router.php'];
        $env = ['SOLVERR_TEST_DIR' => $dir] + getenv();
        $process = proc_open($command, [0 => ['pipe', 'r'], 1 => ['file', "{$dir}/server.log", 'a'], 2 => ['file', "{$dir}/server.log", 'a']], $pipes, $dir, $env);
        if (!is_resource($process)) {
            throw new \RuntimeException('Could not start php -S.');
        }
        $server = new self("http://127.0.0.1:{$port}", $dir, $process);
        $server->reset();
        $deadline = microtime(true) + 5;
        while (@fsockopen('127.0.0.1', $port, $errno, $error, 0.2) === false) {
            if (microtime(true) > $deadline) {
                $server->stop();
                throw new \RuntimeException('php -S did not start listening.');
            }
            usleep(50_000);
        }
        return $server;
    }

    /** A port that was free a moment ago, from binding port 0. */
    public static function freePort(): int
    {
        $socket = stream_socket_server('tcp://127.0.0.1:0');
        $name = stream_socket_get_name($socket, false);
        fclose($socket);
        return (int) substr($name, strrpos($name, ':') + 1);
    }

    /** Clears the recorded requests and sets the replies; each is [status, body, headers]. */
    public function reset(array ...$replies): void
    {
        $script = array_map(static fn (array $reply): array => [
            'status' => $reply[0],
            'body' => is_string($reply[1] ?? null) ? $reply[1] : json_encode($reply[1] ?? new \stdClass()),
            'headers' => $reply[2] ?? [],
        ], $replies);
        file_put_contents("{$this->dir}/script.json", json_encode($script));
        file_put_contents("{$this->dir}/requests.jsonl", '');
    }

    /** @return list<array{method: string, path: string, headers: array<string, string>, body: string, received_at: float}> */
    public function requests(): array
    {
        $lines = array_filter(explode("\n", (string) file_get_contents("{$this->dir}/requests.jsonl")));
        return array_values(array_map(static fn (string $line): array => json_decode($line, true), $lines));
    }

    public function stop(): void
    {
        proc_terminate($this->process);
        proc_close($this->process);
        foreach (glob("{$this->dir}/*") ?: [] as $file) {
            unlink($file);
        }
        rmdir($this->dir);
    }
}
