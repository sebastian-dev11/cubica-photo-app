Cubica PhotApp – Backend
Cubica PhotApp es una aplicación backend diseñada para gestionar sesiones fotográficas técnicas, subir imágenes clasificadas como "previas" y "posteriores", generar informes PDF con evidencia visual, y asociar cada sesión a una tienda física. Está construida con Node.js, Express y MongoDB, e integra servicios como Cloudinary para almacenamiento de archivos y PDFKit para generación de documentos.

Características principales
- Autenticación con usuario único y contraseña cifrada.
- Subida de imágenes con validación, normalización y almacenamiento en Cloudinary.
- Asociación de sesiones a tiendas físicas (nombre, ciudad, departamento).
- Generación de informes técnicos en PDF con imágenes emparejadas y observaciones.
- Fusión opcional de actas técnicas en PDF con el informe principal.
- Limpieza automática de archivos temporales y recursos en Cloudinary.

 Estructura del proyecto
├── app.js                  # Configuración principal del servidor
├── db.js                   # Conexión a MongoDB
├── models/                 # Esquemas de Mongoose
│   ├── imagen.js
│   ├── tienda.js
│   └── UsuarioUnico.js
├── routes/                 # Rutas HTTP
│   ├── auth.js
│   ├── imagenes.js
│   ├── pdf.js
│   ├── acta.js
│   └── tiendas.js
├── utils/                  # Utilidades compartidas
│   └── cloudinary.js
├── uploads/                # Carpeta temporal para archivos locales
├── .env                    # Variables de entorno
└── package.json            # Dependencias y scripts

Modelos
Esta aplicación utiliza esquemas de Mongoose para estructurar los datos relacionados con usuarios, tiendas, sesiones e imágenes. Cada modelo está diseñado para facilitar la validación, la organización y el procesamiento eficiente de los datos en MongoDB.

Imagen
Representa los metadatos de cada imagen subida, incluyendo normalización del nombre, agrupación por tipo (previa o posterior), y observaciones.
Estructura:
const imagenSchema = new mongoose.Schema({
  nombreOriginal: String,
  nombreArchivoOriginal: String,
  url: String,
  sesionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session' },
  tipo: String, // previa o posterior
  ubicacion: String,
  observacion: String,
  fechaSubida: { type: Date, default: Date.now }
});


Campos clave:
| Campo | Tipo | Descripción | 
| nombreOriginal | String | Nombre normalizado del archivo (minúsculas, sin espacios). | 
| url | String | URL pública del archivo en Cloudinary. | 
| tipo | String | "previa" o "posterior", usado para agrupar en PDF. | 
| ubicacion | String | Información contextual de la imagen. | 
| observacion | String | Comentario opcional. | 
| fechaSubida | Date | Marca temporal para ordenar en informes. | 



Tienda
Modelo para registrar ubicación física relacionada a una sesión. Se utiliza para contextualizar informes técnicos en PDF.
Estructura:
const tiendaSchema = new mongoose.Schema({
  nombre: { type: String, required: true },
  departamento: { type: String, required: true },
  ciudad: { type: String, required: true }
});


Campos clave:
| Campo | Tipo | Requerido | Descripción | 
| nombre | String |  Nombre de la tienda. | 
| departamento | String | Departamento o región administrativa. | 
| ciudad | String |  Ciudad donde se ubica la tienda. | 



UsuarioUnico
Modelo de autenticación para acceso restringido a un único usuario. Pensado para entornos sin gestión de múltiples cuentas.
Estructura:
const usuarioSchema = new mongoose.Schema({
  usuario: { type: String, required: true },
  contraseña: { type: String, required: true }
});


Campos clave:
| Campo | Tipo | Requerido | Descripción | 
| usuario | String | Identificador del usuario (ej: "admin"). | 
| contraseña | String | Contraseña cifrada. | 


Seguridad
Se recomienda usar bcrypt para guardar contraseñas cifradas. Aunque el modelo permite texto plano, no es seguro para producción.



Rutas
El backend expone múltiples endpoints RESTful para autenticación, subida de imágenes, generación de informes PDF, gestión de tiendas y carga de actas técnicas. Todas las rutas están organizadas en archivos separados dentro de la carpeta routes/.

POST /auth/login
Autentica al usuario único registrado en el sistema.
Request
{
  "usuario": "admin",
  "contraseña": "123456"
}


Response (éxito)
{
  "mensaje": "Acceso concedido",
  "nombre": "admin"
}


Seguridad
- Utiliza bcrypt para comparar contraseñas cifradas.
- No genera JWT ni sesión persistente.

POST /imagenes/subir
Sube una imagen clasificada como previa o posterior, asociada a una sesión y ubicación.
Campos (form-data)
| Campo | Tipo | Requerido | Descripción | 
| imagen | File | Archivo .jpg, .jpeg, .png. | 
| sesionId | String | ID de la sesión. | 
| tipo | String | "previa" o "posterior". | 
| ubicacion | String | Ubicación descriptiva. | 
| observacion | String | ❌ | Comentario opcional. | 


Proceso
- Validación de campos.
- Subida a Cloudinary.
- Normalización del nombre.
- Registro en MongoDB.
- Eliminación del archivo temporal.

GET /pdf/generar/:sesionId
Genera un informe técnico en PDF con imágenes emparejadas y observaciones. Puede incluir un acta técnica si fue cargada previamente.
Parámetros
| Parámetro | Tipo | Requerido | Descripción | 
| sesionId | String | ✅ID de la sesión. | 
| tiendaId | String | ❌ | ID de la tienda para mostrar ubicación detallada. | 
| ubicacion | String | ❌ | Texto alternativo si no se proporciona tiendaId. | 


Proceso
- Descarga de imágenes desde Cloudinary.
- Emparejamiento previa / posterior.
- Renderizado con PDFKit.
- Fusión con acta técnica (si existe).
- Limpieza de imágenes y registros.

POST /acta/subir
Sube un archivo PDF de acta técnica asociado a una sesión. Se guarda temporalmente en memoria y en Cloudinary como recurso raw.
Campos (form-data)
| Campo | Tipo | Requerido | Descripción | 
| acta | File | ✅ | Archivo PDF. | 
| sesionId | String | ✅ | ID de la sesión. | 


Proceso
- Subida directa desde buffer con streamifier.
- Almacenamiento temporal en actasEnMemoria.
- Eliminación tras fusión en PDF final.

GET /tiendas
Devuelve todas las tiendas registradas en la base de datos.
Response
[
  {
    "_id": "64f1c9e8...",
    "nombre": "Tienda 123",
    "departamento": "Cundinamarca",
    "ciudad": "Bogotá"
  }
]


Uso
- Para vincular sesiones con ubicación geográfica.
- Para mostrar encabezado en informes PDF.
  
Utilidades
El proyecto incluye módulos auxiliares para configurar servicios externos y establecer la conexión con la base de datos. Estas utilidades permiten centralizar la lógica de infraestructura y mantener el código modular.

utils/cloudinary.js
Configura la conexión con Cloudinary para subir y eliminar archivos (imágenes y PDFs).
Configuración
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});


Variables requeridas
| Variable | Descripción | 
| CLOUDINARY_CLOUD_NAME | Nombre de la cuenta en Cloudinary. | 
| CLOUDINARY_API_KEY | Clave pública para autenticación. | 
| CLOUDINARY_API_SECRET | Clave privada para operaciones seguras. | 


Uso en el proyecto
- Subida de imágenes (imagenes.js)
- Subida y eliminación de actas (acta.js, pdf.js)
- Eliminación de recursos tras generación de PDF

db.js
Establece la conexión con MongoDB usando Mongoose. Detiene el servidor si la conexión falla.
Configuración
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('Conectado a MongoDB'))
.catch(err => {
  console.error('Error de conexión a MongoDB:', err.message);
  process.exit(1);
});


Variable requerida
| Variable | Descripción | 
| MONGO_URI | URI de conexión a la base de datos MongoDB. | 


Consideraciones
- Se recomienda restringir la URI por IP en producción.
- El uso de process.exit(1) evita que el servidor corra sin base de datos activa.


Archivo principal: app.js
Este archivo configura y lanza el servidor Express, integrando rutas, middlewares, conexión a MongoDB y variables de entorno. Es el punto de entrada de la aplicación.

Configuración general
require('dotenv').config();
const express = require('express');
const mongoose = require('./db');
const cors = require('cors');


- Carga de variables desde .env.
- Conexión a MongoDB mediante db.js.
- Activación de CORS para permitir solicitudes externas.

Middlewares globales
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


- cors() habilita solicitudes cross-origin.
- express.json() permite recibir cuerpos JSON.
- express.urlencoded() permite recibir formularios codificados.

Rutas integradas
app.use('/auth', authRoutes);
app.use('/login', authRoutes);
app.use('/crear', authRoutes);
app.use('/imagenes', imagenRoutes);
app.use('/pdf', pdfRoutes);
app.use('/acta', actaRoutes);
app.use('/tiendas', tiendasRoutes);


| Ruta base | Archivo de origen | Propósito | 
| /auth | routes/auth.js | Autenticación de usuario único. | 
| /login | routes/auth.js | Alias para autenticación. | 
| /crear | routes/auth.js | (Reservado para futuras extensiones). | 
| /imagenes | routes/imagenes.js | Subida y registro de imágenes. | 
| /pdf | routes/pdf.js | Generación de informes técnicos en PDF. | 
| /acta | routes/acta.js | Subida temporal de actas técnicas en PDF. | 
| /tiendas | routes/tiendas.js | Consulta de tiendas registradas. | 



Puerto de ejecución
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});


- El puerto puede configurarse desde .env.
- Por defecto se usa 3000.

Consideraciones técnicas
- Las rutas /login y /crear apuntan al mismo controlador que /auth; pueden consolidarse o especializarse según el flujo deseado.
- No se incluye manejo de errores globales ni protección de rutas; se recomienda agregar middlewares para autenticación, logging y validación.

Instalación y dependencias
Este proyecto utiliza Node.js y npm para gestionar sus dependencias. A continuación se detallan los pasos para instalarlo y las librerías clave que lo componen.

Instalación
- Clona el repositorio:
git clone https://github.com/tu-usuario/cubica-photo-app.git
cd cubica-photo-app


- Instala las dependencias:
npm install


- Crea un archivo .env con las siguientes variables:
PORT=3000
MONGO_URI=tu_uri_de_mongodb
CLOUDINARY_CLOUD_NAME=tu_nombre_cloudinary
CLOUDINARY_API_KEY=tu_api_key
CLOUDINARY_API_SECRET=tu_api_secret


- Inicia el servidor:
npm start



Dependencias clave
| Paquete | Propósito | 
| express | Framework principal para el servidor HTTP. | 
| mongoose | ODM para MongoDB. | 
| dotenv | Carga de variables de entorno desde .env. | 
| cors | Permite solicitudes cross-origin. | 
| multer | Manejo de archivos en formularios (memoria y disco). | 
| cloudinary | Subida y eliminación de imágenes/PDFs en la nube. | 
| streamifier | Convierte buffers en streams para subir PDFs. | 
| axios | Cliente HTTP para descargar imágenes y actas. | 
| pdfkit | Generación de PDFs personalizados. | 
| pdf-merger-js | Fusión de múltiples PDFs. | 
| bcryptjs / bcrypt | Cifrado y comparación de contraseñas. | 
| jsonwebtoken | (Instalado pero no usado) Gestión de tokens JWT. | 
| image-size | (Instalado pero no usado) Obtención de dimensiones de imágenes. | 
| mysql2 | (Instalado pero no usado) Cliente para bases de datos MySQL. | 
| pdf-lib | (Instalado pero no usado) Manipulación avanzada de PDFs. | 



Recomendaciones
- Consolidar el uso de bcrypt o bcryptjs para evitar redundancia.
- Eliminar dependencias no utilizadas para reducir el tamaño del proyecto.
- Validar que las claves de Cloudinary y MongoDB estén protegidas en producción.



