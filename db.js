const mongoose = require('mongoose');

const mongoUri = String(
  process.env.MONGO_URI ||
  process.env.MONGODB_URI ||
  process.env.MONGO_URL ||
  process.env.MONGODB_URL ||
  process.env.DATABASE_URL ||
  ''
).trim();

if (!/^mongodb(\+srv)?:\/\//i.test(mongoUri)) {
  throw new Error(
    'No hay una URI de MongoDB válida. Configura MONGO_URI o un alias equivalente.'
  );
}

mongoose.connect(mongoUri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 15000
})
  .then(() => console.log('Conectado a MongoDB'))
  .catch(err => {
    console.error('Error de conexión a MongoDB:', err.message);
    process.exit(1);
  });

module.exports = mongoose;
