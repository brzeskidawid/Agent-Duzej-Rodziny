-- =====================================================================
--  Stare wpisy 4Parents nie miały terminu: worker zapisuje wpisy z
--  ignore_duplicates=True, więc poprawka liczenia dat nie objęła tego,
--  co już było w bazie. Uzupełniamy datą publikacji (tak liczy to worker).
-- =====================================================================
update public.items set occurred_at = published_at
where source = '4parents' and occurred_at is null and published_at is not null;

select count(*) filter (where occurred_at is null) as bez_terminu,
       count(*) as razem
from public.items where source = '4parents';
