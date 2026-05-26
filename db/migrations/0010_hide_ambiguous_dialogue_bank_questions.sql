-- Hide known ambiguous dialogue/catchphrase MC questions that slipped into
-- the bank before the stricter post-generation filters were added. These rows
-- are historical data only; existing matches keep working via questions rows.
UPDATE question_bank
   SET hidden = true
 WHERE hidden = false
   AND question_text IN (
     'What is Borat''s catchphrase used to express approval throughout the film?',
     'What greeting does Borat use repeatedly when meeting Americans throughout the film?'
   );
