import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(root, 'data'), { recursive: true });

export const db = new DatabaseSync(process.env.DB_PATH || join(root, 'data', 'vehiculos.db'));

db.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS vehiculos (
    patente     TEXT PRIMARY KEY,
    marca       TEXT NOT NULL,
    modelo      TEXT NOT NULL,
    anio        INTEGER,
    color       TEXT,
    km_inicial  INTEGER NOT NULL DEFAULT 0,
    km_actual   INTEGER NOT NULL DEFAULT 0,
    foto        TEXT,
    fecha_alta  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tipos_servicio (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre           TEXT NOT NULL UNIQUE,
    categoria        TEXT NOT NULL,
    intervalo_km     INTEGER,
    intervalo_meses  INTEGER,
    activo           INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS servicios (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    patente      TEXT NOT NULL REFERENCES vehiculos(patente) ON DELETE CASCADE,
    tipo_id      INTEGER NOT NULL REFERENCES tipos_servicio(id),
    fecha        TEXT NOT NULL,
    hora         TEXT,
    km           INTEGER NOT NULL,
    taller       TEXT,
    descripcion  TEXT,
    costo        REAL,
    creado       TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_servicios_patente ON servicios(patente);
`);

// Catálogo inicial: [nombre, categoría, intervalo en km, intervalo en meses]
const TIPOS_INICIALES = [
  ['Cambio de aceite de motor', 'Mecánica', 10000, 6],
  ['Filtro de aceite', 'Mecánica', 10000, 6],
  ['Filtro de aire', 'Mecánica', 20000, 12],
  ['Filtro de combustible', 'Mecánica', 30000, 24],
  ['Filtro de habitáculo (polen)', 'Confort', 15000, 12],
  ['Correa de distribución', 'Mecánica', 60000, 60],
  ['Líquido refrigerante', 'Mecánica', 40000, 36],
  ['Líquido de frenos', 'Frenos', 40000, 24],
  ['Pastillas de freno', 'Frenos', 30000, 24],
  ['Rotación de neumáticos', 'Neumáticos', 10000, 6],
  ['Alineación y balanceo', 'Neumáticos', 10000, 12],
  ['Car detail (lavado y tratamiento)', 'Tratamientos', null, 3],
];

if (db.prepare('SELECT COUNT(*) AS n FROM tipos_servicio').get().n === 0) {
  const insertar = db.prepare(
    'INSERT INTO tipos_servicio (nombre, categoria, intervalo_km, intervalo_meses) VALUES (?, ?, ?, ?)',
  );
  for (const fila of TIPOS_INICIALES) insertar.run(...fila);
}
