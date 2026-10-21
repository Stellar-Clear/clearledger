# Marketplace pagination

The marketplace requests bounded pages from the indexer and keeps the active status and amount filters while moving between pages. Page size is selectable; changing a filter resets the page to one so a result cannot be skipped. A page count is derived from the indexer total and an empty page is handled as a normal no-results state.
