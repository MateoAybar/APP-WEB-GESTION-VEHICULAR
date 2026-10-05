const app = document.getElementById('app');

const ESTADO = { vencido: 'Vencido', proximo: 'Próximo', ok: 'Al día' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const enc = encodeURIComponent;
const fmtNum = (n) => Number(n).toLocaleString('es-AR');
const fmtKm = (n) => (n == null ? '—' : `${fmtNum(n)} km`);
const fmtFecha = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');
const fmtMoneda = (n) => `$ ${fmtNum(n)}`;
const hoyISO = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const horaActual = () => new Date().toTimeString().slice(0, 5);

async function api(url, { method = 'GET', body } = {}) {
  const init = { method, headers: {} };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `No se pudo completar la acción (${res.status})`);
  return data;
}

function bindForm(id, handler) {
  const form = document.getElementById(id);
  const error = form.querySelector('.error');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    try {
      await handler(Object.fromEntries(new FormData(form)), form);
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
  });
}

// ---------- Navegación ----------
function go(url) {
  history.pushState(null, '', url);
  route();
}

function route() {
  const path = location.pathname;
  if (path.startsWith('/v/')) return vistaPublica(decodeURIComponent(path.slice(3)));
  if (path === '/admin' || path === '/admin/') return vistaLista();
  if (path === '/admin/nuevo') return vistaNuevo();

  const m = path.match(/^\/admin\/vehiculo\/([^/]+)$/);
  if (m) return vistaVehiculo(decodeURIComponent(m[1]));

  document.title = 'Libreta de servicio';
  app.innerHTML = `
    <main class="public">
      <h1>Libreta de servicio</h1>
      <p class="empty" style="margin-top:12px">Escaneá el llavero del vehículo para ver su historial.</p>
      <p style="margin-top:20px"><a href="/admin" data-link>Ir a la administración</a></p>
    </main>`;
}

document.addEventListener('click', async (e) => {
  const link = e.target.closest('a[data-link]');
  if (link) {
    e.preventDefault();
    return go(link.getAttribute('href'));
  }

  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const { action, id } = btn.dataset;

  try {
    if (action === 'copiar') {
      await navigator.clipboard.writeText(btn.dataset.url);
      btn.textContent = 'Copiado';
    }
    if (action === 'borrar-servicio' && confirm('¿Eliminar este service del historial?')) {
      await api(`/api/servicios/${id}`, { method: 'DELETE' });
      route();
    }
    if (action === 'borrar-vehiculo' && confirm(`¿Eliminar el vehículo ${id} y todo su historial? No se puede deshacer.`)) {
      await api(`/api/vehicles/${enc(id)}`, { method: 'DELETE' });
      go('/admin');
    }
  } catch (err) {
    alert(err.message);
  }
});

window.addEventListener('popstate', route);

// ---------- Componentes ----------
function renderAlertas(alertas) {
  if (!alertas.length) return '<p class="empty">No hay tipos de service configurados.</p>';

  return `<ul class="alerts">${alertas
    .map((a) => {
      const ultimo = a.ultimo
        ? `Último: ${fmtFecha(a.ultimo.fecha)} · ${fmtKm(a.ultimo.km)}`
        : 'Sin registro todavía';
      return `
      <li class="alert ${a.estado}">
        <span class="dot" aria-hidden="true"></span>
        <div>
          <strong>${esc(a.nombre)}</strong>
          <small>${esc(ultimo)}</small>
        </div>
        <div class="alert-due">
          <span>${ESTADO[a.estado]}</span>
          <small>${esc(textoVencimiento(a))}</small>
        </div>
      </li>`;
    })
    .join('')}</ul>`;
}

function textoVencimiento(a) {
  const partes = [];
  if (a.proximo_km != null) {
    partes.push(
      a.km_restantes <= 0
        ? `Pasó hace ${fmtNum(-a.km_restantes)} km`
        : `Faltan ${fmtNum(a.km_restantes)} km`,
    );
  }
  if (a.proximo_fecha) {
    partes.push(
      a.dias_restantes < 0 ? `Venció el ${fmtFecha(a.proximo_fecha)}` : `Vence el ${fmtFecha(a.proximo_fecha)}`,
    );
  }
  return partes.join(' · ');
}

function renderHistorial(servicios, admin = false) {
  if (!servicios.length) return '<p class="empty">Todavía no hay services registrados.</p>';

  return `<ol class="log">${servicios
    .map(
      (s) => `
      <li>
        <time datetime="${esc(s.fecha)}">${fmtFecha(s.fecha)}${s.hora ? `<span>${esc(s.hora.slice(0, 5))} hs</span>` : ''}</time>
        <strong>${esc(s.tipo_nombre)}</strong>
        <p>${esc(s.taller || 'Taller sin especificar')} · ${fmtKm(s.km)}${admin && s.costo != null ? ` · ${fmtMoneda(s.costo)}` : ''}</p>
        ${s.descripcion ? `<p class="note">${esc(s.descripcion)}</p>` : ''}
        ${admin ? `<button type="button" class="ghost small" data-action="borrar-servicio" data-id="${s.id}">Eliminar</button>` : ''}
      </li>`,
    )
    .join('')}</ol>`;
}

function formVehiculo(v = {}, esNuevo = true) {
  return `
    <form id="form-vehiculo" class="form">
      <div class="row">
        <label>Patente
          <input name="patente" value="${esc(v.patente ?? '')}" ${esNuevo ? 'required' : 'readonly'} autocomplete="off" placeholder="AB123CD">
        </label>
        <label>Año
          <input name="anio" type="number" min="1900" max="2100" value="${esc(v.anio ?? '')}">
        </label>
      </div>
      <div class="row">
        <label>Marca
          <input name="marca" required value="${esc(v.marca ?? '')}" placeholder="Toyota">
        </label>
        <label>Modelo
          <input name="modelo" required value="${esc(v.modelo ?? '')}" placeholder="Corolla XEi">
        </label>
      </div>
      <div class="row">
        <label>Color
          <input name="color" value="${esc(v.color ?? '')}" placeholder="Gris plata">
        </label>
        <label>${esNuevo ? 'Kilometraje inicial' : 'Kilometraje actual'}
          <input name="km" type="number" min="0" required value="${esNuevo ? (v.km_inicial ?? 0) : (v.km_actual ?? 0)}">
        </label>
      </div>
      <div class="actions">
        <button type="submit">${esNuevo ? 'Crear vehículo' : 'Guardar cambios'}</button>
      </div>
      <p class="error" role="alert" hidden></p>
    </form>`;
}

function shellAdmin(contenido) {
  return `
    <header class="topbar">
      <a href="/admin" data-link class="brand">Libreta de servicio</a>
      <a href="/admin/nuevo" data-link>+ Vehículo</a>
    </header>
    <main class="admin">${contenido}</main>`;
}

// ---------- Vistas públicas ----------
async function vistaPublica(patente) {
  try {
    const v = await api(`/api/public/vehicles/${enc(patente)}`);
    document.title = `${v.patente} · Libreta de servicio`;

    app.innerHTML = `
      <main class="public">
        <header class="plate-hero">
          <div class="plate" role="img" aria-label="Patente ${esc(v.patente)}">${esc(v.patente)}</div>
          <p class="car-name">${esc(v.marca)} ${esc(v.modelo)}${v.anio ? ` <small>${v.anio}</small>` : ''}</p>
          <p class="car-meta">${esc(v.color ?? '')}</p>
        </header>

        ${v.foto ? `<img class="photo" src="/uploads/${esc(v.foto)}" alt="Foto de ${esc(v.marca)} ${esc(v.modelo)}">` : ''}

        <h2>Mantenimiento</h2>
        <p class="km-now">${fmtKm(v.km_actual)}</p>
        ${renderAlertas(v.alertas)}

        <h2>Historial de services</h2>
        ${renderHistorial(v.servicios)}
      </main>`;
  } catch {
    document.title = 'Vehículo no encontrado';
    app.innerHTML = `
      <main class="public">
        <h1>No encontramos la patente ${esc(patente)}</h1>
        <p class="empty" style="margin-top:12px">Este vehículo no está registrado en la libreta.</p>
      </main>`;
  }
}

// ---------- Vistas de administración ----------
async function vistaLista() {
  document.title = 'Vehículos · Libreta de servicio';
  const vehiculos = await api('/api/vehicles');

  app.innerHTML = shellAdmin(`
    <div class="toolbar">
      <h1>Vehículos</h1>
      <a class="button" href="/admin/nuevo" data-link>Nuevo vehículo</a>
    </div>
    ${
      vehiculos.length
        ? `<ul class="vehicle-list">${vehiculos
            .map(
              (v) => `
          <li>
            <a href="/admin/vehiculo/${enc(v.patente)}" data-link>
              <span class="plate small">${esc(v.patente)}</span>
              <span class="vehicle-info">
                <strong>${esc(v.marca)} ${esc(v.modelo)}</strong>
                <small>${v.anio ?? ''} · ${fmtKm(v.km_actual)}</small>
              </span>
              <span class="counts">
                ${v.vencidos ? `<span class="badge vencido">${v.vencidos} vencido${v.vencidos > 1 ? 's' : ''}</span>` : ''}
                ${v.proximos ? `<span class="badge proximo">${v.proximos} próximo${v.proximos > 1 ? 's' : ''}</span>` : ''}
              </span>
            </a>
          </li>`,
            )
            .join('')}</ul>`
        : '<p class="empty" style="margin-top:20px">Todavía no cargaste vehículos. Empezá con el primero.</p>'
    }`);
}

function vistaNuevo() {
  document.title = 'Nuevo vehículo · Libreta de servicio';
  app.innerHTML = shellAdmin(`
    <h1>Nuevo vehículo</h1>
    <p class="empty" style="margin-top:8px">La patente es el identificador. Es la que va a leer el llavero.</p>
    ${formVehiculo()}`);

  bindForm('form-vehiculo', async (datos) => {
    const v = await api('/api/vehicles', { method: 'POST', body: datos });
    go(`/admin/vehiculo/${enc(v.patente)}`);
  });
}

async function vistaVehiculo(patente) {
  const [v, tipos] = await Promise.all([api(`/api/vehicles/${enc(patente)}`), api('/api/service-types')]);
  document.title = `${v.patente} · Libreta de servicio`;
  const url = `${location.origin}/v/${v.patente}`;

  app.innerHTML = shellAdmin(`
    <section class="detail-head">
      <div class="plate">${esc(v.patente)}</div>
      <div>
        <h1>${esc(v.marca)} ${esc(v.modelo)}</h1>
        <p class="meta">${esc(v.anio ?? '')} · ${esc(v.color ?? 'Sin color')} · ${fmtKm(v.km_actual)}</p>
      </div>
    </section>

    <section class="nfc">
      <p>Enlace para grabar el llavero NFC:</p>
      <p class="url">${esc(url)}</p>
      <div><button type="button" class="ghost" data-action="copiar" data-url="${esc(url)}">Copiar enlace</button></div>
    </section>

    ${v.foto ? `<img class="photo" src="/uploads/${esc(v.foto)}" alt="Foto de ${esc(v.marca)} ${esc(v.modelo)}">` : ''}
    <form id="form-foto" class="inline">
      <label style="flex:1">${v.foto ? 'Cambiar foto' : 'Subir foto'}
        <input type="file" name="foto" accept="image/*" required>
      </label>
      <button type="submit" class="ghost">Guardar foto</button>
      <p class="error" role="alert" hidden style="width:100%"></p>
    </form>

    <h2>Mantenimiento</h2>
    ${renderAlertas(v.alertas)}

    <h2>Registrar service</h2>
    <form id="form-servicio" class="form">
      <label>Tipo de service
        <select name="tipo_id" required>
          ${tipos.map((t) => `<option value="${t.id}">${esc(t.nombre)}</option>`).join('')}
        </select>
      </label>
      <div class="row">
        <label>Fecha
          <input type="date" name="fecha" required value="${hoyISO()}">
        </label>
        <label>Hora
          <input type="time" name="hora" value="${horaActual()}">
        </label>
      </div>
      <div class="row">
        <label>Kilometraje
          <input type="number" name="km" min="0" required value="${v.km_actual}">
        </label>
        <label>Costo ($)
          <input type="number" name="costo" min="0" step="0.01" placeholder="Opcional">
        </label>
      </div>
      <label>Taller
        <input name="taller" maxlength="80" placeholder="Nombre del taller">
      </label>
      <label>Descripción
        <textarea name="descripcion" rows="2" maxlength="500" placeholder="Qué se hizo, repuestos usados…"></textarea>
      </label>
      <div class="actions"><button type="submit">Guardar service</button></div>
      <p class="error" role="alert" hidden></p>
    </form>

    <h2>Historial</h2>
    ${renderHistorial(v.servicios, true)}

    <h2>Datos del vehículo</h2>
    ${formVehiculo(v, false)}
    <div class="actions" style="margin-top:20px">
      <button type="button" class="danger" data-action="borrar-vehiculo" data-id="${esc(v.patente)}">Eliminar vehículo</button>
    </div>`);

  bindForm('form-foto', async (_, form) => {
    await api(`/api/vehicles/${enc(patente)}/foto`, { method: 'POST', body: new FormData(form) });
    await vistaVehiculo(patente);
  });

  bindForm('form-servicio', async (d) => {
    await api(`/api/vehicles/${enc(patente)}/servicios`, {
      method: 'POST',
      body: { tipo_id: d.tipo_id, fecha: d.fecha, hora: d.hora, km: d.km, costo: d.costo, taller: d.taller, descripcion: d.descripcion },
    });
    await vistaVehiculo(patente);
  });

  bindForm('form-vehiculo', async (d) => {
    await api(`/api/vehicles/${enc(patente)}`, { method: 'PUT', body: d });
    await vistaVehiculo(patente);
  });
}

route();
