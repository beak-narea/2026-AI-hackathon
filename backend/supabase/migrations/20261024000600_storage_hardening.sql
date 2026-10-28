-- 저장소: 브라우저가 Storage API로 직접 읽고 쓰지 않는다. 파일은 서버 API가 권한을 확인한 뒤 service role로 다룬다.
-- (외부 평가자가 원자료를 직접 내려받거나, uuid가 아닌 폴더 이름 때문에 정책 평가가 실패하는 문제를 함께 없앤다)
drop policy if exists storage_read_members on storage.objects;
drop policy if exists storage_write_editors on storage.objects;
drop policy if exists storage_delete_editors on storage.objects;
