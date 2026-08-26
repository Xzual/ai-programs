# EDITH Obsidian Knowledge Intelligence

## Summary

The former standalone Knowledge Map is now backed by a synchronized knowledge layer shared by EDITH, Memory V2, RAG indexing, agents, and the Obsidian vault at:

```text
D:\EDİTH\EDİTH
```

EDITH uses Obsidian as the human-editable Markdown vault and uses local EDITH persistence as the operational graph/RAG index.

## Implemented Components

- `ObsidianVaultService`
  - Watches the configured vault with filesystem events.
  - Reindexes Markdown, Canvas, and attachment files.
  - Handles create, edit, move/rename, and delete as index updates.
  - Writes EDITH-owned memory, task, and agent notes into the vault.

- `KnowledgeGraphService`
  - Persists real graph nodes and relationships.
  - Supports node types: Person, Organization, Project, Task, Note, Conversation, Website, File, Agent, Memory, Tool, Event, Trade.
  - Supports relationship types: worksWith, created, belongsTo, relatedTo, dependsOn, mentionedIn, owns, participatesIn, references, generatedBy.
  - Ingests EDITH runtime entities, tools, agents, tasks, memories, and Obsidian notes.

- `RagService`
  - Parses vault notes into chunks.
  - Stores chunk metadata locally.
  - Uses local lexical retrieval when no embedding provider is configured.
  - Reports `embedding_provider_required` honestly instead of claiming real embeddings.

- `ObsidianParser`
  - Parses Markdown notes, frontmatter/properties, aliases, tags, wikilinks, attachments, and Canvas JSON edges.
  - Converts wikilinks like `[[Apostolos]]`, `[[Water Literacy]]`, and `[[KA210-YOU]]` into graph relationships.

## API Surface

```text
GET  /api/edith/knowledge/graph
GET  /api/edith/knowledge/nodes/:id
GET  /api/edith/knowledge/search
POST /api/edith/knowledge/reindex
GET  /api/edith/knowledge/rag/status
GET  /api/edith/knowledge/rag/retrieve
GET  /api/edith/obsidian/status
PATCH /api/edith/obsidian/settings
POST /api/edith/obsidian/sync-now
POST /api/edith/obsidian/agent-notes
```

Backward compatibility remains:

```text
GET /api/edith/knowledge-map
```

## Agent Integration

The registry now includes `obsidian_save_note`, a low-risk knowledge tool requiring `memory:write`.

Agent routing supports:

- Research Agent -> `Research/`
- Coding Agent -> `Research/Technical/`
- Meeting Agent -> `Meetings/`
- Trading Agent -> `Trading/`

Trading actions remain guarded by `finance_trading_guard`; journal notes are safe knowledge writes.

## UI Changes

The Knowledge Map view is now an interactive Knowledge Intelligence view:

- Zoom and pan
- Search
- Filter by node type, relationship type, folder, tag, and source
- Selected-node detail panel
- Connection strength display
- Node importance sizing
- Recent Obsidian sync activity
- Reindex action

Settings now includes an Obsidian sync status card showing:

- Vault path
- Watcher status
- Obsidian config status
- Indexed notes
- RAG chunks
- Last sync
- Reindex button

## Sync Safety

- Unknown frontmatter fields are preserved.
- EDITH metadata is written with `edith_` frontmatter keys.
- Attachments are indexed but not modified.
- Deletes from Obsidian become soft-deletes in the EDITH note index.
- EDITH writes include sync markers to avoid watcher echo loops.
- All sync writes are audited.
- No Ollama server is started.

## Current Honest Limits

- Local SQLite/JSON stores graph and RAG index metadata.
- Real vector embeddings are optional and not faked.
- If no embedding provider is configured, retrieval uses lexical matching and reports `embedding_provider_required`.
- Obsidian Canvas parsing covers node/file relationships and edge connections as a foundation.

## Verification

Added focused test:

```text
npm run test:edith-obsidian-knowledge
```

Coverage includes:

- Markdown wikilinks, tags, properties, aliases, and attachments
- Canvas relationship parsing
- Vault reindex
- Water Literacy project sections and relationships
- RAG chunking and lexical retrieval
- Memory-to-Obsidian write
- Task-to-Obsidian write
- Agent note write
- Rename/move soft-delete index behavior
- Delete soft-delete index behavior
