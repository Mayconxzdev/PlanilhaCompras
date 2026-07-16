# Segurança e limites do modo demonstrativo

## Dados publicados

Este repositório contém somente `demo-data/seed.json`, uma massa criada para portfólio. Não são versionados catálogo operacional, contatos reais, históricos de preços, backups, bancos SQLite, logs, planilhas importadas, caminhos de rede ou credenciais.

`.gitignore` protege os diretórios de execução (`.runtime/`), variáveis de ambiente e bancos locais. Antes de qualquer contribuição, execute a busca de dados sensíveis descrita em [testing.md](testing.md).

## Escritas administrativas

As rotas que alteram catálogo, resetam a base, criam/restauram/removem backups ou recriam o índice usam `require_write_access`.

- `PROCUREFLOW_DEMO=1` sem token: permitido apenas para a demonstração em loopback iniciada por `scripts/run-demo.ps1`.
- Modo normal: falha fechada até que `PROCUREFLOW_ADMIN_TOKEN` seja configurado.
- Token configurado: o cliente administrativo deve enviar `X-ProcureFlow-Token`.

O token não é uma implementação completa de gestão de usuários; é uma barreira mínima adequada para um serviço local simples. Uma evolução corporativa deve adotar autenticação centralizada, autorização por papel, rotação de segredo, HTTPS e logs de auditoria imutáveis.

## Rede e navegador

- O host padrão é `127.0.0.1`, não `0.0.0.0`.
- CORS não aceita a origem `null`; aceita somente `localhost` e `127.0.0.1`.
- A interface usa CSP restritiva para scripts e conexões locais.
- URLs usadas pela pesquisa externa passam por validação de esquema, DNS e IP público para reduzir SSRF.

Ao expor o serviço na LAN, defina explicitamente `PROCUREFLOW_HOST`, utilize token e limite a porta no firewall às máquinas necessárias. Não exponha esta aplicação diretamente à internet.
