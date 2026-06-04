const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');


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


const Tienda = require('../models/tienda');


const NOMBRE = 'ALCAZARES';
const REGIONAL = 'BAQ'; 
const CIUDAD = 'SANTA MARTA';


const mongoUri =
  process.env.MONGODB_URI ||
  process.env.MONGO_URI ||
  process.env.MONGODB_URL ||
  process.env.MONGO_URL ||
  process.env.DATABASE_URL;

(async () => {
  
  if (!mongoUri) {
    console.error('Falta MONGODB_URI (o equivalente) en el .env.');
    process.exit(1);
  }

  // Conectar a Mongo
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 15000 });
  console.log('Conectado a MongoDB.');

  // Normalizar strings
  const nombre = String(NOMBRE).replace(/\s+/g, ' ').trim();
  const regional = String(REGIONAL).replace(/\s+/g, ' ').trim(); 
  const departamento = String(DEPARTAMENTO).replace(/\s+/g, ' ').trim();
  const ciudad = String(CIUDAD).replace(/\s+/g, ' ').trim();

  
  const existente = await Tienda.findOne({ nombre, ciudad });

  if (!existente) {
    const nueva = await Tienda.create({ nombre, regional, departamento, ciudad });
    console.log('Tienda creada:', {
      _id: nueva._id.toString(),
      nombre: nueva.nombre,
      regional: nueva.regional,
      departamento: nueva.departamento,
      ciudad: nueva.ciudad,
    });
  } else {
    if (process.env.FORCE_UPDATE === '1') {
      const update = { nombre, regional, departamento, ciudad }; 
      await Tienda.updateOne({ _id: existente._id }, { $set: update });

      console.log('Tienda existente actualizada:', {
        _id: existente._id.toString(),
        nombre,
        regional,
        departamento,
        ciudad,
        actualizada: 'sí',
      });
    } else {
      console.log('La tienda ya existe. No se actualizó. Usa FORCE_UPDATE=1 para forzar.');
      console.log({
        _id: existente._id.toString(),
        nombre: existente.nombre,
        regional: existente.regional,
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