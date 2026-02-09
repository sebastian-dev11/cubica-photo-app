/**
 * scripts/addTienda.js
 *
 * Inserta (o actualiza) una tienda:
 *  - nombre: D1 El Tejar
 *  - departamento: Cundinamarca
 *  - ciudad: Chía
 *
 * Uso:
 *   node scripts/addTienda.js
 *   # Si existe y quieres forzar actualización de datos:
 *   FORCE_UPDATE=1 node scripts/addTienda.js
 */

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

// Cargar .env desde ubicaciones comunes
const envCandidates = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(__dirname, '..', '.env'),
  path.resolve(__dirname, '..', '..', '.env'),
];
for (const p of envCandidates) {
  if (fs.existsSync(p)) {
    require('dotenv').config({ path: p });
    break;
  }
}

// Modelo Tienda (usa tu ../db internamente si aplica, o conexión directa aquí)
const Tienda = require('../models/tienda');

// Datos de ejemplo (puedes editarlos o reemplazarlos por flags si quieres)
const NOMBRE = 'LA CORUÑA';
const DEPARTAMENTO = 'BOGOTA';
const CIUDAD = 'BOGOTA';

// URL de Mongo desde .env (acepta varios nombres)
const mongoUri =
  process.env.MONGODB_URI ||
  process.env.MONGO_URI ||
  process.env.MONGODB_URL ||
  process.env.MONGO_URL ||
  process.env.DATABASE_URL;

(async () => {
  // Validar URI
  if (!mongoUri) {
    console.error('Falta MONGODB_URI (o equivalente) en el .env.');
    process.exit(1);
  }

  // Conectar a Mongo
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 15000 });
  console.log('Conectado a MongoDB.');

  // Normalizar strings
  const nombre = String(NOMBRE).replace(/\s+/g, ' ').trim();
  const departamento = String(DEPARTAMENTO).replace(/\s+/g, ' ').trim();
  const ciudad = String(CIUDAD).replace(/\s+/g, ' ').trim();

  // Buscar por combinación nombre+ciudad
  const existente = await Tienda.findOne({ nombre, ciudad });

  if (!existente) {
    // Crear nueva tienda
    const nueva = await Tienda.create({ nombre, departamento, ciudad });
    console.log('Tienda creada:', {
      _id: nueva._id.toString(),
      nombre: nueva.nombre,
      departamento: nueva.departamento,
      ciudad: nueva.ciudad,
    });
  } else {
    // Actualizar si se fuerza (por defecto no pisa datos)
    if (process.env.FORCE_UPDATE === '1') {
      const update = { nombre, departamento, ciudad };
      await Tienda.updateOne({ _id: existente._id }, { $set: update });

      console.log('Tienda existente actualizada:', {
        _id: existente._id.toString(),
        nombre,
        departamento,
        ciudad,
        actualizada: 'sí',
      });
    } else {
      console.log('La tienda ya existe. No se actualizó. Usa FORCE_UPDATE=1 para forzar.');
      console.log({
        _id: existente._id.toString(),
        nombre: existente.nombre,
        departamento: existente.departamento,
        ciudad: existente.ciudad,
      });
    }
  }

  await mongoose.disconnect();
  console.log('Listo');
})().catch(async (err) => {
  console.error('ERROR:', err);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
