-- Remove a integração com WhatsApp (descontinuada).
DROP TABLE IF EXISTS whatsapp_rascunhos;
DROP TABLE IF EXISTS whatsapp_mensagens;
DROP INDEX IF EXISTS usuarios_whatsapp_unq;
ALTER TABLE usuarios DROP COLUMN IF EXISTS whatsapp;
