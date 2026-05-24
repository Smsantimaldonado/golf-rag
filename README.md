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

Crear o actualizar `.env` con los valores reales:

```env
OPENAI_API_KEY=
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_VISION_MODEL=gpt-5-mini
OPENAI_ANSWER_MODEL=gpt-5-mini
CHROMA_PERSIST_DIR=vectordb/chroma
CHROMA_COLLECTION_NAME=golf_rules
```

No commitear `.env`; ya está ignorado por Git.

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

## Próximos pasos

Agregar entrada de imagen del usuario: interpretar la situación visual, combinarla con la descripción textual y usar esa situación normalizada para la búsqueda documental en Chroma.
