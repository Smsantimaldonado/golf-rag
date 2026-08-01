# Golf RAG

Asistente de reglas de golf basado exclusivamente en documentación local. Procesa los PDFs de reglas, recupera los pasajes pertinentes y responde con una decisión, explicación, regla citada e incertidumbre cuando falten datos.

Incluye dos formas de consulta:

- CLI local contra una base vectorial Chroma.
- WebApp Next.js que consulta Supabase/pgvector y está preparada para desplegarse en Vercel.

## Arquitectura

```text
PDFs de reglas → extracción y chunks → embeddings → Chroma o Supabase/pgvector
                                                     ↓
                                             CLI o WebApp → respuesta con citas
```

El modelo no debe usar conocimiento externo para decidir una regla. Si los documentos recuperados o la descripción de la situación no son suficientes, debe indicarlo y pedir la aclaración necesaria.

## Estructura del repositorio

```text
agent/       Consulta local y generación de respuestas.
data/        PDFs fuente de las reglas.
docs/        Casos de prueba manuales.
ingest/      Extracción, chunking, embeddings y carga de datos.
scripts/     Preparación del entorno.
supabase/    Esquema SQL para pgvector.
vectordb/    Chunks y manifiestos generados; la base Chroma se ignora.
web/         WebApp Next.js.
```

## Requisitos

- Python 3.11 o superior.
- Node.js 20.9 o superior para la WebApp.
- Una clave de OpenAI para generar embeddings y respuestas.
- Un proyecto Supabase solo si se utilizará la WebApp o el backend pgvector.

## Inicio rápido local

1. Crear e instalar el entorno de Python:

   **Windows PowerShell**

   ```powershell
   .\scripts\setup_env.ps1
   ```

   **macOS / Linux**

   ```bash
   ./scripts/setup_env.sh
   ```

   Para recrearlo, usar `-Force` en PowerShell o `--force` en macOS/Linux.

2. Copiar la plantilla de variables y completar al menos `OPENAI_API_KEY`:

   ```powershell
   Copy-Item .env.example .env
   ```

3. Generar los chunks, crear Chroma y hacer una consulta:

   ```powershell
   python ingest\chunking.py
   python ingest\build_vector_db.py
   python agent\query_agent.py "Mi bola está injugable dentro de un bunker. ¿Puedo dropear fuera?"
   ```

Use `--show-context` en `query_agent.py` para inspeccionar los pasajes recuperados.

## Configuración

`.env` es solo para uso local y nunca debe versionarse. `.env.example` sí se versiona y contiene todas las variables soportadas:

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
```

`SUPABASE_DB_URL` se utiliza únicamente durante la carga local. `SUPABASE_SERVICE_ROLE_KEY` se usa exclusivamente en el servidor: no debe exponerse al cliente ni incluirse en variables con prefijo `NEXT_PUBLIC_`.

## Pipeline de ingesta

Los PDFs iniciales están en `data/`. Cada vez que se agreguen o reemplacen documentos, vuelva a ejecutar el pipeline.

```powershell
# 1. Crear chunks con fuente, página, encabezado y número de regla.
python ingest\chunking.py

# 2. Opcional: detectar páginas con diagramas y renderizarlas.
python ingest\pdf_visuals.py

# 3. Opcional: describir los elementos visuales con OpenAI.
python ingest\describe_visuals.py

# 4a. Crear la base local Chroma.
python ingest\build_vector_db.py

# 4b. O cargar los chunks en Supabase/pgvector.
python ingest\load_supabase.py --reset
```

Los resultados textuales se guardan en `vectordb/chunks.jsonl`. El manifiesto visual se guarda en `vectordb/pdf_visuals.jsonl`; las imágenes renderizadas y la base Chroma son artefactos locales ignorados por Git.

Para pruebas rápidas, `build_vector_db.py` y `load_supabase.py` admiten `--limit 5`.

## Supabase y la WebApp

1. Cree un proyecto Supabase y ejecute [`supabase/schema.sql`](supabase/schema.sql) en el SQL Editor.
2. Complete las variables de Supabase en `.env` y ejecute `python ingest\load_supabase.py --reset`.
3. Configure la WebApp:

   ```powershell
   cd web
   Copy-Item .env.local.example .env.local
   npm install
   npm run dev
   ```

4. Abra <http://localhost:3000>.

`web/.env.local` requiere `OPENAI_API_KEY`, `OPENAI_EMBEDDING_MODEL`, `OPENAI_ANSWER_MODEL`, `OPENAI_INTERPRETER_MODEL`, `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`. El endpoint `POST /api/ask` se ejecuta del lado servidor y permite hasta tres mensajes por caso para consolidar los hechos.

Antes de desplegar, valide la aplicación:

```powershell
cd web
npm run build
```

Para Vercel, use `web/` como directorio raíz y cargue las mismas variables de la WebApp. No configure `SUPABASE_DB_URL` en Vercel.

## Pruebas

Los escenarios de regresión manual están en [`docs/golden-set.md`](docs/golden-set.md). Incluyen bola equivocada, bola no encontrada, interferencia de una obstrucción inamovible y seguimientos conversacionales.

## Datos y secretos

No suba claves, entornos virtuales, dependencias instaladas, builds, caches ni bases vectoriales generadas. Consulte [`.gitignore`](.gitignore) para el detalle de los artefactos locales excluidos.
