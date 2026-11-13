/** Packs plugins/woocommerce/solverr-woocommerce into public/downloads/solverr-woocommerce.zip, the file WordPress installs.
    Entries are sorted and dated 1980-01-01, so the same plugin files always give the same zip. */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN = "solverr-woocommerce";
const SOURCE = path.join(ROOT, "plugins", "woocommerce", PLUGIN);
const OUTPUT = path.join(ROOT, "public", "downloads", `${PLUGIN}.zip`);

/** Zip header values: version 2.0, UTF-8 names, DOS date 1980-01-01 with time 0, deflate or store, and the MS-DOS folder attribute. */
const ZIP_VERSION = 20;
const UTF8_NAMES = 0x0800;
const DOS_DATE = (1 << 5) | 1;
const DEFLATE = 8;
const STORE = 0;
const FOLDER_ATTRIBUTE = 0x10;

/** Paths below `dir`, prefixed with `prefix`, in a fixed order; folders end in "/" and come before their contents. */
function entryNames(dir, prefix) {
  return readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .flatMap((item) => {
      const name = `${prefix}${item.name}`;
      return item.isDirectory() ? [`${name}/`, ...entryNames(path.join(dir, item.name), `${name}/`)] : [name];
    });
}

/** A little-endian record from [byte length, value] pairs, the layout of every zip header. */
function record(fields) {
  const buffer = Buffer.alloc(fields.reduce((sum, [size]) => sum + size, 0));
  let at = 0;
  for (const [size, value] of fields) {
    if (size === 2) buffer.writeUInt16LE(value, at);
    else buffer.writeUInt32LE(value, at);
    at += size;
  }
  return buffer;
}

const localParts = [];
const directory = [];
let offset = 0;
for (const name of [`${PLUGIN}/`, ...entryNames(SOURCE, `${PLUGIN}/`)]) {
  const folder = name.endsWith("/");
  const content = folder ? Buffer.alloc(0) : readFileSync(path.join(SOURCE, name.slice(PLUGIN.length + 1)));
  const packed = folder ? content : deflateRawSync(content, { level: 9 });
  const nameBytes = Buffer.from(name, "utf8");
  const shared = [
    [2, ZIP_VERSION],
    [2, UTF8_NAMES],
    [2, folder ? STORE : DEFLATE],
    [2, 0],
    [2, DOS_DATE],
    [4, folder ? 0 : crc32(content)],
    [4, packed.length],
    [4, content.length],
    [2, nameBytes.length],
    [2, 0],
  ];
  const local = Buffer.concat([record([[4, 0x04034b50], ...shared]), nameBytes, packed]);
  directory.push(Buffer.concat([record([[4, 0x02014b50], [2, ZIP_VERSION], ...shared, [2, 0], [2, 0], [2, 0], [4, folder ? FOLDER_ATTRIBUTE : 0], [4, offset]]), nameBytes]));
  localParts.push(local);
  offset += local.length;
}

const directoryBytes = Buffer.concat(directory);
const end = record([
  [4, 0x06054b50],
  [2, 0],
  [2, 0],
  [2, directory.length],
  [2, directory.length],
  [4, directoryBytes.length],
  [4, offset],
  [2, 0],
]);
mkdirSync(path.dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, Buffer.concat([...localParts, directoryBytes, end]));
