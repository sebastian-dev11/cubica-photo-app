const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');


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


const UsuarioUnico = require('../models/UsuarioUnico');

const CEDULA = String(process.env.USUARIO_DOCUMENTO || process.argv[2] || '').trim();
const NOMBRE = String(process.env.USUARIO_NOMBRE || process.argv[3] || '')
  .replace(/\s+/g, ' ')
  .trim();


const mongoUri =
  process.env.MONGODB_URI ||
  process.env.MONGO_URI ||
  process.env.MONGODB_URL ||
  process.env.MONGO_URL ||
  process.env.DATABASE_URL;


const SHARED_PASSWORD = process.env.SHARED_PASSWORD || process.env.SHARED_USER_PASSWORD;

(async () => {
  if (!mongoUri) {
    console.error('Falta MONGODB_URI (o equivalente) en el .env.');
    process.exit(1);
  }

  if (!CEDULA || !NOMBRE) {
    console.error('Debes indicar documento y nombre del usuario.');
    console.error('Uso: USUARIO_DOCUMENTO=... USUARIO_NOMBRE=... node scripts/insertUsuario.js');
    process.exit(1);
  }

  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 15000 });
  console.log('Conectado a MongoDB.');

  const cedula = String(CEDULA).trim();
  const nombre = String(NOMBRE).replace(/\s+/g, ' ').trim();

  const existente = await UsuarioUnico.findOne({ usuario: cedula });

  if (!existente) {
    if (!SHARED_PASSWORD) {
      console.error('Falta SHARED_PASSWORD en el .env para crear el usuario.');
      process.exit(1);
    }
    const hash = await bcrypt.hash(SHARED_PASSWORD, 10);

    const nuevo = await UsuarioUnico.create({
      usuario: cedula,
      contraseña: hash,
      nombre,
    });

    console.log('Usuario creado:', {
      _id: nuevo._id.toString(),
    });
  } else {
    const update = { nombre };

    if (process.env.FORCE_PASSWORD_RESET === '1') {
      if (!SHARED_PASSWORD) {
        console.error('Falta SHARED_PASSWORD en el .env para resetear contraseña.');
        process.exit(1);
      }
      update.contraseña = await bcrypt.hash(SHARED_PASSWORD, 10);
    }

    await UsuarioUnico.updateOne({ _id: existente._id }, { $set: update });

    console.log('Usuario existente actualizado:', {
      _id: existente._id.toString(),
      passwordActualizada: process.env.FORCE_PASSWORD_RESET === '1' ? 'sí' : 'no',
    });
  }

  await mongoose.disconnect();
  console.log('✔ Listo');
})().catch(async (err) => {
  console.error('ERROR:', err);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
