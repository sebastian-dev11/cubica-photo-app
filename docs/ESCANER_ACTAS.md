# Escáner de actas (estilo CamScanner)

Este módulo permite convertir fotos de actas en páginas escaneadas: detecta el documento, corrige la perspectiva, aplica filtros de mejora, ordena varias páginas y genera un PDF listo para descargar o para fusionarse con el informe técnico.

Todo vive bajo `/acta` y requiere el token JWT habitual (`Authorization: Bearer <token>`). El `sesionId` debe pertenecer al usuario autenticado, salvo que sea administrador.

## Flujo recomendado desde el frontend

1. El usuario toma o selecciona una foto del acta.
2. `POST /acta/detectar` devuelve las 4 esquinas del documento.
3. Se muestran las esquinas para que el usuario las ajuste (opcional).
4. `POST /acta/procesar` devuelve una vista previa con el filtro seleccionado.
5. `POST /acta/subir` guarda las páginas escaneadas o `POST /acta/:sesionId/pagina` agrega una página por request.
6. `GET /acta/:sesionId/pdf` genera el PDF del acta.

## Endpoints

| Método | Ruta | Descripción |
| --- | --- | --- |
| `POST` | `/acta/detectar` | Detecta el documento y devuelve sus 4 esquinas. |
| `POST` | `/acta/procesar` | Procesa una imagen y devuelve la vista previa (binario o JSON). |
| `POST` | `/acta/subir` | Sube y escanea una o varias páginas, y opcionalmente un PDF de acta. |
| `POST` | `/acta/:sesionId/pagina` | Agrega una sola página escaneada a un acta existente. |
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
| `scanMode` | String | No | `clean` por defecto. Ver modos. |
| `crop` | String | No | `auto` por defecto; `none` desactiva el recorte. |
| `quad` | JSON | No | Cuatro puntos ajustados manualmente. |
| `quadUnidades` | String | No | `normalizado` o `pixel`. Se autodetecta si se omite. |

Sin `?formato=json` responde directamente un JPEG y agrega estos headers:

- `X-Acta-Escaneada`: `1` o `0`.
- `X-Acta-Modo`: modo aplicado.
- `X-Acta-Metodo`: `perspectiva`, `manual`, `rectangulo`, `recorte` o `completo`.
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

## 3. Subir y escanear páginas

```http
POST /acta/subir
Content-Type: multipart/form-data
```

| Campo | Tipo | Requerido | Descripción |
| --- | --- | --- | --- |
| `sesionId` | String | Sí | Sesión del acta. |
| `imagenes` | File[] | Sí* | Hasta 20 páginas. |
| `acta` | File | No | PDF de acta ya existente. |
| `scanMode` | String | No | Aplica a todas las páginas. Default `clean`. |
| `scanModes` | JSON[] | No | Modo por página, por ejemplo `["clean","bn"]`. |
| `crop` | String | No | `auto` (default) o `none`. |
| `crops` | JSON[] | No | Recorte por página, por ejemplo `[true,false]`. |
| `quad` | JSON | No | Esquinas para una sola página. |
| `quads` | JSON[] | No | Esquinas por página: `[[[x,y]...],[[x,y]...]]`. |
| `quadUnidades` | String | No | `normalizado` (recomendado) o `pixel`. |

\* Se requiere al menos `imagenes` o `acta`.

Las esquinas se pueden enviar como `[[x, y], ...]` o `[{ "x": 0.2, "y": 0.1 }, ...]`. Si todos los valores están entre 0 y 1 se interpretan como normalizados.

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
      "escaneada": true,
      "scanMode": "clean",
      "quad": [{ "x": 0.21, "y": 0.13 }],
      "crop": { "tipo": "perspectiva", "quad": [{ "x": 0.21, "y": 0.13 }] },
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
| `original` | Solo recorte y perspectiva, sin filtros de color. |
| `soft` | Mejora suave, mantiene el color natural y reduce saturación. |
| `clean` | **Default.** Bloquea el fondo hacia blanco y resalta el texto (equivalente al modo "mágico" de CamScanner). |
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
- Salida máxima por página: 1800 × 2400 px (se respeta la proporción y se limita a ~4.5 MP).
- Calidad JPEG 90 con `mozjpeg`.
- Tiempos de referencia en un equipo de desarrollo: detección ~0.06–0.2 s; escaneo completo ~0.2–0.5 s por página.

## Ejemplo mínimo en el frontend

```js
async function escanearActa({ token, sesionId, fotos }) {
  const form = new FormData();
  form.append('sesionId', sesionId);
  form.append('scanMode', 'clean');

  const quads = [];

  for (const foto of fotos) {
    const deteccion = new FormData();
    deteccion.append('sesionId', sesionId);
    deteccion.append('imagen', foto, foto.name);

    const respuestaDeteccion = await fetch('/acta/detectar', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: deteccion
    }).then((r) => r.json());

    quads.push(respuestaDeteccion.detectado ? respuestaDeteccion.quadNormalizado : null);
    form.append('imagenes', foto, foto.name);
  }

  form.append('quads', JSON.stringify(quads));

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
