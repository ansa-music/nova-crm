-- =====================================================================
-- Nova CRM — звук заказа своим файлом: аудио в разрешённые типы бакета
-- `row-files` (повторяемый файл, 25.09.2026).
--
-- «Настройки → Звук заказа → Загрузить файл» падал с «mime type audio/mpeg
-- is not supported»: у бакета в панели Supabase задан список разрешённых
-- типов (картинки, документы), аудио в нём нет. Добавляем аудио к ТОМУ, что
-- уже разрешено, ничего не убирая. Пустой список (всё разрешено) не трогаем.
--
-- Бакет живёт в схеме storage, которой владеет Supabase: если прав на
-- правку не хватит, файл только предупредит и НЕ остановит деплой (накат
-- идёт одной транзакцией вместе с сайтом — ошибка здесь держала бы все
-- выкладки). На локальном стенде без схемы storage — то же предупреждение.
-- =====================================================================

do $$
declare
  audio text[] := array[
    'audio/*', 'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave',
    'audio/ogg', 'audio/webm', 'audio/mp4', 'audio/x-m4a', 'audio/aac'
  ];
begin
  update storage.buckets b
     set allowed_mime_types = (
       select array_agg(distinct t order by t)
       from unnest(b.allowed_mime_types || audio) as t
     )
   where b.id = 'row-files'
     and b.allowed_mime_types is not null
     and cardinality(b.allowed_mime_types) > 0
     and not (b.allowed_mime_types @> audio);
exception when others then
  raise warning 'row-files: аудио не добавлено в разрешённые типы (%). Добавьте вручную: Storage → row-files → Edit bucket → Allowed MIME types → audio/*', sqlerrm;
end $$;
