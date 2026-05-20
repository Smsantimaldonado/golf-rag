# golf-rag

Asistente experto en reglas de golf con busqueda documental sobre PDFs locales.

El objetivo es construir un agente que responda consultas de texto e imagen sobre situaciones de juego. La respuesta debe estar fundamentada solo en los documentos provistos, citar siempre la regla aplicable y admitir incertidumbre cuando la imagen o la informacion recuperada no alcancen.

## Documentos fuente

Los documentos iniciales estan en `data/`:

- `GUIA_A_LAS_REGLAS_DE_GOLF.pdf`: guia rapida de reglas.
- `Reglas_de_Golf.pdf`: libro de reglas propiamente dicho.

Estos PDFs pueden reemplazarse o ampliarse en el futuro. Despues de cualquier cambio documental hay que volver a ejecutar la ingesta.

## Flujo previsto

1. Extraer texto por pagina desde los PDFs.
2. Crear chunks documentales con metadatos de fuente, pagina y numero de regla.
3. Generar embeddings reales para esos chunks.
4. Guardar los chunks y embeddings en una base vectorial persistente.
5. Recibir consulta de usuario en texto, imagen o ambos.
6. Interpretar la situacion visible y textual.
7. Buscar reglas e interpretaciones relevantes en la base documental.
8. Responder con regla citada, decision y explicacion.

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

No commitear `.env`; ya esta ignorado por Git.

## Ingesta textual

Generar chunks desde los PDFs:

```powershell
python ingest\chunking.py
```

El resultado se escribe en:

```text
vectordb/chunks.jsonl
```

Cada linea contiene:

- `id`
- `text`
- `metadata.source`
- `metadata.page_start`
- `metadata.page_end`
- `metadata.heading`
- `metadata.rule_number`
- `metadata.chunk_type`
- `metadata.has_visual_context`
- `metadata.visual_assets`, cuando el chunk esta asociado a una pagina visual

## Ingesta visual

Algunas reglas contienen diagramas o ilustraciones que explican areas de alivio, puntos de referencia, bunkers, greens, areas de penalizacion u otras situaciones visuales.

Primero se renderizan las paginas candidatas y se crea un manifiesto:

```powershell
python ingest\pdf_visuals.py
```

Esto genera:

```text
vectordb/pdf_visuals.jsonl
vectordb/page_images/
```

Luego, cuando se vuelve a ejecutar `chunking.py`, los chunks que cruzan esas paginas quedan enlazados con los assets visuales.

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
- crea o reemplaza la coleccion `CHROMA_COLLECTION_NAME`;
- guarda la base en `CHROMA_PERSIST_DIR`;
- preserva metadatos citables como regla, fuente, paginas y contexto visual.

Para una prueba chica:

```powershell
python ingest\build_vector_db.py --limit 5
```

## Proximos pasos

## Consulta textual MVP

Hacer una consulta textual contra Chroma y generar una respuesta fundada:

```powershell
python agent\query_agent.py "Mi bola esta injugable dentro de un bunker. Puedo dropear fuera?"
```

Para inspeccionar los chunks recuperados:

```powershell
python agent\query_agent.py "Mi consulta" --show-context
```

La respuesta debe seguir este formato:

- Regla citada
- Decision
- Explicacion
- Incertidumbre

## Proximos pasos

Agregar entrada de imagen del usuario: interpretar la situacion visual, combinarla con la descripcion textual y usar esa situacion normalizada para la busqueda documental en Chroma.
