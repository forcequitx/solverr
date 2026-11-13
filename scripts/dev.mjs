/** Runs the dev server (`web`), the standalone server (`start`) or the `worker`, stopping an earlier copy first (two dev servers sharing `.next`
    crash each other); for `web` builds a missing public/embed.js and the plugin zip, starts a stopped local database, frees PORT
    (default 3002), and Ctrl+C or closing the terminal stops the whole tree. */
import { execFileSync, execSync, spawn } from "node:child_process";
import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { connect, createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(ROOT, "package.json"));
const WINDOWS = process.platform === "win32";
const PORT = Number(process.env.PORT) || 3002;
/** How long to wait for a stopped process to release the port. */
const PORT_RELEASE_MS = 10_000;
const PORT_POLL_MS = 250;
/** How often the launcher checks that the terminal or npm process that started it still runs. */
const PARENT_CHECK_MS = 1000;
/** The local database container, the same one `npm run db:up` starts. */
const COMPOSE_FILE = path.join("deploy", "docker-compose.dev.yml");
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const DOCKER_DESKTOP = path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Docker", "Docker", "Docker Desktop.exe");
/** How long to wait for Docker Desktop to start, and for the database container to report healthy. */
const DOCKER_START_MS = 120_000;
const DATABASE_WAIT_SECONDS = 120;
const DATABASE_PROBE_MS = 2_000;

/** Output of `next build` with `output: "standalone"`. */
const STANDALONE = path.join(ROOT, ".next", "standalone");
/** Build output of packages/embed, which Git ignores; the demo store's pay buttons load it. */
const EMBED_SCRIPT = path.join(ROOT, "public", "embed.js");
/** Writes public/downloads/solverr-woocommerce.zip, also ignored by Git; `npm run build:plugin` runs it too. */
const PLUGIN_ZIP_SCRIPT = path.join(ROOT, "scripts", "build-woocommerce-zip.mjs");

const TARGETS = {
  web: {
    label: "dev server",
    usesPort: true,
    command: () => [require.resolve("next/dist/bin/next"), "dev", "--port", String(PORT)],
    matches: (cmd) => /next[\\/]dist[\\/]bin[\\/]next["']?\s+dev\b/.test(cmd) || /dev\.mjs["']?\s+web\b/.test(cmd),
  },
  start: {
    label: "production server",
    usesPort: true,
    /** The project's .env is loaded first, so it wins over the copy `next build` placed in the standalone folder. */
    command: () => ["--env-file=.env", path.join(STANDALONE, "server.js")],
    matches: (cmd) => /standalone[\\/]server\.js/.test(cmd) || /dev\.mjs["']?\s+start\b/.test(cmd),
  },
  worker: {
    label: "worker",
    command: () => [require.resolve("tsx/cli"), "--env-file=.env", "worker/index.ts"],
    matches: (cmd) => /worker[\\/]index\.ts/.test(cmd) || /dev\.mjs["']?\s+worker\b/.test(cmd),
  },
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Node processes on this machine, as pid and command line. */
function nodeProcesses() {
  if (WINDOWS) {
    const json = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", "Get-CimInstance Win32_Process -Filter \"Name = 'node.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"],
      { encoding: "utf8", windowsHide: true },
    ).trim();
    if (!json) return [];
    return [].concat(JSON.parse(json)).map((entry) => ({ pid: entry.ProcessId, cmd: entry.CommandLine ?? "" }));
  }
  return execFileSync("ps", ["-eo", "pid=,args="], { encoding: "utf8" })
    .split("\n")
    .map((line) => /^\s*(\d+)\s+(.*)$/.exec(line))
    .filter(Boolean)
    .map(([, pid, cmd]) => ({ pid: Number(pid), cmd }));
}

/** Process ids listening on the port. */
function portOwners(port) {
  try {
    if (WINDOWS) {
      const lines = execFileSync("netstat", ["-ano", "-p", "TCP"], { encoding: "utf8", windowsHide: true }).split(/\r?\n/);
      const tcp6 = execFileSync("netstat", ["-ano", "-p", "TCPv6"], { encoding: "utf8", windowsHide: true }).split(/\r?\n/);
      const owners = [...lines, ...tcp6]
        .map((line) => line.trim().split(/\s+/))
        .filter((cols) => cols[3] === "LISTENING" && cols[1]?.endsWith(`:${port}`))
        .map((cols) => Number(cols[4]));
      return [...new Set(owners)].filter((pid) => pid > 0);
    }
    return execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8" })
      .split("\n")
      .map(Number)
      .filter((pid) => pid > 0);
  } catch {
    return [];
  }
}

/** Stops a process and everything it started. */
function killTree(pid) {
  try {
    if (WINDOWS) execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    else process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /** Already gone. */
    }
  }
}

/** Stops earlier copies of the target started from this project, so only one runs. */
function stopEarlierCopies(target) {
  const root = ROOT.toLowerCase().replace(/\\/g, "/");
  const own = new Set([process.pid, process.ppid]);
  for (const { pid, cmd } of nodeProcesses()) {
    if (own.has(pid) || !cmd.toLowerCase().replace(/\\/g, "/").includes(root) || !target.matches(cmd)) continue;
    console.log(`[dev] Stopping an earlier ${target.label} from this project (pid ${pid}).`);
    killTree(pid);
  }
}

/** Whether nothing listens on the port, for IPv6 and IPv4. */
function portFree(port) {
  const tryHost = (host) =>
    new Promise((resolve) => {
      const server = createServer();
      server.once("error", (error) => resolve(error.code !== "EADDRINUSE" && error.code !== "EACCES"));
      server.listen({ port, host, exclusive: true }, () => server.close(() => resolve(true)));
    });
  return tryHost("::").then((free) => (free ? tryHost("0.0.0.0") : false));
}

/** A setting from the environment, or else from the project's .env file. */
function envValue(name) {
  if (process.env[name]) return process.env[name];
  const envFile = path.join(ROOT, ".env");
  if (!existsSync(envFile)) return undefined;
  const line = readFileSync(envFile, "utf8")
    .split(/\r?\n/)
    .find((entry) => entry.trimStart().startsWith(`${name}=`));
  return line?.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "") || undefined;
}

/** Host and port of DATABASE_URL when the database runs on this machine; null for a remote database. */
function localDatabase() {
  try {
    const url = new URL(envValue("DATABASE_URL") ?? "");
    return LOCAL_HOSTS.has(url.hostname) ? { host: url.hostname.replace(/^\[|\]$/g, ""), port: Number(url.port) || 5432 } : null;
  } catch {
    return null;
  }
}

/** Whether something accepts TCP connections at the address. */
function accepts({ host, port }) {
  return new Promise((resolve) => {
    const socket = connect({ host, port, timeout: DATABASE_PROBE_MS });
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

function dockerRunning() {
  try {
    execFileSync("docker", ["info"], { stdio: "ignore", windowsHide: true, timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

/** When nothing answers at a local DATABASE_URL, starts Docker Desktop if needed and brings up the database container until it is healthy. */
async function ensureDatabase() {
  const database = localDatabase();
  if (!database || (await accepts(database))) return;
  console.log(`[dev] The database at ${database.host}:${database.port} is not running; starting it with Docker.`);
  if (!dockerRunning() && WINDOWS && existsSync(DOCKER_DESKTOP)) {
    console.log("[dev] Starting Docker Desktop…");
    spawn(DOCKER_DESKTOP, [], { detached: true, stdio: "ignore" }).unref();
    for (let waited = 0; waited < DOCKER_START_MS && !dockerRunning(); waited += 2_000) await sleep(2_000);
  }
  if (!dockerRunning()) throw new Error("Docker is not running. Start Docker, then run this command again.");
  execFileSync("docker", ["compose", "-f", COMPOSE_FILE, "up", "-d", "--wait", "--wait-timeout", String(DATABASE_WAIT_SECONDS)], {
    cwd: ROOT,
    stdio: "inherit",
    windowsHide: true,
  });
  if (!(await accepts(database))) throw new Error(`The database container started, but nothing answers at ${database.host}:${database.port}. Check DATABASE_URL.`);
  console.log("[dev] The database is ready.");
}

/** Makes the port free: whatever listens on it is stopped, then the launcher waits until the port is released. */
async function freePort(port) {
  if (await portFree(port)) return;
  for (const pid of portOwners(port)) {
    if (pid === process.pid) continue;
    console.log(`[dev] Port ${port} is in use by pid ${pid}; stopping it.`);
    killTree(pid);
  }
  for (let waited = 0; waited < PORT_RELEASE_MS; waited += PORT_POLL_MS) {
    if (await portFree(port)) return;
    await sleep(PORT_POLL_MS);
  }
  throw new Error(`Port ${port} is still in use. Stop the program using it, or set PORT to another port.`);
}

/** Copies static assets and `public` next to the standalone server, which `next build` leaves out. */
function prepareStandalone() {
  if (!existsSync(path.join(STANDALONE, "server.js"))) throw new Error("No production build found. Run `npm run build` first.");
  const assets = [
    [path.join(ROOT, ".next", "static"), path.join(STANDALONE, ".next", "static")],
    [path.join(ROOT, "public"), path.join(STANDALONE, "public")],
  ];
  for (const [from, to] of assets) {
    rmSync(to, { recursive: true, force: true });
    cpSync(from, to, { recursive: true });
  }
}

/** Builds public/embed.js when it is missing, as on a fresh clone; `npm run build:embed` rebuilds it after packages/embed changes. */
function ensureEmbedScript() {
  if (existsSync(EMBED_SCRIPT)) return;
  console.log("[dev] public/embed.js is missing; building it with `npm run build:embed`.");
  execSync("npm run build:embed", { cwd: ROOT, stdio: "inherit", windowsHide: true });
}

/** Packs the WooCommerce plugin into public/downloads on every start, so the docs' download link serves the current plugin files. */
function buildPluginZip() {
  execFileSync(process.execPath, [PLUGIN_ZIP_SCRIPT], { cwd: ROOT, stdio: "inherit", windowsHide: true });
}

async function main() {
  const name = process.argv[2];
  const target = TARGETS[name];
  if (!target) {
    console.error("Usage: node scripts/dev.mjs web|start|worker");
    process.exit(2);
  }

  if (name === "start") prepareStandalone();
  if (name === "web") {
    ensureEmbedScript();
    buildPluginZip();
  }
  stopEarlierCopies(target);
  await ensureDatabase();
  if (target.usesPort) await freePort(PORT);

  /** Next.js telemetry otherwise leaves a detached flush process running after the server stops; the standalone server reads its port from PORT. */
  const env = { ...process.env, NEXT_TELEMETRY_DISABLED: "1", PORT: String(PORT) };
  const child = spawn(process.execPath, target.command(), { cwd: ROOT, env, stdio: "inherit", detached: !WINDOWS });
  let stopping = false;
  const stop = (code) => {
    if (stopping) return;
    stopping = true;
    if (child.exitCode === null) killTree(child.pid);
    process.exit(code);
  };
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) process.on(signal, () => stop(0));
  /** A terminal killed without Ctrl+C sends no signal, so the launcher also stops when the process that started it is gone. */
  const parent = process.ppid;
  setInterval(() => {
    try {
      process.kill(parent, 0);
    } catch {
      stop(0);
    }
  }, PARENT_CHECK_MS).unref();
  process.on("exit", () => {
    if (child.exitCode === null && !stopping) killTree(child.pid);
  });
  child.on("exit", (code, signal) => stop(code ?? (signal ? 1 : 0)));
}

main().catch((error) => {
  console.error(`[dev] ${error.message}`);
  process.exit(1);
});
