const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

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
  process.env.MONGO_URI ||
  process.env.MONGODB_URI ||
  process.env.MONGO_URL ||
  process.env.MONGODB_URL ||
  process.env.DATABASE_URL;

const adminUser = process.env.ADMIN_USER || 'admin';
const nuevaPassword = process.argv[2] || process.env.ADMIN_PASSWORD;

async function main() {
  if (!mongoUri) {
    console.error('Falta MONGO_URI en el .env.');
    process.exit(1);
  }

  if (!nuevaPassword) {
    console.error('Debes enviar la nueva contraseña.');
    console.error('Ejemplo: node scripts/resetAdminPassword.js 123456');
    process.exit(1);
  }

  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 15000
  });

  const admin = await UsuarioUnico.findOne({ usuario: adminUser });

  if (!admin) {
    console.error(`No se encontró el usuario: ${adminUser}`);
    await mongoose.disconnect();
    process.exit(1);
  }

  const hash = await bcrypt.hash(String(nuevaPassword), 10);

  admin.contraseña = hash;
  admin.rol = 'admin';
  admin.activo = true;

  await admin.save();

  console.log('Contraseña del admin actualizada correctamente.');
  console.log({
    id: admin._id.toString(),
    usuario: admin.usuario,
    rol: admin.rol,
    activo: admin.activo
  });

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('Error actualizando contraseña:', err.message || err);

  try {
    await mongoose.disconnect();
  } catch {}

  process.exit(1);
});