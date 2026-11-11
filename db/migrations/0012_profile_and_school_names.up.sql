-- Profile settings: a small profile picture stored inline as a data URL
-- (the web app resizes uploads to 160px JPEG before sending them).
ALTER TABLE users ADD COLUMN avatar_data_url TEXT;
ALTER TABLE users ADD CONSTRAINT users_avatar_shape CHECK (
  avatar_data_url IS NULL
  OR (avatar_data_url ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$' AND length(avatar_data_url) <= 60000));

-- Display names for schools. Every spelling of Alberta and UBC becomes one
-- name, so lists that show schools by name collapse their duplicate rows.
-- UBC Okanagan (UBCO) and Alberta's Augustana campus keep their own names.
UPDATE universities SET name = 'UofA'
 WHERE lower(name) ~ '(^|\W)alberta(\W|$)' AND lower(name) !~ 'augustana' AND name <> 'UofA';
UPDATE universities SET name = 'UBC'
 WHERE (lower(name) ~ '^(the )?(ubc|university of british columbia|british columbia)(\W|$)')
   AND lower(name) !~ 'okanagan|ubco' AND name <> 'UBC';
UPDATE universities SET name = 'UofC'
 WHERE lower(name) ~ '(^|\W)calgary(\W|$)' AND name <> 'UofC';
UPDATE universities SET name = 'MRU'
 WHERE lower(name) ~ '(^|\W)mount royal(\W|$)' AND name <> 'MRU';
