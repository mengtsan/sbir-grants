ALTER TABLE documents ADD COLUMN content_hash TEXT;
ALTER TABLE documents ADD COLUMN duplicate_of_document_id TEXT REFERENCES documents(id) ON DELETE SET NULL;

CREATE INDEX idx_documents_project_content_hash ON documents(project_id, content_hash);
CREATE INDEX idx_documents_duplicate_source ON documents(duplicate_of_document_id);
