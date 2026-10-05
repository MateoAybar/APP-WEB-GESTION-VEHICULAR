const DIA_MS = 86400000;

const ymd = (fecha) => new Date(fecha.getTime() - fecha.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

const diasEntre = (desde, hasta) => Math.round((Date.parse(hasta) - Date.parse(desde)) / DIA_MS);

function sumarMeses(fecha, meses) {
  const [y, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + meses, d)).toISOString().slice(0, 10);
}

const PESO_ESTADO = { vencido: 0, proximo: 1, ok: 2 };

// Calcula, para cada tipo de service, cuándo corresponde el próximo.
// Si nunca se hizo, la base es el km y la fecha de alta del vehículo.
// "Próximo" = faltan 10% del intervalo (mínimo 1.000 km) o 30 días o menos.
export function calcularAlertas(vehiculo, servicios, tipos, hoy = new Date()) {
  const hoyISO = ymd(hoy);

  return tipos
    .map((t) => {
      const ultimo =
        servicios
          .filter((s) => s.tipo_id === t.id)
          .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.km - a.km)[0] ?? null;

      const baseKm = ultimo ? ultimo.km : vehiculo.km_inicial;
      const baseFecha = ultimo ? ultimo.fecha : vehiculo.fecha_alta;

      const proximoKm = t.intervalo_km ? baseKm + t.intervalo_km : null;
      const proximoFecha = t.intervalo_meses ? sumarMeses(baseFecha, t.intervalo_meses) : null;

      const kmRestantes = proximoKm === null ? null : proximoKm - vehiculo.km_actual;
      const diasRestantes = proximoFecha === null ? null : diasEntre(hoyISO, proximoFecha);

      const margenKm = t.intervalo_km ? Math.max(1000, t.intervalo_km * 0.1) : 0;

      const vencido =
        (kmRestantes !== null && kmRestantes <= 0) || (diasRestantes !== null && diasRestantes < 0);
      const proximo =
        (kmRestantes !== null && kmRestantes <= margenKm) || (diasRestantes !== null && diasRestantes <= 30);

      return {
        tipo_id: t.id,
        nombre: t.nombre,
        categoria: t.categoria,
        ultimo: ultimo ? { fecha: ultimo.fecha, hora: ultimo.hora, km: ultimo.km } : null,
        proximo_km: proximoKm,
        proximo_fecha: proximoFecha,
        km_restantes: kmRestantes,
        dias_restantes: diasRestantes,
        estado: vencido ? 'vencido' : proximo ? 'proximo' : 'ok',
      };
    })
    .sort((a, b) => PESO_ESTADO[a.estado] - PESO_ESTADO[b.estado] || a.nombre.localeCompare(b.nombre, 'es'));
}
