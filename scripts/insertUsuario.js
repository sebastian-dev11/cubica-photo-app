/**
 * scripts/insertUsuario_79965598.js
 *
 * Inserta (o actualiza) el usuario:
 *  - usuario (cédula): 79965598
 *  - nombre: JOHN HORACIO VERGARA GUTIERREZ
 * Contraseña: se toma de .env (SHARED_PASSWORD) y se guarda con bcrypt.
 *
 * Uso:
 *   node scripts/insertUsuario_79965598.js
 *   # Si existe y quieres forzar cambiar su contraseña a la compartida:
 *   FORCE_PASSWORD_RESET=1 node scripts/insertUsuario_79965598.js
 */

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Cargar .env (intenta varias ubicaciones típicas)
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

// Ajusta la ruta si tu estructura difiere
const UsuarioUnico = require('../models/UsuarioUnico');

const CEDULA = '1031179686';
const NOMBRE = 'JUAN SEBASTIAN PASTRANA ALMANZA';

// URL de Mongo desde .env
const mongoUri =
  process.env.MONGODB_URI ||
  process.env.MONGO_URI ||
  process.env.MONGODB_URL ||
  process.env.MONGO_URL ||
  process.env.DATABASE_URL;

// Contraseña compartida (PLAIN) desde .env (obligatoria para crear o para reset forzado)
const SHARED_PASSWORD = process.env.SHARED_PASSWORD || process.env.SHARED_USER_PASSWORD;

(async () => {
  if (!mongoUri) {
    console.error('❌ Falta MONGODB_URI (o equivalente) en el .env.');
    process.exit(1);
  }

  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 15000 });
  console.log('✅ Conectado a MongoDB.');

  const cedula = String(CEDULA).trim();
  const nombre = String(NOMBRE).replace(/\s+/g, ' ').trim();

  const existente = await UsuarioUnico.findOne({ usuario: cedula });

  if (!existente) {
    if (!SHARED_PASSWORD) {
      console.error('❌ Falta SHARED_PASSWORD en el .env para crear el usuario.');
      process.exit(1);
    }
    const hash = await bcrypt.hash(SHARED_PASSWORD, 10);

    const nuevo = await UsuarioUnico.create({
      usuario: cedula,
      contraseña: hash,
      nombre,
    });

    console.log('🆕 Usuario creado:', {
      _id: nuevo._id.toString(),
      usuario: nuevo.usuario,
      nombre: nuevo.nombre,
    });
  } else {
    const update = { nombre };

    if (process.env.FORCE_PASSWORD_RESET === '1') {
      if (!SHARED_PASSWORD) {
        console.error('❌ Falta SHARED_PASSWORD en el .env para resetear contraseña.');
        process.exit(1);
      }
      update.contraseña = await bcrypt.hash(SHARED_PASSWORD, 10);
    }

    await UsuarioUnico.updateOne({ _id: existente._id }, { $set: update });

    console.log('♻️ Usuario existente actualizado:', {
      _id: existente._id.toString(),
      usuario: existente.usuario,
      nombre,
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
