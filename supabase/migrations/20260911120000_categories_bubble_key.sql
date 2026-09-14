-- Rename plant_key -> bubble_key and its species-named values to neutral
-- color words, as part of moving the dashboard visualization from plants to
-- bubbles. Same six categories, same six underlying hex values in the app's
-- CSS — only the column name and the six stored words change.

alter table public.categories rename column plant_key to bubble_key;

update public.categories set bubble_key = 'teal'    where bubble_key = 'vine';
update public.categories set bubble_key = 'magenta' where bubble_key = 'orchid';
update public.categories set bubble_key = 'lime'    where bubble_key = 'bamboo';
update public.categories set bubble_key = 'crimson' where bubble_key = 'tomato';
update public.categories set bubble_key = 'jade'    where bubble_key = 'fern';
update public.categories set bubble_key = 'lilac'   where bubble_key = 'succulent';
