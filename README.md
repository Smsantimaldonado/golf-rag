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

Copiar los nombres necesarios desde `.env.example` a `.env` y completar los valores reales.

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

## Proximos pasos

La pieza pendiente mas importante es reemplazar el placeholder de `ingest/build_vector_db.py` por una ingesta real que:

- lea `vectordb/chunks.jsonl`;
- genere embeddings con OpenAI;
- guarde la coleccion Chroma de forma persistente;
- preserve los metadatos para citar reglas y paginas.

Luego se puede construir la capa de consulta del agente: interpretacion visual, busqueda documental y respuesta final en formato fijo.
