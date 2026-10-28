-- 파일 저장소 (Supabase Storage). 경로 규칙: <project_id>/<파일>
-- raw-files: 고객사가 낸 원자료 (가명 처리 전 원본은 저장하지 않는다 — 업로드 API가 가명 처리 후 저장)
-- proposal-pdfs: 기획서 PDF
-- source-files: 피치덱·사진 등 사업 모델 원본 자료

insert into storage.buckets (id, name, public)
values ('raw-files', 'raw-files', false),
       ('proposal-pdfs', 'proposal-pdfs', false),
       ('source-files', 'source-files', false)
on conflict (id) do nothing;

create policy storage_read_members on storage.objects for select to authenticated
  using (
    bucket_id in ('raw-files', 'proposal-pdfs', 'source-files')
    and public.can_read_project(((storage.foldername(name))[1])::uuid)
  );

create policy storage_write_editors on storage.objects for insert to authenticated
  with check (
    bucket_id in ('source-files')
    and public.is_project_editor(((storage.foldername(name))[1])::uuid)
  );

create policy storage_delete_editors on storage.objects for delete to authenticated
  using (
    bucket_id in ('raw-files', 'source-files')
    and public.is_project_editor(((storage.foldername(name))[1])::uuid)
  );
