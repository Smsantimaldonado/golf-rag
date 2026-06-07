# golf-rag

Asistente experto en reglas de golf con búsqueda documental sobre PDFs locales.

El objetivo es construir un agente que responda consultas de texto e imagen sobre situaciones de juego. La respuesta debe estar fundamentada solo en los documentos provistos, citar siempre la regla aplicable y admitir incertidumbre cuando la imagen o la información recuperada no alcancen.

## Documentos fuente

Los documentos iniciales están en `data/`:

- `GUIA_A_LAS_REGLAS_DE_GOLF.pdf`: guía rápida de reglas.
- `Reglas_de_Golf.pdf`: libro de reglas propiamente dicho.

Estos PDFs pueden reemplazarse o ampliarse en el futuro. Después de cualquier cambio documental hay que volver a ejecutar la ingesta.

## Flujo previsto

1. Extraer texto por página desde los PDFs.
2. Crear chunks documentales con metadatos de fuente, página y número de regla.
3. Generar embeddings reales para esos chunks.
4. Guardar los chunks y embeddings en una base vectorial persistente.
5. Recibir consulta de usuario en texto, imagen o ambos.
6. Interpretar la situación visible y textual.
7. Buscar reglas e interpretaciones relevantes en la base documental.
8. Responder con regla citada, decisión y explicación.

El agente no debe usar conocimiento externo para decidir reglas. Si no encuentra sustento suficiente en los documentos, debe decirlo.

## Entorno

Crear el entorno virtual e instalar dependencias:

Windows PowerShell:

```powershell
.\scripts\setup_env.ps1
```

macOS / Linux:

```bash
./scripts/setup_env.sh
```

Para recrear el entorno:

```powershell
.\scripts\setup_env.ps1 -Force
```

```bash
./scripts/setup_env.sh --force
```

## Variables de entorno

Crear o actualizar `.env` a partir del archivo de ejemplo:

```powershell
Copy-Item .env.example .env
```

Luego completar los valores reales:

```env
OPENAI_API_KEY=
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_VISION_MODEL=gpt-5-mini
OPENAI_ANSWER_MODEL=gpt-5-mini
OPENAI_INTERPRETER_MODEL=gpt-5-mini
CHROMA_PERSIST_DIR=vectordb/chroma
CHROMA_COLLECTION_NAME=golf_rules
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_DB_URL=
APP_PASSCODE=
```

No commitear `.env`; ya está ignorado por Git.

Sí se debe commitear `.env.example`, porque no contiene secretos y sirve como plantilla de configuración.

## Ingesta textual

Generar chunks desde los PDFs:

```powershell
python ingest\chunking.py
```

El resultado se escribe en:

```text
vectordb/chunks.jsonl
```

Cada línea contiene:

- `id`
- `text`
- `metadata.source`
- `metadata.page_start`
- `metadata.page_end`
- `metadata.heading`
- `metadata.rule_number`
- `metadata.chunk_type`
- `metadata.has_visual_context`
- `metadata.visual_assets`, cuando el chunk está asociado a una página visual

## Ingesta visual

Algunas reglas contienen diagramas o ilustraciones que explican áreas de alivio, puntos de referencia, bunkers, greens, áreas de penalización u otras situaciones visuales.

Primero se renderizan las páginas candidatas y se crea un manifiesto:

```powershell
python ingest\pdf_visuals.py
```

Esto genera:

```text
vectordb/pdf_visuals.jsonl
vectordb/page_images/
```

Luego, cuando se vuelve a ejecutar `chunking.py`, los chunks que cruzan esas páginas quedan enlazados con los assets visuales.

Opcionalmente, una vez configurado `.env` con `OPENAI_API_KEY` y, si se desea, `OPENAI_VISION_MODEL`, se pueden generar descripciones visuales preprocesadas:

```powershell
python ingest\describe_visuals.py
```

Modelo visual recomendado para esta etapa:

```env
OPENAI_VISION_MODEL=gpt-5-mini
```

Esas descripciones se guardan en `vectordb/pdf_visuals.jsonl` y luego se incorporan al texto indexable al regenerar chunks:

```powershell
python ingest\chunking.py
```

## Base vectorial

Construir la base Chroma persistente desde `vectordb/chunks.jsonl`:

```powershell
python ingest\build_vector_db.py
```

El script:

- lee `vectordb/chunks.jsonl`;
- genera embeddings con `OPENAI_EMBEDDING_MODEL`;
- crea o reemplaza la colección `CHROMA_COLLECTION_NAME`;
- guarda la base en `CHROMA_PERSIST_DIR`;
- preserva metadatos citables como regla, fuente, páginas y contexto visual.

Para una prueba chica:

```powershell
python ingest\build_vector_db.py --limit 5
```

## Supabase pgvector

Supabase es el backend recomendado para la primera webapp deployable en Vercel. Chroma puede seguir usándose localmente, pero Vercel consultará Supabase.

1. Crear un proyecto en Supabase.
2. Abrir el SQL Editor y ejecutar:

```text
supabase/schema.sql
```

3. Completar `.env` con:

```env
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_DB_URL=
```

`SUPABASE_DB_URL` es el connection string de Postgres. Se usa solo para la carga local de chunks. `SUPABASE_SERVICE_ROLE_KEY` se usa del lado servidor en la webapp y no debe exponerse en el cliente.

4. Cargar los chunks en Supabase:

```powershell
python ingest\load_supabase.py --reset
```

Para una prueba chica:

```powershell
python ingest\load_supabase.py --limit 5 --reset
```

## Consulta textual MVP

Hacer una consulta textual contra Chroma y generar una respuesta fundada:

```powershell
python agent\query_agent.py "Mi bola está injugable dentro de un bunker. ¿Puedo dropear fuera?"
```

Para inspeccionar los chunks recuperados:

```powershell
python agent\query_agent.py "Mi consulta" --show-context
```

La respuesta debe seguir este formato:

- Regla citada
- Decisión
- Explicación
- Incertidumbre

## Consulta WebApp MVP

La primera respuesta de cada caso debe seguir este formato:

- Decisión
- Explicación
- Regla citada
- Incertidumbre

La conversación por caso admite hasta 3 mensajes del usuario. La WebApp usa esos mensajes para consolidar los hechos, pero las reglas siguen saliendo solo del contexto recuperado desde Supabase.

La WebApp acepta texto, imagen, o texto + imagen. Para el MVP multimodal, cada mensaje puede incluir como máximo una imagen JPG, PNG o WEBP de hasta 5 MB. Las imágenes se procesan en memoria y no se guardan.

Desde el segundo mensaje del usuario, el agente responde directamente el seguimiento sin forzar las cuatro secciones, pero debe mantener cita de regla y explicación suficiente. Si el usuario agrega datos o corrige el caso, la respuesta debe integrar la información nueva.

Antes de buscar reglas, la WebApp ejecuta una normalización semántica de la consulta. Esa capa puede emparentar términos coloquiales o hechos visuales con categorías buscables, por ejemplo una instalación fija de riego con una obstrucción inamovible, y expande la consulta para mejorar el retrieval. Si la confianza es baja, el agente debe pedir una aclaración breve antes de decidir.

La webapp está en `web/` y usa Next.js con un endpoint server-side `POST /api/ask`.

Configurar `web/.env.local` a partir del archivo de ejemplo:

```powershell
cd web
Copy-Item .env.local.example .env.local
```

Luego completar:

```env
OPENAI_API_KEY=
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_ANSWER_MODEL=gpt-5-mini
OPENAI_INTERPRETER_MODEL=gpt-5-mini
OPENAI_VISION_MODEL=gpt-5-mini
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
APP_PASSCODE=
```

Instalar y correr:

```powershell
cd web
npm install
npm run dev
```

Abrir:

```text
http://localhost:3000
```

`web/.env.local` no se debe commitear. `web/.env.local.example` sí se debe commitear.

## Deploy en Vercel

La webapp se puede deployar en Vercel usando `web/` como root directory del proyecto.

Variables necesarias en Vercel:

```env
OPENAI_API_KEY=
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_ANSWER_MODEL=gpt-5-mini
OPENAI_INTERPRETER_MODEL=gpt-5-mini
OPENAI_VISION_MODEL=gpt-5-mini
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
APP_PASSCODE=
```

No cargar `SUPABASE_DB_URL` en Vercel. Esa variable solo se usa localmente para cargar chunks en Supabase.

Antes de deployar, verificar localmente:

```powershell
cd web
npm run build
```

El endpoint `POST /api/ask` usa varias llamadas server-side encadenadas (normalización semántica, embeddings, Supabase y respuesta), por lo que la función está configurada con una duración máxima de 60 segundos para producción.

Pruebas funcionales mínimas antes del deploy:

- Bola equivocada en juego por golpes: debe citar Regla 6.3c y decir la penalización y cómo corregir.
- Bola no encontrada: debe explicar búsqueda de tres minutos y golpe y distancia sin remisión vacía.
- Aspersor fijo con interferencia: debe priorizar alivio sin penalidad si el contexto lo sostiene.
- Imagen de una situación de juego: debe describir hechos visibles, buscar reglas en Supabase y declarar incertidumbre si la imagen no alcanza.
- Segundo mensaje de una mini conversación: debe responder directo al seguimiento, sin forzar el formato de primera respuesta.
- Si el usuario no menciona área de penalización, no debe agregar una opción hipotética de área de penalización.

El set estable de pruebas manuales está en `docs/golden-set.md`.



## Próximos pasos

Próximo paso recomendado: preparar el deploy de la WebApp en Vercel usando `web/` como root directory, cargar las variables de entorno de producción y hacer una prueba funcional completa contra Supabase.

Después de eso, mejorar la evaluación multimodal con un golden set de imágenes reales no sensibles y ajustar la experiencia para beta privada.
