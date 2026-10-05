import express from 'express';
import multer from 'multer';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, unlink } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { calcularAlertas } from './alerts.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'public');
const uploadsDir = join(root, 'uploads');
mkdirSync(uploadsDir, { recursive: true });

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || randomBytes(9).toString('base64url');
if (!process.env.ADMIN_PASS) {
  console.warn(`[aviso] ADMIN_PASS no definido. Clave temporal para esta sesión: ${ADMIN_PASS}`);
}

const PATENTE_RE = /^[A-Z]{2,3}\d{3}[A-Z]{0,2}$/; // AB123CD (nuevo) o ABC123 (anterior)
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const HORA_RE = /^\d{2}:\d{2}$/;

const normPatente = (p) => String(p ?? '').toUpperCase().replace(/[\s.-]/g, '');
const enteroPositivo = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
};
const texto = (v, max = 200) => (v == null || String(v).trim() === '' ? null : String(v).trim().slice(0, max));

function safeEqual(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function requireAuth(req, res, next) {
  const [scheme, token = ''] = (req.headers.authorization || '').split(' ');
  if (scheme === 'Basic') {
    const [user, ...resto] = Buffer.from(token, 'base64').toString('utf8').split(':');
    if (safeEqual(user ?? '', ADMIN_USER) && safeEqual(resto.join(':'), ADMIN_PASS)) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Libreta de servicio"').status(401).send('Autenticación requerida');
}

const noExiste = (res) => res.status(404).json({ error: 'Vehículo no encontrado' });

function validarPatente(req, res, next) {
  const p = normPatente(req.params.patente);
  if (!PATENTE_RE.test(p)) return res.status(400).json({ error: 'La patente no tiene un formato válido' });
  req.patente = p;
  next();
}

function verificarExiste(req, res, next) {
  return db.prepare('SELECT 1 FROM vehiculos WHERE patente = ?').get(req.patente) ? next() : noExiste(res);
}

const borrarArchivo = (nombre) => unlink(join(uploadsDir, nombre), () => {});

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (req, file, cb) => cb(null, `${req.patente}-${Date.now()}${extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

// Vehículo completo: datos, servicios e alertas calculadas con el kilometraje actual
function leerVehiculo(patente) {
  const v = db.prepare('SELECT * FROM vehiculos WHERE patente = ?').get(patente);
  if (!v) return null;

  const servicios = db
    .prepare(
      `SELECT s.*, t.nombre AS tipo_nombre, t.categoria
         FROM servicios s
         JOIN tipos_servicio t ON t.id = s.tipo_id
        WHERE s.patente = ?
        ORDER BY s.fecha DESC, COALESCE(s.hora, '00:00') DESC, s.id DESC`,
    )
    .all(patente);

  const tipos = db.prepare('SELECT * FROM tipos_servicio WHERE activo = 1 ORDER BY categoria, nombre').all();
  const vehiculo = { ...v, km_actual: Math.max(v.km_actual, ...servicios.map((s) => s.km)) };

  return { ...vehiculo, servicios, alertas: calcularAlertas(vehiculo, servicios, tipos) };
}

// Lo que ve quien escanea el llavero: sin costos ni datos internos
function vistaPublica(v) {
  return {
    patente: v.patente,
    marca: v.marca,
    modelo: v.modelo,
    anio: v.anio,
    color: v.color,
    foto: v.foto,
    km_actual: v.km_actual,
    alertas: v.alertas,
    servicios: v.servicios.map(({ costo, ...s }) => s),
  };
}

const app = express();
app.use(express.json());

// ---------- API pública (la que usa el llavero NFC) ----------
app.get('/api/public/vehicles/:patente', (req, res) => {
  const p = normPatente(req.params.patente);
  const v = PATENTE_RE.test(p) ? leerVehiculo(p) : null;
  if (!v) return res.status(404).json({ error: 'Patente no registrada' });
  res.json(vistaPublica(v));
});

// ---------- API de administración (todo lo demás requiere usuario y clave) ----------
app.use('/api', (req, res, next) => (req.path.startsWith('/public/') ? next() : requireAuth(req, res, next)));

app.get('/api/service-types', (req, res) => {
  res.json(db.prepare('SELECT * FROM tipos_servicio WHERE activo = 1 ORDER BY categoria, nombre').all());
});

app.get('/api/vehicles', (req, res) => {
  const lista = db
    .prepare('SELECT patente FROM vehiculos ORDER BY marca, modelo')
    .all()
    .map(({ patente }) => leerVehiculo(patente))
    .map((v) => ({
      patente: v.patente,
      marca: v.marca,
      modelo: v.modelo,
      anio: v.anio,
      km_actual: v.km_actual,
      vencidos: v.alertas.filter((a) => a.estado === 'vencido').length,
      proximos: v.alertas.filter((a) => a.estado === 'proximo').length,
    }));
  res.json(lista);
});

app.post('/api/vehicles', (req, res) => {
  const b = req.body;
  const patente = normPatente(b.patente);
  const km = enteroPositivo(b.km);
  const marca = texto(b.marca, 60);
  const modelo = texto(b.modelo, 60);

  if (!PATENTE_RE.test(patente)) {
    return res.status(400).json({ error: 'La patente no tiene un formato válido (ej: AB123CD o ABC123)' });
  }
  if (!marca || !modelo) return res.status(400).json({ error: 'Marca y modelo son obligatorios' });
  if (km === null) return res.status(400).json({ error: 'El kilometraje debe ser un número entero positivo' });
  if (db.prepare('SELECT 1 FROM vehiculos WHERE patente = ?').get(patente)) {
    return res.status(409).json({ error: `Ya existe un vehículo con la patente ${patente}` });
  }

  db.prepare(
    `INSERT INTO vehiculos (patente, marca, modelo, anio, color, km_inicial, km_actual, fecha_alta)
     VALUES (?, ?, ?, ?, ?, ?, ?, date('now', 'localtime'))`,
  ).run(patente, marca, modelo, enteroPositivo(b.anio), texto(b.color, 30), km, km);

  res.status(201).json(leerVehiculo(patente));
});

app.get('/api/vehicles/:patente', validarPatente, verificarExiste, (req, res) => {
  res.json(leerVehiculo(req.patente));
});

app.put('/api/vehicles/:patente', validarPatente, verificarExiste, (req, res) => {
  const b = req.body;
  const marca = texto(b.marca, 60);
  const modelo = texto(b.modelo, 60);
  const km = b.km === undefined ? undefined : enteroPositivo(b.km);

  if (!marca || !modelo) return res.status(400).json({ error: 'Marca y modelo son obligatorios' });
  if (km === null) return res.status(400).json({ error: 'El kilometraje debe ser un número entero positivo' });

  db.prepare(
    `UPDATE vehiculos
        SET marca = ?, modelo = ?, anio = ?, color = ?, km_actual = COALESCE(?, km_actual)
      WHERE patente = ?`,
  ).run(marca, modelo, enteroPositivo(b.anio), texto(b.color, 30), km ?? null, req.patente);

  res.json(leerVehiculo(req.patente));
});

app.delete('/api/vehicles/:patente', validarPatente, verificarExiste, (req, res) => {
  const { foto } = db.prepare('SELECT foto FROM vehiculos WHERE patente = ?').get(req.patente);
  db.prepare('DELETE FROM vehiculos WHERE patente = ?').run(req.patente);
  if (foto) borrarArchivo(foto);
  res.status(204).end();
});

app.post('/api/vehicles/:patente/foto', validarPatente, verificarExiste, upload.single('foto'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Subí una imagen JPG, PNG o WEBP de hasta 5 MB' });

  const anterior = db.prepare('SELECT foto FROM vehiculos WHERE patente = ?').get(req.patente).foto;
  db.prepare('UPDATE vehiculos SET foto = ? WHERE patente = ?').run(req.file.filename, req.patente);
  if (anterior) borrarArchivo(anterior);

  res.json(leerVehiculo(req.patente));
});

app.post('/api/vehicles/:patente/servicios', validarPatente, verificarExiste, (req, res) => {
  const b = req.body;
  const tipoId = enteroPositivo(b.tipo_id);
  const km = enteroPositivo(b.km);
  const fecha = String(b.fecha ?? '');
  const hora = b.hora ? String(b.hora) : null;
  const costo = b.costo === '' || b.costo == null ? null : Number(b.costo);

  if (tipoId === null || !db.prepare('SELECT 1 FROM tipos_servicio WHERE id = ?').get(tipoId)) {
    return res.status(400).json({ error: 'Elegí un tipo de service' });
  }
  if (!FECHA_RE.test(fecha)) return res.status(400).json({ error: 'La fecha no es válida' });
  if (hora && !HORA_RE.test(hora)) return res.status(400).json({ error: 'La hora no es válida' });
  if (km === null) return res.status(400).json({ error: 'El kilometraje debe ser un número entero positivo' });
  if (costo !== null && (!Number.isFinite(costo) || costo < 0)) {
    return res.status(400).json({ error: 'El costo no es válido' });
  }

  db.prepare(
    `INSERT INTO servicios (patente, tipo_id, fecha, hora, km, taller, descripcion, costo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(req.patente, tipoId, fecha, hora, km, texto(b.taller, 80), texto(b.descripcion, 500), costo);

  db.prepare('UPDATE vehiculos SET km_actual = MAX(km_actual, ?) WHERE patente = ?').run(km, req.patente);

  res.status(201).json(leerVehiculo(req.patente));
});

app.delete('/api/servicios/:id', (req, res) => {
  const id = enteroPositivo(req.params.id);
  const r = db.prepare('DELETE FROM servicios WHERE id = ?').run(id);
  if (!r.changes) return res.status(404).json({ error: 'Service no encontrado' });
  res.status(204).end();
});

// ---------- Páginas ----------
app.use(express.static(publicDir));
app.use('/uploads', express.static(uploadsDir));

const pagina = join(publicDir, 'index.html');
app.get('/v/:patente', (req, res) => res.sendFile(pagina));
app.get(/^\/admin(\/.*)?$/, requireAuth, (req, res) => res.sendFile(pagina));

// Manejo de errores (por ejemplo, imagen demasiado grande)
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'La imagen supera los 5 MB' });
  console.error(err);
  res.status(500).json({ error: 'Error del servidor' });
});

app.listen(PORT, () => {
  console.log(`Libreta de servicio en http://localhost:${PORT}`);
  console.log(`Administración: http://localhost:${PORT}/admin  (usuario: ${ADMIN_USER})`);
});
