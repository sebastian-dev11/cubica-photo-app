const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const envCandidates = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(__dirname, '..', '.env'),
  path.resolve(__dirname, '..', '..', '.env')
];

for (const envPath of envCandidates) {
  if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
    break;
  }
}

const UsuarioUnico = require('../models/UsuarioUnico');

const mongoUri =
  process.env.MONGODB_URI ||
  process.env.MONGO_URI ||
  process.env.MONGODB_URL ||
  process.env.MONGO_URL ||
  process.env.DATABASE_URL;

const adminUser = process.env.ADMIN_USER || 'admin';

async function main() {
  if (!mongoUri) {
    console.error('Falta MONGO_URI o una variable equivalente en el .env.');
    process.exit(1);
  }

  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 15000
  });

  const admin = await UsuarioUnico.findOne({ usuario: adminUser });

  if (!admin) {
    console.error(`No se encontró el usuario administrador: ${adminUser}`);
    await mongoose.disconnect();
    process.exit(1);
  }

  admin.rol = 'admin';
  admin.activo = true;

  await admin.save();

  console.log('Usuario admin actualizado correctamente.');
  console.log({
    id: admin._id.toString(),
    usuario: admin.usuario,
    nombre: admin.nombre || '',
    rol: admin.rol,
    activo: admin.activo
  });

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('Error actualizando usuario admin:', err.message || err);

  try {
    await mongoose.disconnect();
  } catch {}

  process.exit(1);
});