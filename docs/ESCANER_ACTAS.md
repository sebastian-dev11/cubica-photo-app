# Escáner de actas

**Comportamiento actual:** las páginas del acta se guardan **tal cual se cargan**, sin recorte, sin corrección de perspectiva, sin filtros y sin recodificación. Esto evita que las imágenes queden cortadas o incompletas. El escaneo avanzado sigue disponible solo como herramienta opcional y explícita en `POST /acta/procesar`; no se aplica a lo que se almacena ni a lo que se fusiona en el informe.

Todo vive bajo `/acta` y requiere el token JWT habitual (`Authorization: Bearer <token>`). El `sesionId` debe pertenecer al usuario autenticado, salvo que sea administrador.

## Flujo recomendado desde el frontend

1. El usuario toma o selecciona una foto del acta.
2. `POST /acta/subir` guarda las fotos originales (o `POST /acta/:sesionId/pagina` agrega una página por request).
3. `GET /acta/:sesionId/pdf` genera el PDF del acta con las imágenes completas.

Opcionalmente, `POST /acta/detectar` y `POST /acta/procesar` permiten inspeccionar el documento o probar un filtro, pero su resultado **no se guarda** automáticamente.

## Endpoints

| Método | Ruta | Descripción |
| --- | --- | --- |
| `POST` | `/acta/detectar` | Detecta el documento y devuelve sus 4 esquinas. |
| `POST` | `/acta/procesar` | Devuelve la imagen completa por defecto; procesa solo si se piden opciones explícitamente. |
| `POST` | `/acta/subir` | Sube una o varias páginas originales, y opcionalmente un PDF de acta. |
| `POST` | `/acta/:sesionId/pagina` | Agrega una sola página original a un acta existente. |
| `GET` | `/acta/:sesionId` | Consulta las páginas y el PDF del acta. |
| `GET` | `/acta/:sesionId/pdf` | Genera y devuelve el PDF con todas las páginas escaneadas. |
| `PATCH` | `/acta/:sesionId/orden` | Cambia el orden de las páginas. |
| `DELETE` | `/acta/:sesionId/item` | Elimina una página o el PDF de acta. |
| `DELETE` | `/acta/:sesionId` | Elimina el acta completa y sus archivos en Cloudinary. |

Los campos de archivo aceptan los nombres `imagen`, `image`, `foto` o `pagina` en las rutas de una sola imagen. En `/acta/subir` se aceptan `imagenes`, `imagen` o `paginas` (hasta 20).

## 1. Detectar esquinas

```http
POST /acta/detectar
Content-Type: multipart/form-data
```

| Campo | Tipo | Requerido | Descripción |
| --- | --- | --- | --- |
| `imagen` | File | Sí | Foto del acta. |
| `sesionId` | String | No | Si falta se usa el de la sesión autenticada. |

Respuesta:

```json
{
  "ok": true,
  "detectado": true,
  "metodo": "perspectiva",
  "confianza": 0.53,
  "areaRatio": 0.4518,
  "width": 1500,
  "height": 1900,
  "quad": [
    { "x": 322, "y": 256 },
    { "x": 1201, "y": 382 },
    { "x": 1178, "y": 1641 },
    { "x": 297, "y": 1516 }
  ],
  "quadNormalizado": [
    { "x": 0.2148, "y": 0.1347 },
    { "x": 0.8009, "y": 0.2011 },
    { "x": 0.7853, "y": 0.8637 },
    { "x": 0.1977, "y": 0.7979 }
  ],
  "box": { "left": 296, "top": 255, "width": 906, "height": 1387 }
}
```

- `quad` está en píxeles de la imagen ya orientada según EXIF.
- `quadNormalizado` está entre 0 y 1; es lo más cómodo para dibujar las esquinas en el móvil.
- `metodo` puede ser `perspectiva` (4 esquinas reales) o `rectangulo` (no se pudo estimar la perspectiva).
- Si `detectado` es `false`, conviene ofrecer recorte manual o `crop: "none"`.

El orden del arreglo es siempre: superior izquierda, superior derecha, inferior derecha, inferior izquierda.

## 2. Vista previa del escaneo

```http
POST /acta/procesar
Content-Type: multipart/form-data
```

| Campo | Tipo | Requerido | Descripción |
| --- | --- | --- | --- |
| `imagen` | File | Sí | Foto del acta. |
| `sesionId` | String | No | Sesión autenticada. |
| `scanMode` | String | No | Si se envía, aplica el filtro a la vista previa. Sin valor se devuelve la imagen original. Ver modos. |
| `crop` | String | No | `auto` recorta; por defecto **no se recorta**. |
| `quad` | JSON | No | Cuatro puntos ajustados manualmente (implica recorte). |
| `quadUnidades` | String | No | `normalizado` o `pixel`. Se autodetecta si se omite. |

Sin `?formato=json` responde directamente un JPEG y agrega estos headers:

- `X-Acta-Escaneada`: `0` por defecto; `1` solo si se pidieron opciones de escaneo.
- `X-Acta-Modo`: modo aplicado (`original` cuando no se procesa).
- `X-Acta-Metodo`: `completo` por defecto; `perspectiva`, `manual`, `rectangulo` o `recorte` si se recortó explícitamente.
- `X-Acta-Width` y `X-Acta-Height`: dimensiones de salida.

Con `?formato=json` responde:

```json
{
  "ok": true,
  "procesada": true,
  "scanMode": "clean",
  "width": 891,
  "height": 1261,
  "metodo": "perspectiva",
  "crop": { "tipo": "perspectiva", "quad": [{ "x": 0.21, "y": 0.13 }] },
  "quad": [{ "x": 0.21, "y": 0.13 }],
  "imagen": "data:image/jpeg;base64,..."
}
```

La variante JSON es útil si el frontend corre en otro dominio y no puede leer headers personalizados con facilidad.

## 3. Subir páginas (sin procesamiento)

```http
POST /acta/subir
Content-Type: multipart/form-data
```

| Campo | Tipo | Requerido | Descripción |
| --- | --- | --- | --- |
| `sesionId` | String | Sí | Sesión del acta. |
| `imagenes` | File[] | Sí* | Hasta 20 páginas. |
| `acta` | File | No | PDF de acta ya existente. |
| `scanMode`, `scanModes`, `crop`, `crops`, `quad`, `quads`, `quadUnidades` | — | No | **Se ignoran.** Esta ruta siempre guarda la imagen original. |

\* Se requiere al menos `imagenes` o `acta`.

Las páginas se almacenan sin recortar y en su formato original. Para obtener una vista previa con filtros usa `/acta/procesar`, pero ese resultado no reemplaza a la página guardada.

Respuesta:

```json
{
  "ok": true,
  "sesionId": "64f1c9e8...",
  "paginas": 2,
  "escaneadas": 2,
  "acta": null,
  "imagenes": [
    {
      "url": "https://res.cloudinary.com/.../pagina-1.jpg",
      "public_id": "actas/.../imagenes/abc",
      "width": 891,
      "height": 1261,
      "escaneada": false,
      "scanMode": "original",
      "quad": null,
      "crop": null,
      "orden": 0
    }
  ],
  "pdfPath": "/acta/64f1c9e8.../pdf",
  "persistido": true
}
```

Cada llamada agrega páginas al final. Para escanear página por página usa `POST /acta/:sesionId/pagina` con el mismo formato de una sola imagen.

## 4. Consultar, ordenar y generar el PDF

```http
GET /acta/:sesionId
```

Devuelve `acta`, `imagenes`, `paginas`, `escaneadas` y `pdfPath`.

```http
PATCH /acta/:sesionId/orden
Content-Type: application/json

{ "orden": ["public_id_2", "public_id_1"] }
```

También acepta `{ "paginas": [{ "public_id": "..." }] }` o `{ "imagenes": [...] }`. Las páginas no incluidas quedan al final conservando su orden.

```http
GET /acta/:sesionId/pdf
```

Devuelve un PDF A4 (horizontal o vertical según cada página). Con `?descargar=1` fuerza `Content-Disposition: attachment`; por defecto es `inline` para previsualizar en el navegador. El PDF no elimina las páginas: se pueden seguir reordenando o generando de nuevo.

## Modos de escaneo

| Modo | Resultado |
| --- | --- |
| `original` | Sin filtros. Es el estado por defecto de las páginas guardadas. |
| `soft` | Mejora suave, mantiene el color natural y reduce saturación. |
| `clean` | Bloquea el fondo hacia blanco y resalta el texto. Solo se aplica si se pide explícitamente en `/acta/procesar`. |
| `bn` | Escala de grises con alto contraste, ideal para actas con texto. |

Alias aceptados: `bw`, `b/n`, `blanco`, `gray`, `gris` → `bn`; `magic`, `color`, `documento`, `auto` → `clean`.

## Persistencia y limpieza

- Las actas se guardan en la colección MongoDB `actasdocumentos` (modelo `ActaDocumento`) y se mantiene una copia en memoria para acelerar la generación del informe.
- Si el servidor se reinicia, la primera consulta a `/acta/:sesionId` o la generación del informe recuperan el acta desde MongoDB.
- Al generar el informe técnico, `routes/pdf.js` hidrata el acta desde MongoDB, la fusiona con el informe y elimina tanto los archivos de Cloudinary como el registro de MongoDB.
- `DELETE /acta/:sesionId/item` elimina una página concreta (o el PDF de acta) y reordena las restantes.
- `DELETE /acta/:sesionId` elimina todas las páginas, el PDF y el documento de MongoDB.

## Límites y rendimiento

- Tamaño máximo por archivo: 25 MB.
- Máximo 25 archivos por request; 20 páginas de imagen por `/acta/subir`.
- Las páginas subidas conservan su resolución y formato originales; no se limitan a 1800 × 2400 px ni se recodifican a JPEG.
- Los límites de 1800 × 2400 px y JPEG 90 con `mozjpeg` aplican únicamente a `/acta/procesar` cuando se pide un escaneo explícito.
- Tiempos de referencia en un equipo de desarrollo: detección ~0.06–0.2 s; escaneo opcional ~0.2–0.5 s por página.

## Ejemplo mínimo en el frontend

```js
async function subirActa({ token, sesionId, fotos }) {
  const form = new FormData();
  form.append('sesionId', sesionId);

  for (const foto of fotos) {
    form.append('imagenes', foto, foto.name);
  }

  const respuesta = await fetch('/acta/subir', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form
  }).then((r) => r.json());

  return respuesta;
}
```

Para descargar el PDF con autenticación:

```js
const pdf = await fetch(`/acta/${sesionId}/pdf?descargar=1`, {
  headers: { Authorization: `Bearer ${token}` }
}).then((r) => r.blob());
```
