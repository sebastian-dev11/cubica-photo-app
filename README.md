Cubica PhotApp – Backend
Cubica PhotApp es una aplicación backend diseñada para gestionar sesiones fotográficas técnicas, subir imágenes clasificadas como "previas" y "posteriores", generar informes PDF con evidencia visual, y asociar cada sesión a una tienda física. Está construida con Node.js, Express y MongoDB, e integra servicios como Cloudinary para almacenamiento de archivos y PDFKit para generación de documentos.

Características principales
- Autenticación con usuario único y contraseña cifrada.
- Subida de imágenes con validación, normalización y almacenamiento en Cloudinary.
- Asociación de sesiones a tiendas físicas (nombre, ciudad, departamento).
- Generación de informes técnicos en PDF con imágenes emparejadas y observaciones.
- Fusión opcional de actas técnicas en PDF con el informe principal.
- Escaneo de actas estilo CamScanner: detección de esquinas, corrección de perspectiva, filtros de color y PDF multipágina.
- Limpieza automática de archivos temporales y recursos en Cloudinary.

 Estructura del proyecto
├── app.js                  # Configuración principal del servidor
├── db.js                   # Conexión a MongoDB
├── models/                 # Esquemas de Mongoose
│   ├── actaDocumento.js
│   ├── imagen.js
│   ├── informe.js
│   ├── informeVersion.js
│   ├── sesion.js
│   ├── tienda.js
│   └── UsuarioUnico.js
├── routes/                 # Rutas HTTP
│   ├── auth.js
│   ├── imagenes.js
│   ├── pdf.js
│   ├── acta.js
│   └── tiendas.js
├── utils/                  # Utilidades compartidas
│   ├── actaScanner.js
│   └── cloudinary.js
├── docs/                   # Documentación adicional
│   └── ESCANER_ACTAS.md
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
  "usuario": "<usuario>",
  "contraseña": "<contraseña>"
}


Response (éxito)
{
  "mensaje": "Acceso concedido",
  "nombre": "admin"
}


Seguridad
- Utiliza bcryptjs para comparar contraseñas cifradas.
- Genera un JWT HS256 y una sesión persistente en MongoDB.
- Responde con un mensaje genérico para credenciales incorrectas.
- Aplica límite de intentos por IP/usuario (configurable con `LOGIN_MAX_ATTEMPTS` y `LOGIN_WINDOW_MS`).

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
Sube una o varias fotos de acta, las escanea (detección del documento, corrección de perspectiva y filtros) y opcionalmente un PDF de acta. La referencia completa está en [docs/ESCANER_ACTAS.md](docs/ESCANER_ACTAS.md).
Campos (form-data)
| Campo | Tipo | Requerido | Descripción | 
| acta | File | ❌ | PDF de acta existente. |
| imagenes | File[] | ❌* | Hasta 20 fotos del acta. |
| sesionId | String | ✅ | ID de la sesión. |
| scanMode | String | ❌ | `original`, `soft`, `clean` (default) o `bn`. |
| crop | String | ❌ | `auto` (default) o `none`. |
| quad / quads | JSON | ❌ | Esquinas manuales de una o varias páginas. |


\* Se requiere al menos `acta` o `imagenes`.


Proceso
- Detección de bordes y corrección de perspectiva con `sharp`.
- Filtros de mejora de color o blanco y negro.
- Subida de las páginas procesadas a Cloudinary.
- Persistencia en MongoDB (`actasdocumentos`) con copia en memoria.
- Eliminación tras la fusión en el PDF final del informe.

También disponibles:
- `POST /acta/detectar`: devuelve las 4 esquinas del documento.
- `POST /acta/procesar`: vista previa con el filtro aplicado.
- `POST /acta/:sesionId/pagina`: agrega una página escaneada.
- `GET /acta/:sesionId`: consulta las páginas del acta.
- `GET /acta/:sesionId/pdf`: genera el PDF multipágina del acta.
- `PATCH /acta/:sesionId/orden`: reordena las páginas.
- `DELETE /acta/:sesionId/item`: elimina una página.
- `DELETE /acta/:sesionId`: elimina el acta completa.

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
- Las rutas de imágenes, PDF, actas, informes, tiendas y usuarios requieren autenticación.
- Existe un manejador global de errores que no expone stack traces al cliente.

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
| sharp | Procesamiento de imágenes, detección de documento y filtros de escaneo. |
| pdf-merger-js | Fusión de múltiples PDFs. |
| bcryptjs | Cifrado y comparación de contraseñas. |
| jsonwebtoken | Gestión de tokens JWT HS256. |
| csv-parser | Lectura de archivos CSV en scripts de carga. |



Recomendaciones
- Usar bcryptjs de forma exclusiva; se eliminaron dependencias no utilizadas.
- Validar que las claves de Cloudinary y MongoDB estén protegidas en producción.
- No publicar reportes de limpieza: pueden contener public IDs y nombres de informes.

Variables de seguridad recomendadas
| Variable | Descripción |
| FRONTEND_URL | Origen del frontend permitido por CORS. |
| CORS_ORIGINS | Lista separada por comas de orígenes permitidos por CORS. |
| PUBLIC_BASE_URL | Base pública absoluta del backend para construir enlaces de vista previa. |
| JWT_SECRET | Secreto HS256 para firmar tokens; debe ser aleatorio y rotarse periódicamente. |
| PDF_PREVIEW_SECRET | Secreto para firmar enlaces de vista previa de PDF. |
| PDF_PREVIEW_TTL_MS | Vigencia de los enlaces de vista previa (por defecto 24 h, máximo 7 días). |
| LOGIN_MAX_ATTEMPTS | Intentos de login permitidos por ventana (por defecto 20). |
| LOGIN_WINDOW_MS | Ventana de bloqueo de login en milisegundos (por defecto 15 min). |
| TRUST_PROXY | Número de proxies confiables para obtener la IP real del cliente. |

Notas de seguridad
- Si `FRONTEND_URL`/`CORS_ORIGINS` no están configurados, CORS queda permisivo y se emite una advertencia en arranque. Si contienen un origen inválido, el arranque falla en lugar de desactivar el control. Configúralos en producción.
- Si `TRUST_PROXY` no está configurado, se emite una advertencia: el throttle de login usará la IP del socket y HSTS no se derivará de `X-Forwarded-Proto`.
- Un usuario inactivo recibe el mismo mensaje genérico `Credenciales incorrectas` (401) para no revelar el estado de la cuenta.
- Los enlaces de vista previa generados antes de la reincorporación de `exp` dejan de funcionar; deben generarse nuevamente.
- El throttle de login y el estado de sesiones viven en memoria/MongoDB de una sola instancia; en despliegues multi-instancia usa un store compartido.
- Los enlaces de vista previa están firmados pero el PDF se sirve desde una URL pública de Cloudinary. Para exigir autenticación real en el archivo, configura el recurso como privado/firmado y sirve el PDF a través del backend.



