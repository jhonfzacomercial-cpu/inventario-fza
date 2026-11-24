-- Inventário Patrimonial Grupo FZA — estrutura inicial

CREATE TABLE IF NOT EXISTS sistema (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE usuarios (
  id SERIAL PRIMARY KEY,
  login TEXT NOT NULL,
  nome TEXT NOT NULL,
  senha_hash TEXT NOT NULL,
  perfil TEXT NOT NULL CHECK (perfil IN ('admin', 'operador')),
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  trocar_senha BOOLEAN NOT NULL DEFAULT TRUE,
  ultimo_acesso TIMESTAMPTZ,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por INTEGER REFERENCES usuarios(id),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX usuarios_login_unq ON usuarios (lower(login));

CREATE TABLE setores (
  id SERIAL PRIMARY KEY,
  codigo CHAR(2) NOT NULL UNIQUE CHECK (codigo ~ '^[0-9]{2}$'),
  nome TEXT NOT NULL,
  responsavel TEXT,
  ultimo_sequencial INTEGER NOT NULL DEFAULT 0 CHECK (ultimo_sequencial >= 0),
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por INTEGER REFERENCES usuarios(id),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_por INTEGER REFERENCES usuarios(id)
);
CREATE UNIQUE INDEX setores_nome_unq ON setores (lower(nome));

CREATE TABLE categorias (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX categorias_nome_unq ON categorias (lower(nome));

INSERT INTO categorias (nome) VALUES
  ('Computador'), ('Notebook'), ('Monitor'), ('Mouse'), ('Teclado'),
  ('Câmera'), ('Lente'), ('Drone'), ('Acessórios'), ('Iluminação'),
  ('Áudio'), ('Mobiliário'), ('Outros');

CREATE TABLE equipamentos (
  id SERIAL PRIMARY KEY,
  -- Código patrimonial: nunca muda, nunca é reutilizado.
  codigo TEXT NOT NULL UNIQUE CHECK (codigo ~ '^FZA\.[0-9]{2}\.[0-9]{3,}$'),
  setor_origem_id INTEGER NOT NULL REFERENCES setores(id),
  sequencial INTEGER NOT NULL CHECK (sequencial > 0),
  descricao TEXT NOT NULL,
  categoria_id INTEGER NOT NULL REFERENCES categorias(id),
  marca TEXT,
  modelo TEXT,
  numero_serie TEXT,
  setor_id INTEGER NOT NULL REFERENCES setores(id),
  responsavel TEXT,
  data_aquisicao DATE,
  valor_aquisicao NUMERIC(14,2) CHECK (valor_aquisicao IS NULL OR valor_aquisicao >= 0),
  estado TEXT NOT NULL CHECK (estado IN ('novo','bom','regular','ruim','inservivel')),
  situacao TEXT NOT NULL CHECK (situacao IN ('em_uso','disponivel','manutencao','emprestado','baixado')),
  observacoes TEXT,
  foto BYTEA,
  foto_tipo TEXT,
  -- Baixa patrimonial
  baixa_data DATE,
  baixa_motivo TEXT CHECK (baixa_motivo IS NULL OR baixa_motivo IN ('descarte','venda','doacao','perda','furto','outro')),
  baixa_observacoes TEXT,
  baixa_registrada_em TIMESTAMPTZ,
  baixa_usuario_id INTEGER REFERENCES usuarios(id),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por INTEGER REFERENCES usuarios(id),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_por INTEGER REFERENCES usuarios(id),
  UNIQUE (setor_origem_id, sequencial),
  CHECK ((situacao = 'baixado') = (baixa_data IS NOT NULL AND baixa_motivo IS NOT NULL))
);
CREATE INDEX equipamentos_setor_idx ON equipamentos (setor_id);
CREATE INDEX equipamentos_categoria_idx ON equipamentos (categoria_id);
CREATE INDEX equipamentos_situacao_idx ON equipamentos (situacao);
CREATE INDEX equipamentos_serie_idx ON equipamentos (lower(numero_serie));

-- Impede exclusão física de equipamentos (o código jamais pode ser liberado).
CREATE FUNCTION impedir_exclusao_equipamento() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Equipamentos não podem ser excluídos; utilize a baixa patrimonial.';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER equipamentos_sem_delete BEFORE DELETE ON equipamentos
  FOR EACH ROW EXECUTE FUNCTION impedir_exclusao_equipamento();

-- Impede alteração do código patrimonial.
CREATE FUNCTION impedir_troca_codigo() RETURNS trigger AS $$
BEGIN
  IF NEW.codigo <> OLD.codigo OR NEW.setor_origem_id <> OLD.setor_origem_id OR NEW.sequencial <> OLD.sequencial THEN
    RAISE EXCEPTION 'O código patrimonial não pode ser alterado.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER equipamentos_codigo_fixo BEFORE UPDATE ON equipamentos
  FOR EACH ROW EXECUTE FUNCTION impedir_troca_codigo();

-- Código do setor é imutável (os códigos já emitidos dependem dele).
CREATE FUNCTION impedir_troca_codigo_setor() RETURNS trigger AS $$
BEGIN
  IF NEW.codigo <> OLD.codigo THEN
    RAISE EXCEPTION 'O código do setor não pode ser alterado.';
  END IF;
  IF NEW.ultimo_sequencial < OLD.ultimo_sequencial THEN
    RAISE EXCEPTION 'A sequência patrimonial do setor não pode retroceder.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER setores_codigo_fixo BEFORE UPDATE ON setores
  FOR EACH ROW EXECUTE FUNCTION impedir_troca_codigo_setor();

-- Histórico de cada equipamento (cadastro, edição, transferência, baixa).
CREATE TABLE movimentacoes (
  id SERIAL PRIMARY KEY,
  equipamento_id INTEGER NOT NULL REFERENCES equipamentos(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('cadastro','edicao','transferencia','responsavel','baixa')),
  data_movimentacao DATE NOT NULL,
  setor_origem_id INTEGER REFERENCES setores(id),
  setor_destino_id INTEGER REFERENCES setores(id),
  responsavel_anterior TEXT,
  responsavel_novo TEXT,
  observacoes TEXT,
  detalhes JSONB,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  registrado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX movimentacoes_equip_idx ON movimentacoes (equipamento_id, registrado_em DESC);
CREATE INDEX movimentacoes_tipo_data_idx ON movimentacoes (tipo, data_movimentacao);

-- Auditoria geral (setores, categorias, usuários etc.).
CREATE TABLE auditoria (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id),
  acao TEXT NOT NULL,
  entidade TEXT NOT NULL,
  entidade_id INTEGER,
  detalhes JSONB,
  registrado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sessões (connect-pg-simple)
CREATE TABLE "sessao" (
  "sid" varchar NOT NULL COLLATE "default" PRIMARY KEY,
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL
);
CREATE INDEX "IDX_sessao_expire" ON "sessao" ("expire");
