create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  desired_username text;
begin
  desired_username := nullif(trim(new.raw_user_meta_data ->> 'username'), '');

  if desired_username is null or desired_username !~ '^[a-zA-Z0-9_]{3,24}$' then
    raise exception 'Username must be 3-24 chars (letters, numbers, underscore).';
  end if;

  insert into public.profiles (user_id, username)
  values (new.id, desired_username);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;

create trigger on_auth_user_created_profile
after insert on auth.users
for each row execute procedure public.handle_new_user_profile();
