const mongoose = require('mongoose');

mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('✅ Conectado a MongoDB'))
.catch(err => {
  console.error('❌ Error de conexión a MongoDB:', err.message);
  process.exit(1); // Finaliza el proceso si no se conecta
});

module.exports = mongoose;
