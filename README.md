# Libreta de servicio de vehículos

Web para llevar el historial de services de cada vehículo. La patente es el identificador. Un llavero NFC grabado con el enlace `/v/PATENTE` muestra la libreta al escanearlo.

## Puesta en marcha

Requiere Node.js 22.5 o superior (usa el SQLite integrado de Node).

```bash
npm install
ADMIN_USER=admin ADMIN_PASS=una-clave-segura npm start
```

- Administración: http://localhost:3000/admin (pide usuario y clave)
- Página pública del llavero: http://localhost:3000/v/AB123CD

Si no definís `ADMIN_PASS`, se genera una clave temporal que aparece en la consola al iniciar.

Variables opcionales: `PORT` (3000), `DB_PATH` (`data/vehiculos.db`).

## Grabar el llavero NFC

1. Entrá a la administración y abrí el vehículo.
2. Copiá el enlace de la sección "Enlace para grabar el llavero NFC".
3. Grabalo en un tag NFC NTAG213 o NTAG215 con una app como NFC Tools (Android o iPhone), en la opción "Escribir URL".
4. Para que el llavero funcione desde el celular de cualquiera, la web tiene que estar publicada con HTTPS en una dirección accesible desde internet. En una PC de prueba, el celular solo puede acceder si está en la misma red y usás la IP de la PC en lugar de `localhost`.

## Funciones

- Alta de vehículos con patente, marca, modelo, año, color, kilometraje y foto.
- Historial de services con fecha, hora, kilometraje, taller, costo y descripción.
- Alertas de mantenimiento por kilometraje y por tiempo. Son "vencido" o "próximo" según el último service registrado.
- Vista pública para el llavero, sin costos ni datos internos.

## Estructura

- `src/db.js`: base de datos SQLite y catálogo inicial de services con intervalos.
- `src/alerts.js`: cálculo de próximos services.
- `src/server.js`: API REST y rutas.
- `public/`: interfaz (HTML, CSS y JS sin frameworks).
- `uploads/`: fotos de los vehículos (se crea sola).
