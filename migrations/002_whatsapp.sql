-- Integração com WhatsApp (Cloud API da Meta)

-- Número de WhatsApp vinculado ao usuário (somente dígitos, com DDI: 5511999998888)
ALTER TABLE usuarios ADD COLUMN whatsapp TEXT CHECK (whatsapp IS NULL OR whatsapp ~ '^[0-9]{10,15}$');
CREATE UNIQUE INDEX usuarios_whatsapp_unq ON usuarios (whatsapp) WHERE whatsapp IS NOT NULL;

-- Registro de mensagens recebidas e enviadas
CREATE TABLE whatsapp_mensagens (
  id SERIAL PRIMARY KEY,
  direcao TEXT NOT NULL CHECK (direcao IN ('entrada', 'saida')),
  telefone TEXT NOT NULL,
  usuario_id INTEGER REFERENCES usuarios(id),
  wa_message_id TEXT,
  tipo TEXT NOT NULL,
  texto TEXT,
  status TEXT,
  registrado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- A Meta pode reenviar o mesmo evento: o ID impede processar duas vezes
CREATE UNIQUE INDEX whatsapp_msg_entrada_unq ON whatsapp_mensagens (wa_message_id) WHERE direcao = 'entrada';
CREATE INDEX whatsapp_msg_data_idx ON whatsapp_mensagens (registrado_em DESC);

-- Cadastro aguardando confirmação ("SIM") de cada usuário
CREATE TABLE whatsapp_rascunhos (
  usuario_id INTEGER PRIMARY KEY REFERENCES usuarios(id),
  telefone TEXT NOT NULL,
  dados JSONB NOT NULL,
  foto BYTEA,
  foto_tipo TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
