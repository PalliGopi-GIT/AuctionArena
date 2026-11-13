# Local runtime deviations from the selected target

The current app uses a single Node process and file-backed state; it is development-only. The selected target uses one SQLite-backed Durable Object per room, Hono on Workers, hibernating WebSockets and Durable Object alarms. None of those target adapters is implemented yet. Cross-room queries, authorization, deletion, export, archive and transactional settlement need explicit design and tests. The former platform comparison is retained in the historical archive.
