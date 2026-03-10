ALTER TABLE project_answers ADD COLUMN raw_answer_text TEXT;

UPDATE project_answers
SET raw_answer_text = answer_text
WHERE raw_answer_text IS NULL;

ALTER TABLE project_answer_candidates ADD COLUMN confidence REAL;
ALTER TABLE project_answer_candidates ADD COLUMN candidate_reason TEXT;
ALTER TABLE project_answer_candidates ADD COLUMN candidate_source_detail TEXT;

UPDATE project_answer_candidates
SET confidence = CASE
    WHEN candidate_source = 'g0v' THEN 0.95
    WHEN candidate_source = 'extract' THEN 0.60
    WHEN candidate_source = 'enrich' THEN 0.70
    ELSE 0.50
END
WHERE confidence IS NULL;
