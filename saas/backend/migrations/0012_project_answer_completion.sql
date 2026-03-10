ALTER TABLE project_answers ADD COLUMN confirmed_by_user INTEGER NOT NULL DEFAULT 1;
ALTER TABLE project_answers ADD COLUMN answer_source TEXT NOT NULL DEFAULT 'user';
ALTER TABLE project_answers ADD COLUMN confirmed_at DATETIME;

UPDATE project_answers
SET confirmed_at = CURRENT_TIMESTAMP
WHERE confirmed_at IS NULL;

CREATE TABLE project_answer_candidates (
    project_id TEXT NOT NULL,
    question_id TEXT NOT NULL,
    candidate_text TEXT NOT NULL,
    candidate_source TEXT NOT NULL DEFAULT 'extract',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    PRIMARY KEY (project_id, question_id)
);

CREATE INDEX idx_project_answer_candidates_project_updated
ON project_answer_candidates(project_id, updated_at);
