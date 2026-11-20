CREATE INDEX attempts_cleanup_terminal ON attempts(cleaned_at,key)
 WHERE terminal=1 AND released!=1;
CREATE INDEX attempts_cleanup_uncertain ON attempts(key) WHERE terminal=0;
CREATE INDEX attempts_cleanup_cursor ON attempts(cleaned_at,key)
 WHERE terminal=0 AND cleaned_at>0;
CREATE INDEX files_cleanup_object_key ON files(object_key) WHERE object_key IS NOT NULL;
CREATE INDEX captures_cleanup_live ON captures(expires_at,pending_until,status) WHERE status!='deleted';
CREATE INDEX auth_grants_encryption_peers ON auth_grants(account_id,id)
 WHERE approved_at IS NOT NULL AND user_id IS NOT NULL AND revoked_at IS NULL;
